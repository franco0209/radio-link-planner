#!/usr/bin/env python3
"""Download Copernicus GLO-90 DEM tiles and convert them to the compact format the app reads.

    pip install tifffile imagecodecs numpy
    python scripts/build-dem.py --bbox -18 -15 -73 -70

--bbox is lat_min lat_max lng_min lng_max in whole degrees (the box edges, not tile corners).
Each 1x1 degree tile becomes public/dem/<S17_W072>.bin.gz: 1200 x 1200 Int16 little-endian metres,
row-major, north to south, then gzip. public/dem/index.json lists the tiles present.

Source: AWS Open Data bucket `copernicus-dem-90m` (public, anonymous HTTPS, no account needed).
"""
import argparse
import gzip
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
import tifffile

SIZE = 1200
BUCKET = 'https://copernicus-dem-90m.s3.amazonaws.com'
OUT = Path(__file__).resolve().parent.parent / 'public' / 'dem'


def tile_id(lat0: int, lng0: int) -> str:
    """Tile named by its south-west corner, e.g. lat -17, lng -72 -> S17_W072."""
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}_{'E' if lng0 >= 0 else 'W'}{abs(lng0):03d}"


def source_name(lat0: int, lng0: int) -> str:
    ns = f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}_00"
    ew = f"{'E' if lng0 >= 0 else 'W'}{abs(lng0):03d}_00"
    return f'Copernicus_DSM_COG_30_{ns}_{ew}_DEM'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', nargs=4, type=float, required=True, metavar=('LAT_MIN', 'LAT_MAX', 'LNG_MIN', 'LNG_MAX'))
    ap.add_argument('--cache', type=Path, default=Path('dem-raw'), help='where the original GeoTIFFs are kept (not part of the repo)')
    args = ap.parse_args()
    lat_min, lat_max, lng_min, lng_max = args.bbox
    args.cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    done: list[str] = []
    for lat0 in range(math.floor(lat_min), math.ceil(lat_max)):
        for lng0 in range(math.floor(lng_min), math.ceil(lng_max)):
            name = source_name(lat0, lng0)
            tif = args.cache / f'{name}.tif'
            if not tif.exists():
                url = f'{BUCKET}/{name}/{name}.tif'
                try:
                    urllib.request.urlretrieve(url, tif)
                except Exception as e:  # open sea has no tile
                    print(f'skip {tile_id(lat0, lng0)}: {e}')
                    continue
            data = tifffile.imread(tif)
            if data.shape != (SIZE, SIZE):
                print(f'skip {tile_id(lat0, lng0)}: unexpected shape {data.shape}')
                continue
            metres = np.clip(np.rint(np.nan_to_num(data, nan=0.0)), -500, 9000).astype('<i2')
            raw = metres.tobytes()
            out = OUT / f'{tile_id(lat0, lng0)}.bin.gz'
            out.write_bytes(gzip.compress(raw, 9, mtime=0))
            done.append(tile_id(lat0, lng0))
            print(f'{tile_id(lat0, lng0)}: {out.stat().st_size / 1e6:.2f} MB')

    (OUT / 'index.json').write_text(json.dumps({'size': SIZE, 'tiles': sorted(done)}) + '\n')
    print(f'{len(done)} tiles')


if __name__ == '__main__':
    main()
