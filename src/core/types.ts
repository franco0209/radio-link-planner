export interface LatLng {
  lat: number;
  lng: number;
}

/** One sample along the path between site A and site B. */
export interface TerrainSample {
  /** Distance from A in km. */
  d: number;
  /** Ground elevation above sea level in metres. */
  h: number;
  lat: number;
  lng: number;
}

export interface LinkParams {
  /** Carrier frequency in MHz. */
  freqMHz: number;
  /** Transmit power at the radio port in dBm. */
  txPowerDbm: number;
  /** Antenna gains in dBi (site A / site B). */
  gainADbi: number;
  gainBDbi: number;
  /** Cable + connector losses in dB (site A / site B). */
  cableLossADb: number;
  cableLossBDb: number;
  /** Receiver sensitivity at the target data rate, dBm. */
  rxSensitivityDbm: number;
  /** Antenna heights above ground in metres (site A / site B). */
  heightAM: number;
  heightBM: number;
  /** Effective earth-radius factor. 4/3 = standard atmosphere. */
  kFactor: number;
  /** Terrain factor for the fading model: 4 smooth/water, 1 average, 0.25 mountainous. */
  terrainFactor: number;
  /** Extra losses (rain, foliage, polarisation mismatch...) in dB. */
  marginDb: number;
}

export type Verdict = 'good' | 'marginal' | 'blocked';

export interface ProfilePoint {
  d: number;
  /** Terrain elevation + earth bulge (m). */
  ground: number;
  /** Straight line-of-sight height (m a.s.l.). */
  los: number;
  /** First Fresnel zone radius (m). */
  fresnel: number;
  /** Clearance between LOS and ground (m); negative = obstructed. */
  clearance: number;
  /** clearance / fresnel radius. 1 = full first zone clear, <0 = blocked. */
  clearanceRatio: number;
}

export interface LinkAnalysis {
  distanceKm: number;
  profile: ProfilePoint[];
  fsplDb: number;
  eirpDbm: number;
  /** Worst-case obstruction diffraction loss (single knife edge), dB. */
  diffractionDb: number;
  rxLevelDbm: number;
  fadeMarginDb: number;
  /** Estimated yearly availability, 0-100 (%). */
  availabilityPct: number;
  /** Worst clearance as ratio of the first Fresnel radius. */
  minClearanceRatio: number;
  /** Distance (km) from A where the worst clearance happens. */
  worstAtKm: number;
  /** Extra height (m) to add to BOTH masts to reach 60 % Fresnel clearance; 0 if already fine. */
  extraHeightNeededM: number;
  /** Whether the 60 % clearance can be reached at all within the search limit. */
  extraHeightReachable: boolean;
  verdict: Verdict;
  /** Structured explanation of the verdict; the UI turns it into a sentence in the user's language. */
  reason: Reason;
}

export type Reason =
  | { kind: 'good' }
  | { kind: 'blocked'; worstKm: number; extraM: number; reachable: boolean }
  | { kind: 'lowSignal' }
  | { kind: 'fresnel'; worstKm: number; extraM: number; reachable: boolean }
  | { kind: 'lowMargin'; fadeDb: number };
