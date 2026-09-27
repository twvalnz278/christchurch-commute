import { deadlineFor } from "./deadline.js";
import { isFresh } from "./freshness.js";
import type { EvaluatedOption, JourneyConfig, JourneyObservation, Report } from "./types.js";

const FALLBACK = "Journey unverified. Check MetroGo before leaving.";

export function evaluate(config: JourneyConfig, observations: JourneyObservation[], now: Date, weatherWalkingExtraMinutes = 0): Report {
  const deadline = deadlineFor(now, config.deadlineLocal, config.timeZone);
  const byId = new Map(observations.map((item) => [item.origin, item]));
  const options = config.options.map((option): EvaluatedOption => {
    const observation = byId.get(option.origin);
    if (!observation || observation.error || observation.candidates.length === 0) {
      return fail(option.origin, option.label, observation?.error ?? "Live journey data is missing");
    }
    if (observation.candidates.some((item) => !isFresh(item.observedAt, now, config.freshnessSeconds))) {
      return fail(option.origin, option.label, "Live journey data is stale");
    }
    const arrivals = observation.candidates.map((item) => new Date(item.expectedArrival).valueOf());
    const boardings = observation.candidates.map((item) => new Date(item.expectedBoarding).valueOf());
    if (arrivals.some(Number.isNaN) || boardings.some(Number.isNaN)) return fail(option.origin, option.label, "Live journey time is invalid");
    if (Math.max(...arrivals) - Math.min(...arrivals) > 2 * 60_000) {
      return fail(option.origin, option.label, "Live sources conflict by more than two minutes");
    }
    const baseArrival = Math.max(...arrivals);
    const baseBoarding = Math.min(...boardings);
    const uncertainty = Math.max(...observation.candidates.map((item) => item.uncertaintyMinutes));
    const effectiveWalkingBuffer = config.walkingBufferMinutes + weatherWalkingExtraMinutes;
    const finalWalk = option.egressWalkingMinutes + effectiveWalkingBuffer;
    const totalMargin = finalWalk + uncertainty + config.arrivalMarginMinutes;
    const conservativeArrival = new Date(baseArrival + totalMargin * 60_000);
    const leaveBy = new Date(baseBoarding - (option.accessWalkingMinutes + effectiveWalkingBuffer + config.boardingLeadMinutes) * 60_000);
    if (leaveBy < now) {
      return {
        ...fail(option.origin, option.label, "The next verified bus can no longer be reached with the configured walking/boarding buffer"),
        expectedBoarding: new Date(baseBoarding).toISOString(),
        leaveBy: leaveBy.toISOString(),
        expectedArrival: new Date(baseArrival).toISOString(),
        conservativeArrival: conservativeArrival.toISOString(),
        marginMinutes: totalMargin
      };
    }
    if (conservativeArrival > deadline) {
      return {
        ...fail(option.origin, option.label, "Conservative arrival misses the 08:30 hard deadline"),
        expectedBoarding: new Date(baseBoarding).toISOString(),
        leaveBy: leaveBy.toISOString(),
        expectedArrival: new Date(baseArrival).toISOString(),
        conservativeArrival: conservativeArrival.toISOString(),
        marginMinutes: totalMargin
      };
    }
    return {
      origin: option.origin,
      label: option.label,
      verified: true,
      reason: `Live data passes catchability, freshness, service-alert and deadline checks. Access walk ${option.accessWalkingMinutes}m + ${effectiveWalkingBuffer}m walking buffer (personal + weather) + ${config.boardingLeadMinutes}m stop lead; final walk ${option.egressWalkingMinutes}m + ${effectiveWalkingBuffer}m walking buffer.`,
      expectedBoarding: new Date(baseBoarding).toISOString(),
      leaveBy: leaveBy.toISOString(),
      expectedArrival: new Date(baseArrival).toISOString(),
      conservativeArrival: conservativeArrival.toISOString(),
      marginMinutes: totalMargin
    };
  });
  const safe = options.filter((option) => option.verified).sort((a, b) => {
    const aConfig = config.options.find((item) => item.origin === a.origin)!;
    const bConfig = config.options.find((item) => item.origin === b.origin)!;
    return aConfig.transferCount - bConfig.transferCount ||
      new Date(b.leaveBy!).valueOf() - new Date(a.leaveBy!).valueOf() ||
      aConfig.accessWalkingMinutes - bConfig.accessWalkingMinutes;
  });
  return {
    generatedAt: now.toISOString(),
    deadline: deadline.toISOString(),
    safeRecommendation: safe.length > 0,
    headline: safe.length > 0 ? `Verified preference: ${safe[0]!.label}` : FALLBACK,
    options,
    fallback: FALLBACK
  };
}

function fail(origin: EvaluatedOption["origin"], label: string, reason: string): EvaluatedOption {
  return { origin, label, verified: false, reason };
}
