import { deadlineFor, localServiceDate } from "./deadline.js";
import { isFresh } from "./freshness.js";
import type { EvaluatedOption, JourneyCandidate, JourneyConfig, JourneyObservation, Report } from "./types.js";

const FALLBACK = "Journey unverified. Check MetroGo before leaving.";

export function evaluate(
  config: JourneyConfig,
  observations: JourneyObservation[],
  now: Date,
  weatherWalkingExtraMinutes = 0
): Report {
  const deadline = deadlineFor(now, config.deadlineLocal, config.timeZone);
  const serviceDate = localServiceDate(now, config.timeZone);
  const byOrigin = new Map(observations.map((item) => [item.origin, item]));

  const options = config.options.map((option): EvaluatedOption => {
    const observation = byOrigin.get(option.origin);
    if (!observation || observation.candidates.length === 0) {
      return fail(option.origin, option.label, observation?.error ?? "No journey candidate is available.");
    }

    const effectiveWalkingBuffer = config.walkingBufferMinutes + weatherWalkingExtraMinutes;
    const evaluated = observation.candidates
      .map((candidate) => evaluateCandidate(candidate))
      .filter((candidate): candidate is EvaluatedCandidate => Boolean(candidate));

    if (evaluated.length === 0) {
      return fail(option.origin, option.label, observation.error ?? "No valid journey time is available.");
    }

    const safe = evaluated
      .filter((candidate) => candidate.leaveBy.valueOf() >= now.valueOf() && candidate.conservativeArrival <= deadline)
      .sort((a, b) =>
        b.leaveBy.valueOf() - a.leaveBy.valueOf() ||
        confidenceRank(a.candidate.confidence) - confidenceRank(b.candidate.confidence) ||
        a.conservativeArrival.valueOf() - b.conservativeArrival.valueOf()
      );

    if (safe.length === 0) {
      const earliest = [...evaluated].sort((a, b) => a.conservativeArrival.valueOf() - b.conservativeArrival.valueOf())[0]!;
      const reason = earliest.leaveBy < now
        ? "No remaining trip is catchable with the configured walking and boarding buffers."
        : "No remaining trip can conservatively arrive by the 08:30 hard deadline.";
      return {
        ...fail(option.origin, option.label, reason),
        tripId: earliest.candidate.tripId,
        confidence: earliest.candidate.confidence,
        source: earliest.candidate.source,
        expectedBoarding: earliest.candidate.expectedBoarding,
        leaveBy: earliest.leaveBy.toISOString(),
        expectedArrival: earliest.candidate.expectedArrival,
        conservativeArrival: earliest.conservativeArrival.toISOString(),
        marginMinutes: earliest.marginMinutes,
        note: earliest.candidate.note
      };
    }

    const chosen = safe[0]!;
    return {
      origin: option.origin,
      label: option.label,
      verified: true,
      reason: `Latest verified safe option selected. Confidence ${chosen.candidate.confidence}; ${sourceLabel(chosen.candidate.source)}. Access walk ${option.accessWalkingMinutes}m + ${effectiveWalkingBuffer}m walking buffer + ${config.boardingLeadMinutes}m stop lead; final walk ${option.egressWalkingMinutes}m + ${effectiveWalkingBuffer}m walking buffer; uncertainty/safety ${chosen.candidate.uncertaintyMinutes + config.arrivalMarginMinutes}m.`,
      tripId: chosen.candidate.tripId,
      confidence: chosen.candidate.confidence,
      source: chosen.candidate.source,
      expectedBoarding: chosen.candidate.expectedBoarding,
      leaveBy: chosen.leaveBy.toISOString(),
      expectedArrival: chosen.candidate.expectedArrival,
      conservativeArrival: chosen.conservativeArrival.toISOString(),
      marginMinutes: chosen.marginMinutes,
      note: chosen.candidate.note
    };

    function evaluateCandidate(candidate: JourneyCandidate): EvaluatedCandidate | undefined {
      const boarding = new Date(candidate.expectedBoarding);
      const arrival = new Date(candidate.expectedArrival);
      if (Number.isNaN(boarding.valueOf()) || Number.isNaN(arrival.valueOf()) || arrival <= boarding) return undefined;
      if (candidate.source === "gtfs-rt-trip-updates") {
        if (!candidate.observedAt || !isFresh(candidate.observedAt, now, config.freshnessSeconds)) return undefined;
      }
      const leaveBy = new Date(
        boarding.valueOf() - (option.accessWalkingMinutes + effectiveWalkingBuffer + config.boardingLeadMinutes) * 60_000
      );
      const marginMinutes =
        option.egressWalkingMinutes +
        effectiveWalkingBuffer +
        candidate.uncertaintyMinutes +
        config.arrivalMarginMinutes;
      const conservativeArrival = new Date(arrival.valueOf() + marginMinutes * 60_000);
      return { candidate, leaveBy, conservativeArrival, marginMinutes };
    }
  });

  const verified = options.filter((option) => option.verified);
  return {
    generatedAt: now.toISOString(),
    deadline: deadline.toISOString(),
    localServiceDate: serviceDate,
    status: verified.length > 0 ? "ok" : "unverified",
    safeRecommendation: verified.length > 0,
    headline: verified.length > 0 ? `Verified commute: ${verified[0]!.label}` : FALLBACK,
    options,
    fallback: FALLBACK,
    notes: observations.flatMap((item) => item.notes ?? [])
  };
}

interface EvaluatedCandidate {
  candidate: JourneyCandidate;
  leaveBy: Date;
  conservativeArrival: Date;
  marginMinutes: number;
}

function confidenceRank(value: "A" | "B" | "C"): number {
  return value === "A" ? 0 : value === "B" ? 1 : 2;
}

function sourceLabel(value: "gtfs-rt-trip-updates" | "gtfs-static"): string {
  return value === "gtfs-rt-trip-updates" ? "fresh Metro realtime" : "static GTFS fallback";
}

function fail(origin: EvaluatedOption["origin"], label: string, reason: string): EvaluatedOption {
  return { origin, label, verified: false, reason };
}
