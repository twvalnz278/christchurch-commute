export type Origin = "home" | "gym";
export type Confidence = "A" | "B" | "C";
export type JourneySource = "gtfs-rt-trip-updates" | "gtfs-static";

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

export interface JourneyCandidate {
  origin: Origin;
  tripId: string;
  expectedBoarding: string;
  expectedArrival: string;
  source: JourneySource;
  sourceReference: string;
  confidence: Confidence;
  uncertaintyMinutes: number;
  observedAt?: string;
  note?: string;
}

export interface JourneyObservation {
  origin: Origin;
  candidates: JourneyCandidate[];
  error?: string;
  notes?: string[];
}

export interface EvaluatedOption {
  origin: Origin;
  label: string;
  verified: boolean;
  reason: string;
  tripId?: string;
  confidence?: Confidence;
  source?: JourneySource;
  expectedBoarding?: string;
  leaveBy?: string;
  expectedArrival?: string;
  conservativeArrival?: string;
  marginMinutes?: number;
  note?: string;
}

export interface Report {
  generatedAt: string;
  deadline: string;
  localServiceDate: string;
  status: "ok" | "unverified" | "outside-window";
  safeRecommendation: boolean;
  headline: string;
  options: EvaluatedOption[];
  fallback: string;
  weather?: {
    summary: string;
    extraWalkingMinutes: number;
    source: "open-meteo" | "fallback";
  };
  notes?: string[];
}

export interface MetroSource {
  getJourney(
    option: JourneyOptionConfig,
    now: Date,
    walkingBufferMinutes: number,
    boardingLeadMinutes: number,
    freshnessSeconds: number
  ): Promise<JourneyObservation>;
}

export interface Env {
  METRO_API_KEY?: string;
  JOURNEY_CONFIG?: string;
  JOURNEY_SCHEDULE?: string;
  COMMUTE_TOKEN?: string;
  METRO_SOURCE?: MetroSource;
}
