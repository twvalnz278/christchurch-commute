import { dateForServiceSeconds, deadlineFor, localServiceDate, weekdayBitForServiceDate } from "../src/deadline.js";
import { parseJourneySchedule, staticCandidates } from "../src/schedule.js";
import type { JourneyConfig } from "../src/types.js";

const config: JourneyConfig = {
  timeZone: "Pacific/Auckland",
  deadlineLocal: "08:30",
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013",
  freshnessSeconds: 120,
  arrivalMarginMinutes: 10,
  walkingBufferMinutes: 2,
  boardingLeadMinutes: 2,
  options: [
    { origin: "home", label: "Home → Route 27", routeCode: "27", routeId: "r27-old", originDescription: "private", boardingStopId: "board", alightingStopId: "alight", accessWalkingMinutes: 14, egressWalkingMinutes: 10, transferCount: 0 },
    { origin: "gym", label: "Gym → Route 1", routeCode: "1", routeId: "r1-old", originDescription: "4 Bellewood Avenue, Belfast, Christchurch", boardingStopId: "gboard", alightingStopId: "alight", accessWalkingMinutes: 8, egressWalkingMinutes: 10, transferCount: 0 }
  ]
};

const raw = JSON.stringify({
  v: 2,
  g: "2026-09-27T01:00:00.000Z",
  z: "Pacific/Auckland",
  o: [
    ["home", "27", "r27-current", 0, "board", "alight", [
      ["h1", "weekday", 3, 10, 7 * 3600 + 30 * 60, 8 * 3600]
    ]],
    ["gym", "1", "r1-current", 0, "gboard", "alight", [
      ["g1", "weekday", 4, 20, 7 * 3600 + 40 * 60, 8 * 3600 + 10 * 60]
    ]]
  ],
  s: [
    ["weekday", "20260101", "20261231", 31, { "20260928": 1 }]
  ]
});

const schedule = parseJourneySchedule(raw, config);
if (schedule.options[0]?.routeId !== "r27-current") throw new Error("schedule should allow a current route_id different from the config hint");

const mondayMorning = new Date("2026-09-27T18:00:00.000Z"); // 07:00 Monday NZDT
if (localServiceDate(mondayMorning, "Pacific/Auckland") !== "20260928") throw new Error("local service date mismatch");
if (weekdayBitForServiceDate("20260928") !== 1) throw new Error("Monday weekday bit mismatch");
if (deadlineFor(mondayMorning, "08:30", "Pacific/Auckland").toISOString() !== "2026-09-27T19:30:00.000Z") throw new Error("NZDT deadline conversion mismatch");
if (dateForServiceSeconds("20260928", 7 * 3600 + 30 * 60, "Pacific/Auckland").toISOString() !== "2026-09-27T18:30:00.000Z") throw new Error("GTFS service time conversion mismatch");

const candidates = staticCandidates(schedule, config.options[0]!, mondayMorning, 2, 2);
if (candidates.length !== 1 || candidates[0]?.confidence !== "C" || candidates[0]?.tripId !== "h1") {
  throw new Error("static weekday candidate should be available");
}
console.log("PASS compact schedule validates service date, NZ DST and static fallback candidate");
