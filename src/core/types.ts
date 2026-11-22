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

/** A repeater site: an active relay that receives on one hop and retransmits on the next. */
export interface Repeater extends LatLng {
  /** Mast height above ground, m. */
  heightM: number;
}

/** Multi-hop result. Hops are ordered from site A to site B. */
export interface RouteAnalysis {
  hops: LinkAnalysis[];
  /** Sum of the hop lengths, km (longer than the straight A-B line when repeaters are off-axis). */
  totalKm: number;
  /** Worst verdict among the hops. */
  verdict: Verdict;
  /** End-to-end yearly availability (%): hops are in series, so the product of their availabilities. */
  availabilityPct: number;
  /** Index of the hop that limits the route. */
  weakestHop: number;
  minFadeMarginDb: number;
  minClearanceRatio: number;
}

export interface SuggestedRepeater extends Repeater {
  /** Distance from A along the A-B line, km. */
  atKm: number;
  /** Ground elevation at the site, m a.s.l. */
  elevationM: number;
}

export interface RepeaterSuggestion {
  repeaters: SuggestedRepeater[];
  verdict: Verdict;
  availabilityPct: number;
  minFadeMarginDb: number;
  hopKm: number[];
}

export type Reason =
  | { kind: 'good' }
  | { kind: 'blocked'; worstKm: number; extraM: number; reachable: boolean }
  | { kind: 'lowSignal' }
  | { kind: 'fresnel'; worstKm: number; extraM: number; reachable: boolean }
  | { kind: 'lowMargin'; fadeDb: number };
