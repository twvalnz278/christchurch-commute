import { deadlineFor } from "./deadline.js";
import { isFresh } from "./freshness.js";
import type { EvaluatedOption, JourneyConfig, JourneyObservation, Report } from "./types.js";

const FALLBACK = "Journey unverified. Check MetroGo before leaving.";

export function evaluate(config: JourneyConfig, observations: JourneyObservation[], now: Date): Report {
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
    if (arrivals.some(Number.isNaN)) return fail(option.origin, option.label, "Live arrival time is invalid");
    if (Math.max(...arrivals) - Math.min(...arrivals) > 2 * 60_000) {
      return fail(option.origin, option.label, "Live sources conflict by more than two minutes");
    }
    // Choose the latest result, then add measured walking, the user's walking-speed buffer,
    // source uncertainty, and the configured safety margin.
    const baseArrival = Math.max(...arrivals);
    const uncertainty = Math.max(...observation.candidates.map((item) => item.uncertaintyMinutes));
    const totalMargin = option.walkingMinutes + config.walkingBufferMinutes + uncertainty + config.arrivalMarginMinutes;
    const conservativeArrival = new Date(baseArrival + totalMargin * 60_000);
    if (conservativeArrival > deadline) {
      return {
        ...fail(option.origin, option.label, "Conservative arrival misses the 08:30 hard deadline"),
        expectedArrival: new Date(baseArrival).toISOString(),
        conservativeArrival: conservativeArrival.toISOString(),
        marginMinutes: totalMargin
      };
    }
    return {
      origin: option.origin,
      label: option.label,
      verified: true,
      reason: `Live data passes freshness and deadline checks with ${option.walkingMinutes} measured walking minutes plus a ${config.walkingBufferMinutes}-minute walking-speed buffer and a ${uncertainty + config.arrivalMarginMinutes}-minute uncertainty/safety margin`,
      expectedArrival: new Date(baseArrival).toISOString(),
      conservativeArrival: conservativeArrival.toISOString(),
      marginMinutes: totalMargin
    };
  });
  const safe = options.filter((option) => option.verified).sort((a, b) => {
    const aConfig = config.options.find((item) => item.origin === a.origin)!;
    const bConfig = config.options.find((item) => item.origin === b.origin)!;
    return aConfig.transferCount - bConfig.transferCount || aConfig.walkingMinutes - bConfig.walkingMinutes;
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
