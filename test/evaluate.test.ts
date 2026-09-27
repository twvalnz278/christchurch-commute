import { evaluate } from "../src/evaluate.js";
import { formatText } from "../src/format.js";
import type { JourneyCandidate, JourneyConfig, JourneyObservation, Origin } from "../src/types.js";

const now = new Date("2026-09-27T18:00:00.000Z"); // 07:00 Monday NZDT
const config: JourneyConfig = {
  timeZone: "Pacific/Auckland",
  deadlineLocal: "08:30",
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013",
  freshnessSeconds: 120,
  arrivalMarginMinutes: 8,
  walkingBufferMinutes: 2,
  boardingLeadMinutes: 2,
  options: [
    { origin: "home", label: "Home → Route 27", routeCode: "27", routeId: "route-27-fixture", originDescription: "private", boardingStopId: "stop-a", alightingStopId: "stop-b", accessWalkingMinutes: 5, egressWalkingMinutes: 5, transferCount: 0 }
  ]
};

function candidate(
  tripId: string,
  boarding: string,
  arrival: string,
  confidence: "A" | "B" | "C" = "A",
  source: "gtfs-rt-trip-updates" | "gtfs-static" = "gtfs-rt-trip-updates",
  uncertaintyMinutes = 4
): JourneyCandidate {
  return {
    origin: "home",
    tripId,
    expectedBoarding: boarding,
    expectedArrival: arrival,
    source,
    sourceReference: `fixture:${tripId}`,
    confidence,
    uncertaintyMinutes,
    ...(source === "gtfs-rt-trip-updates" ? { observedAt: now.toISOString() } : {})
  };
}
function observation(candidates: JourneyCandidate[], error?: string): JourneyObservation {
  return { origin: "home", candidates, ...(error ? { error } : {}) };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const tests: Array<[string, () => void]> = [
  ["fails closed when no journey candidate exists", () => {
    const report = evaluate(config, [], now);
    assert(!report.safeRecommendation && report.status === "unverified", "missing data must not be safe");
    assert(formatText(report).includes("MetroGo"), "fallback must name MetroGo");
  }],
  ["chooses the latest safe leave-by time rather than treating trips as conflicting sources", () => {
    const early = candidate("early", "2026-09-27T18:25:00.000Z", "2026-09-27T18:50:00.000Z");
    const late = candidate("late", "2026-09-27T18:40:00.000Z", "2026-09-27T19:00:00.000Z");
    const option = evaluate(config, [observation([early, late])], now).options[0];
    assert(option?.verified && option.tripId === "late", "latest safe candidate should be selected");
    assert(option.leaveBy === "2026-09-27T18:31:00.000Z", "leave-by must include access walk + personal buffer + stop lead");
  }],
  ["rejects stale realtime while retaining valid static fallback", () => {
    const stale = candidate("rt", "2026-09-27T18:25:00.000Z", "2026-09-27T18:50:00.000Z");
    stale.observedAt = "2026-09-27T17:50:00.000Z";
    const fallback = candidate("static", "2026-09-27T18:30:00.000Z", "2026-09-27T18:55:00.000Z", "C", "gtfs-static", 5);
    const option = evaluate(config, [observation([stale, fallback])], now).options[0];
    assert(option?.verified && option.tripId === "static" && option.confidence === "C", "static fallback should survive stale realtime");
  }],
  ["rejects a trip whose conservative arrival misses 08:30", () => {
    const tooLate = candidate("late", "2026-09-27T18:50:00.000Z", "2026-09-27T19:15:00.000Z");
    const option = evaluate(config, [observation([tooLate])], now).options[0];
    assert(option && !option.verified && option.reason.includes("08:30"), "hard deadline must be explicit");
  }],
  ["adds final walk, uncertainty, safety margin and weather walking buffer", () => {
    const value = candidate("safe", "2026-09-27T18:30:00.000Z", "2026-09-27T19:00:00.000Z");
    const option = evaluate(config, [observation([value])], now, 2).options[0];
    assert(option?.verified, "candidate should be safe");
    // final walk 5 + (2 personal + 2 weather) + uncertainty 4 + safety 8 = 21 minutes
    assert(option.marginMinutes === 21, "all conservative components must be included");
    assert(option.conservativeArrival === "2026-09-27T19:21:00.000Z", "conservative arrival mismatch");
  }],
  ["formats local commute time and confidence for Shortcuts", () => {
    const value = candidate("safe", "2026-09-27T18:30:00.000Z", "2026-09-27T19:00:00.000Z");
    const text = formatText(evaluate(config, [observation([value])], now));
    assert(text.includes("Confidence: A"), "confidence should be visible");
    assert(text.includes("Leave by:"), "leave-by should be visible");
  }]
];

let failures = 0;
for (const [name, test] of tests) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}:`, error instanceof Error ? error.message : "unknown error"); }
}
if (failures) throw new Error(`${failures} test(s) failed`);
