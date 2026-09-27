export type Origin = "home" | "gym";

export interface JourneyOptionConfig {
  origin: Origin;
  label: string;
  routeCode: "27" | "1";
  routeId: string;
  originDescription: string;
  boardingStopId: string;
  alightingStopId: string;
  accessWalkingMinutes: number;
  egressWalkingMinutes: number;
  transferCount: number;
}

export interface JourneyConfig {
  timeZone: "Pacific/Auckland";
  deadlineLocal: "08:30";
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013";
  freshnessSeconds: number;
  arrivalMarginMinutes: number;
  walkingBufferMinutes: number;
  boardingLeadMinutes: number;
  options: JourneyOptionConfig[];
}

export interface LiveJourneyCandidate {
  origin: Origin;
  observedAt: string;
  expectedBoarding: string;
  /** Predicted live arrival at the configured alighting stop. */
  expectedArrival: string;
  source: "gtfs-rt-trip-updates" | "siri-et";
  sourceReference: string;
  uncertaintyMinutes: number;
}

export interface JourneyObservation {
  origin: Origin;
  candidates: LiveJourneyCandidate[];
  error?: string;
}

export interface EvaluatedOption {
  origin: Origin;
  label: string;
  verified: boolean;
  reason: string;
  expectedBoarding?: string;
  leaveBy?: string;
  expectedArrival?: string;
  conservativeArrival?: string;
  marginMinutes?: number;
}

export interface Report {
  generatedAt: string;
  deadline: string;
  safeRecommendation: boolean;
  headline: string;
  options: EvaluatedOption[];
  fallback: string;
}

export interface MetroSource {
  getJourney(option: JourneyOptionConfig, now: Date, walkingBufferMinutes: number, boardingLeadMinutes: number): Promise<JourneyObservation>;
}

export interface Env {
  METRO_API_KEY?: string;
  JOURNEY_CONFIG?: string;
  METRO_SOURCE?: MetroSource;
}
