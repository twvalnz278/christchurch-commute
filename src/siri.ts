import { SIRI_ET_URL, checkedFetch } from "./http.js";
import type { JourneyCandidate, JourneyObservation, JourneyOptionConfig } from "./types.js";

export interface SiriEstimatedTimeParser {
  parse(payload: Uint8Array, option: JourneyOptionConfig, now: Date): JourneyCandidate[];
}

export class UnverifiedSiriParser implements SiriEstimatedTimeParser {
  parse(): JourneyCandidate[] {
    throw new Error("SIRI Estimated Time response schema remains unverified; no live arrival can be derived safely");
  }
}

export async function fetchSiriEstimatedTime(apiKey: string, routeCode: "27" | "1"): Promise<Uint8Array> {
  const url = new URL(SIRI_ET_URL);
  url.searchParams.set("routecode", routeCode);
  return checkedFetch(url.toString(), apiKey, 2_000_000);
}

export async function observeSiri(
  apiKey: string,
  option: JourneyOptionConfig,
  now: Date,
  parser: SiriEstimatedTimeParser
): Promise<JourneyObservation> {
  try {
    const payload = await fetchSiriEstimatedTime(apiKey, option.routeCode);
    return { origin: option.origin, candidates: parser.parse(payload, option, now) };
  } catch (error) {
    return { origin: option.origin, candidates: [], error: safeError(error) };
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "SIRI Estimated Time request failed";
}
