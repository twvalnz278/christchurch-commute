import { classifyAlerts } from "./alerts.js";
import { localServiceDate } from "./deadline.js";
import { downloadServiceAlerts } from "./gtfs-realtime/service-alerts.js";
import { downloadTripUpdates, overlayRealtimeCandidates } from "./gtfs-realtime/trip-updates.js";
import { scheduleOption, staticCandidates, type JourneySchedule } from "./schedule.js";
import type { JourneyCandidate, JourneyObservation, JourneyOptionConfig, MetroSource } from "./types.js";

export class VerifiedMetroSource implements MetroSource {
  constructor(
    private readonly apiKey: string,
    private readonly schedule: JourneySchedule
  ) {}

  async getJourney(
    option: JourneyOptionConfig,
    now: Date,
    walkingBufferMinutes: number,
    boardingLeadMinutes: number,
    freshnessSeconds: number
  ): Promise<JourneyObservation> {
    try {
      const scheduled = scheduleOption(this.schedule, option.origin);
      let candidates = staticCandidates(this.schedule, option, now, walkingBufferMinutes, boardingLeadMinutes);
      if (candidates.length === 0) {
        return {
          origin: option.origin,
          candidates: [],
          error: "No active static GTFS trip can meet the configured boarding window on this service date."
        };
      }

      const notes: string[] = [];
      try {
        const feed = await downloadTripUpdates(this.apiKey);
        const readyAt = new Date(
          now.valueOf() + (option.accessWalkingMinutes + walkingBufferMinutes + boardingLeadMinutes) * 60_000
        );
        const overlaid = overlayRealtimeCandidates(
          candidates,
          scheduled,
          feed,
          now,
          freshnessSeconds,
          readyAt,
          localServiceDate(now, this.schedule.timeZone)
        );
        candidates = overlaid.candidates;
        notes.push(overlaid.note);
      } catch (error) {
        notes.push(`GTFS-Realtime unavailable; static GTFS fallback retained (${safeError(error)}).`);
      }

      if (candidates.length === 0) {
        return {
          origin: option.origin,
          candidates: [],
          error: "All otherwise catchable trips were removed by current GTFS-Realtime status.",
          notes
        };
      }

      // Service Alerts are mandatory for a safe recommendation. If they cannot be
      // checked, fail closed rather than silently using schedule/realtime alone.
      const alerts = await downloadServiceAlerts(this.apiKey);
      const filtered: JourneyCandidate[] = [];
      for (const candidate of candidates) {
        const classified = classifyAlerts(alerts.alerts, {
          routeId: scheduled.routeId,
          stopIds: [option.boardingStopId, option.alightingStopId],
          tripId: candidate.tripId,
          directionId: scheduled.directionId,
          nowEpochSeconds: Math.floor(now.valueOf() / 1000)
        });
        const unsafe = classified.find((item) =>
          item.risk === "BLOCK" || item.risk === "HIGH_RISK" || item.risk === "CONFLICT"
        );
        if (unsafe) {
          notes.push(`Trip ${candidate.tripId} excluded by Service Alert (${unsafe.risk}: ${unsafe.reason}).`);
          continue;
        }
        const annotations = classified.filter((item) => item.risk === "ANNOTATE");
        filtered.push({
          ...candidate,
          ...(annotations.length
            ? { note: [candidate.note, ...annotations.map((item) => `Metro alert: ${item.reason}`)].filter(Boolean).join(" ") }
            : {})
        });
      }

      return {
        origin: option.origin,
        candidates: filtered,
        ...(filtered.length === 0 ? { error: "No trip remains after relevant Metro Service Alerts were applied." } : {}),
        notes
      };
    } catch (error) {
      return {
        origin: option.origin,
        candidates: [],
        error: safeError(error)
      };
    }
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Metro journey validation failed";
}
