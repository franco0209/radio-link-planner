#!/usr/bin/env python3
"""Download Copernicus GLO-90 DEM tiles and convert them to the compact format the app reads.

    pip install tifffile imagecodecs numpy shapely
    curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson
    python scripts/build-dem.py --bbox -19 1 -82 -68 --country PER --boundaries ne_10m_admin_0_countries.geojson

--bbox is lat_min lat_max lng_min lng_max in whole degrees (the box edges, not tile corners).
--country keeps only the tiles within about 10 km of that country (ISO A3 code in the --boundaries GeoJSON).
Each 1x1 degree tile becomes public/dem/<S17_W072>.bin.gz: 1200 x 1200 Int16 little-endian metres,
row-major, north to south, then gzip. public/dem/index.json lists every tile present in that folder.

Source: AWS Open Data bucket `copernicus-dem-90m` (public, anonymous HTTPS, no account needed).
"""
import argparse
import gzip
import json
import math
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile

SIZE = 1200
BUCKET = 'https://copernicus-dem-90m.s3.amazonaws.com'
OUT = Path(__file__).resolve().parent.parent / 'public' / 'dem'
MARGIN_DEG = 0.1
ATTEMPTS = 4


def tile_id(lat0: int, lng0: int) -> str:
    """Tile named by its south-west corner, e.g. lat -17, lng -72 -> S17_W072."""
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}_{'E' if lng0 >= 0 else 'W'}{abs(lng0):03d}"


def source_name(lat0: int, lng0: int) -> str:
    ns = f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}_00"
    ew = f"{'E' if lng0 >= 0 else 'W'}{abs(lng0):03d}_00"
    return f'Copernicus_DSM_COG_30_{ns}_{ew}_DEM'


def near_country(corners: list[tuple[int, int]], boundaries: Path, code: str) -> list[tuple[int, int]]:
    """The tiles that touch the country, widened by MARGIN_DEG so links along the border stay covered."""
    from shapely.geometry import box, shape
    from shapely.ops import unary_union

    features = json.loads(boundaries.read_text(encoding='utf-8'))['features']
    parts = [shape(f['geometry']) for f in features if f['properties'].get('ADM0_A3') == code]
    if not parts:
        raise SystemExit(f'no country {code} in {boundaries}')
    area = unary_union(parts).buffer(MARGIN_DEG)
    return [(lat0, lng0) for lat0, lng0 in corners if area.intersects(box(lng0, lat0, lng0 + 1, lat0 + 1))]


def download(url: str, dest: Path) -> bool:
    """False if the bucket has no such tile (open sea). Any other failure is retried, then raised."""
    part = dest.with_name(dest.name + '.part')
    for attempt in range(1, ATTEMPTS + 1):
        try:
            urllib.request.urlretrieve(url, part)
            part.replace(dest)  # an interrupted download never looks like a cached tile
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            if attempt == ATTEMPTS:
                raise
        except OSError:
            if attempt == ATTEMPTS:
                raise
        time.sleep(2**attempt)
    return False


def build(corner: tuple[int, int], cache: Path) -> None:
    lat0, lng0 = corner
    name = source_name(lat0, lng0)
    tif = cache / f'{name}.tif'
    if not tif.exists() and not download(f'{BUCKET}/{name}/{name}.tif', tif):
        print(f'skip {tile_id(lat0, lng0)}: no tile in the bucket (open sea)', flush=True)
        return
    data = tifffile.imread(tif)
    if data.shape != (SIZE, SIZE):
        raise ValueError(f'{tile_id(lat0, lng0)}: unexpected shape {data.shape}')
    metres = np.clip(np.rint(np.nan_to_num(data, nan=0.0)), -500, 9000).astype('<i2')
    out = OUT / f'{tile_id(lat0, lng0)}.bin.gz'
    out.write_bytes(gzip.compress(metres.tobytes(), 9, mtime=0))
    print(f'{tile_id(lat0, lng0)}: {out.stat().st_size / 1e6:.2f} MB', flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', nargs=4, type=float, required=True, metavar=('LAT_MIN', 'LAT_MAX', 'LNG_MIN', 'LNG_MAX'))
    ap.add_argument('--country', help='ISO A3 code, e.g. PER; needs --boundaries')
    ap.add_argument('--boundaries', type=Path, help='GeoJSON of country polygons (Natural Earth admin 0)')
    ap.add_argument('--cache', type=Path, default=Path('dem-raw'), help='where the original GeoTIFFs are kept (not part of the repo)')
    args = ap.parse_args()
    if bool(args.country) != bool(args.boundaries):
        ap.error('--country and --boundaries go together')
    lat_min, lat_max, lng_min, lng_max = args.bbox
    args.cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    corners = [
        (lat0, lng0)
        for lat0 in range(math.floor(lat_min), math.ceil(lat_max))
        for lng0 in range(math.floor(lng_min), math.ceil(lng_max))
    ]
    if args.country:
        corners = near_country(corners, args.boundaries, args.country)
    print(f'{len(corners)} candidate tiles', flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(lambda c: build(c, args.cache), corners))

    tiles = sorted(p.name.removesuffix('.bin.gz') for p in OUT.glob('*.bin.gz'))
    (OUT / 'index.json').write_text(json.dumps({'size': SIZE, 'tiles': tiles}) + '\n', newline='\n')
    print(f'{len(tiles)} tiles in the index')


if __name__ == '__main__':
    main()
