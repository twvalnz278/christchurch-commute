import { evaluate } from "../src/evaluate.js";
import { formatText } from "../src/format.js";
import { validateJourneyIds, type GtfsStatic } from "../src/gtfs/static.js";
import { parseServiceAlerts } from "../src/gtfs-realtime/service-alerts.js";
import type { JourneyConfig, JourneyObservation, Origin } from "../src/types.js";

const now = new Date("2026-09-27T18:00:00.000Z");
const config: JourneyConfig = {
  timeZone: "Pacific/Auckland",
  deadlineLocal: "08:30",
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013",
  freshnessSeconds: 120,
  arrivalMarginMinutes: 8,
  options: [
    { origin: "home", label: "Home → Route 27", routeCode: "27", routeId: "route-27-fixture", originDescription: "private", boardingStopId: "stop-a", alightingStopId: "stop-b", walkingMinutes: 5, transferCount: 0 },
    { origin: "gym", label: "Flex Fitness Belfast → Route 1", routeCode: "1", routeId: "route-1-fixture", originDescription: "4 Bellewood Avenue, Belfast, Christchurch", boardingStopId: "stop-c", alightingStopId: "stop-d", walkingMinutes: 8, transferCount: 0 }
  ]
};

function live(origin: Origin, arrival: string, observedAt = now.toISOString(), uncertaintyMinutes = 4): JourneyObservation {
  return { origin, candidates: [{ origin, expectedArrival: arrival, observedAt, uncertaintyMinutes, source: "siri-et", sourceReference: "synthetic-test-only" }] };
}

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

const tests: Array<[string, () => void]> = [
  ["fails closed when live data is missing", () => {
    const report = evaluate(config, [], now);
    assert(!report.safeRecommendation, "missing data must not be safe");
    assert(formatText(report).includes("MetroGo"), "fallback must name MetroGo");
  }],
  ["rejects stale live data without substituting a schedule", () => {
    const report = evaluate(config, [live("home", "2026-09-27T19:00:00.000Z", "2026-09-27T17:50:00.000Z")], now);
    assert(!report.options[0]?.verified && report.options[0]?.reason.includes("stale"), "stale option must fail explicitly");
  }],
  ["rejects contradictory live arrival results", () => {
    const observation = live("home", "2026-09-27T19:00:00.000Z");
    observation.candidates.push({ ...observation.candidates[0]!, expectedArrival: "2026-09-27T19:04:01.000Z" });
    assert(evaluate(config, [observation], now).options[0]?.reason.includes("conflict"), "conflict must be explicit");
  }],
  ["rejects a conservative arrival after 08:30", () => {
    const option = evaluate(config, [live("home", "2026-09-27T19:15:00.000Z")], now).options[0];
    assert(option, "evaluated option is missing");
    assert(!option.verified && option.reason.includes("08:30"), "hard deadline must be explicit");
  }],
  ["adds walking, uncertainty, and safety margin", () => {
    const option = evaluate(config, [live("home", "2026-09-27T19:00:00.000Z")], now).options[0];
    assert(option, "evaluated option is missing");
    assert(option.verified && option.marginMinutes === 17, "all conservative components must be included");
    assert(option.conservativeArrival === "2026-09-27T19:17:00.000Z", "conservative arrival mismatch");
  }],
  ["validates configured routes and stops against static GTFS", () => {
    assert(validateJourneyIds(gtfsFixture(), config.options[0]!).length === 0, "fixture IDs should validate");
    const invalid = { ...config.options[0]!, boardingStopId: "invented" };
    assert(validateJourneyIds(gtfsFixture(), invalid).some((error) => error.includes("boarding stop")), "unknown stop must fail");
  }],
  ["parses official GTFS-Realtime Service Alert fields", () => {
    const alert = parseServiceAlerts(serviceAlertFixture()).alerts[0];
    assert(alert?.id === "alert-1", "entity ID should decode");
    assert(alert.headerText[0]?.text === "Delay", "translated header should decode");
    assert(alert.informedEntities[0]?.routeId === "fixture-route", "selector route should decode");
  }]
];

function gtfsFixture(): GtfsStatic {
  return {
    routes: [{ route_id: "route-27-fixture", route_short_name: "27" }],
    stops: [{ stop_id: "stop-a" }, { stop_id: "stop-b" }],
    trips: [{ route_id: "route-27-fixture", trip_id: "trip-fixture" }],
    stopTimes: [{ trip_id: "trip-fixture", stop_id: "stop-a", stop_sequence: "1" }, { trip_id: "trip-fixture", stop_id: "stop-b", stop_sequence: "2" }],
    calendar: [{ service_id: "weekday-fixture" }]
  };
}

function serviceAlertFixture(): Uint8Array {
  const field = (number: number, value: Uint8Array) => Uint8Array.from([number * 8 + 2, value.length, ...value]);
  const text = (value: string) => new TextEncoder().encode(value);
  const translation = field(1, field(1, text("Delay")));
  const selector = field(5, field(2, text("fixture-route")));
  const alert = Uint8Array.from([...selector, ...field(10, translation)]);
  const entity = Uint8Array.from([...field(1, text("alert-1")), ...field(5, alert)]);
  const header = field(1, text("2.0"));
  return Uint8Array.from([...field(1, header), ...field(2, entity)]);
}

let failures = 0;
for (const [name, test] of tests) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}:`, error instanceof Error ? error.message : "unknown error"); }
}
if (failures) throw new Error(`${failures} test(s) failed`);
