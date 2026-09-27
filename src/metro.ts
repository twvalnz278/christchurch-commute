import { classifyAlerts } from "./alerts.js";
import { downloadServiceAlerts } from "./gtfs-realtime/service-alerts.js";
import { observeTripUpdates } from "./gtfs-realtime/trip-updates.js";
import { routeManifestFor } from "./route-manifest.js";
import type { JourneyObservation, JourneyOptionConfig, MetroSource } from "./types.js";

export class VerifiedMetroSource implements MetroSource {
  constructor(private readonly apiKey: string) {}

  async getJourney(
    option: JourneyOptionConfig,
    now: Date,
    walkingBufferMinutes: number,
    boardingLeadMinutes: number
  ): Promise<JourneyObservation> {
    try {
      const manifest = routeManifestFor(option.origin);
      if (manifest.routeCode !== option.routeCode) {
        return { origin: option.origin, candidates: [], error: "Route manifest does not match configured route code" };
      }

      const observation = await observeTripUpdates(
        this.apiKey,
        option,
        manifest,
        now,
        walkingBufferMinutes,
        boardingLeadMinutes
      );
      if (observation.error || observation.candidates.length === 0) return observation;

      const tripId = observation.candidates[0]?.sourceReference.startsWith("trip:")
        ? observation.candidates[0]!.sourceReference.slice(5)
        : undefined;
      const alerts = await downloadServiceAlerts(this.apiKey);
      const classified = classifyAlerts(alerts.alerts, {
        routeId: manifest.routeId,
        stopIds: [option.boardingStopId, option.alightingStopId],
        ...(tripId ? { tripId } : {}),
        directionId: manifest.directionId,
        nowEpochSeconds: Math.floor(now.valueOf() / 1000)
      });
      const unsafe = classified.find((item) =>
        item.risk === "BLOCK" || item.risk === "HIGH_RISK" || item.risk === "CONFLICT"
      );
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
