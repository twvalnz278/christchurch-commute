import { classifyAlerts } from "./alerts.js";
import { downloadGtfs, validateJourneyIds, type GtfsStatic } from "./gtfs/static.js";
import { downloadServiceAlerts } from "./gtfs-realtime/service-alerts.js";
import { observeTripUpdates } from "./gtfs-realtime/trip-updates.js";
import type { JourneyObservation, JourneyOptionConfig, MetroSource } from "./types.js";

export type GtfsLoader = () => Promise<GtfsStatic>;

export class VerifiedMetroSource implements MetroSource {
  constructor(
    private readonly apiKey: string,
    private readonly loadGtfs: GtfsLoader
  ) {}

  async getJourney(option: JourneyOptionConfig, now: Date, walkingBufferMinutes: number): Promise<JourneyObservation> {
    try {
      const gtfs = await this.loadGtfs();
      const errors = validateJourneyIds(gtfs, option);
      if (errors.length) return { origin: option.origin, candidates: [], error: errors.join("; ") };

      const observation = await observeTripUpdates(this.apiKey, option, gtfs, now, walkingBufferMinutes);
      if (observation.error || observation.candidates.length === 0) return observation;

      const tripId = observation.candidates[0]?.sourceReference.startsWith("trip:")
        ? observation.candidates[0]!.sourceReference.slice(5)
        : undefined;
      const alerts = await downloadServiceAlerts(this.apiKey);
      const classified = classifyAlerts(alerts.alerts, {
        routeId: option.routeId,
        stopIds: [option.boardingStopId, option.alightingStopId],
        ...(tripId ? { tripId } : {}),
        nowEpochSeconds: Math.floor(now.valueOf() / 1000)
      });
      const unsafe = classified.find((item) => item.risk === "BLOCK" || item.risk === "HIGH_RISK" || item.risk === "CONFLICT");
      if (unsafe) {
        return {
          origin: option.origin,
          candidates: [],
          error: `Relevant Metro service alert prevents a verified recommendation (${unsafe.risk}: ${unsafe.reason})`
        };
      }
      return observation;
    } catch (error) {
      return {
        origin: option.origin,
        candidates: [],
        error: error instanceof Error ? error.message : "Metro realtime validation failed"
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
