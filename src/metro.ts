import { downloadGtfs, validateJourneyIds, type GtfsStatic } from "./gtfs/static.js";
import { observeSiri, UnverifiedSiriParser, type SiriEstimatedTimeParser } from "./siri.js";
import type { JourneyObservation, JourneyOptionConfig, MetroSource } from "./types.js";

export type GtfsLoader = () => Promise<GtfsStatic>;

export class VerifiedMetroSource implements MetroSource {
  constructor(
    private readonly apiKey: string,
    private readonly loadGtfs: GtfsLoader,
    private readonly siriParser: SiriEstimatedTimeParser = new UnverifiedSiriParser()
  ) {}

  async getJourney(option: JourneyOptionConfig, now: Date): Promise<JourneyObservation> {
    try {
      const gtfs = await this.loadGtfs();
      const errors = validateJourneyIds(gtfs, option);
      if (errors.length) return { origin: option.origin, candidates: [], error: errors.join("; ") };
      return observeSiri(this.apiKey, option, now, this.siriParser);
    } catch (error) {
      return {
        origin: option.origin,
        candidates: [],
        error: error instanceof Error ? error.message : "GTFS validation failed"
      };
    }
  }
}

let cachedGtfs: { loadedAt: number; value: Promise<GtfsStatic> } | undefined;

export function cachedGtfsLoader(apiKey: string, now = Date.now): GtfsLoader {
  return () => {
    const timestamp = now();
    if (!cachedGtfs || timestamp - cachedGtfs.loadedAt > 60 * 60 * 1000) {
      const value = downloadGtfs(apiKey);
      cachedGtfs = { loadedAt: timestamp, value };
      void value.catch(() => { if (cachedGtfs?.value === value) cachedGtfs = undefined; });
    }
    return cachedGtfs.value;
  };
}
