/** Radio-physics building blocks. Distances in km, frequency in MHz unless stated. */

/** Free-space path loss in dB. */
export function freeSpaceLossDb(distKm: number, freqMHz: number): number {
  if (distKm <= 0) return 0;
  return 32.44 + 20 * Math.log10(distKm) + 20 * Math.log10(freqMHz);
}

/** Wavelength in metres. */
export function wavelengthM(freqMHz: number): number {
  return 299.792458 / freqMHz;
}

/**
 * Radius (m) of the n-th Fresnel zone at a point d1 km from one end and d2 km from the other.
 * r = 17.32 * sqrt(n * d1 * d2 / (f_GHz * (d1 + d2)))
 */
export function fresnelRadiusM(d1Km: number, d2Km: number, freqMHz: number, n = 1): number {
  const total = d1Km + d2Km;
  if (total <= 0 || d1Km <= 0 || d2Km <= 0) return 0;
  return 17.32 * Math.sqrt((n * d1Km * d2Km) / ((freqMHz / 1000) * total));
}

/** Earth bulge (m) at d1/d2 km from the ends for effective-earth-radius factor k. */
export function earthBulgeM(d1Km: number, d2Km: number, k = 4 / 3): number {
  return (d1Km * d2Km) / (12.742 * k);
}

/**
 * Knife-edge diffraction loss in dB (ITU-R P.526 approximation).
 * @param h  height of the obstruction above the direct ray (m), positive = blocking
 */
export function knifeEdgeLossDb(h: number, d1Km: number, d2Km: number, freqMHz: number): number {
  if (d1Km <= 0 || d2Km <= 0) return 0;
  const lambda = wavelengthM(freqMHz);
  const v = h * Math.sqrt((2 * (d1Km + d2Km) * 1000) / (lambda * d1Km * 1000 * d2Km * 1000));
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
}

/**
 * Yearly availability (%) using the Vigants-Barnett multipath-fading model.
 * Valid for clear line-of-sight paths; treat as an estimate, not a guarantee.
 */
export function availabilityPct(
  distKm: number,
  freqMHz: number,
  fadeMarginDb: number,
  terrainFactor: number,
): number {
  if (fadeMarginDb <= 0) return 0;
  const outage = 6.0e-7 * terrainFactor * (freqMHz / 1000) * distKm ** 3 * 10 ** (-fadeMarginDb / 10);
  return Math.max(0, Math.min(100, (1 - outage) * 100));
}

/** Format an availability percentage with enough digits to be meaningful. */
export function formatAvailability(pct: number): string {
  if (pct >= 99.9999) return '99.9999 %+';
  if (pct >= 99.99) return `${pct.toFixed(4)} %`;
  if (pct >= 99) return `${pct.toFixed(3)} %`;
  return `${pct.toFixed(1)} %`;
}
