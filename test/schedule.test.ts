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
  version: 1,
  generatedAt: "2026-09-27T01:00:00.000Z",
  timeZone: "Pacific/Auckland",
  options: [
    { origin: "home", routeCode: "27", routeId: "r27-current", directionId: 0, boardingStopId: "board", alightingStopId: "alight", trips: [
      { tripId: "h1", serviceId: "weekday", boardSequence: 3, alightSequence: 10, boardSeconds: 7 * 3600 + 30 * 60, alightSeconds: 8 * 3600 }
    ]},
    { origin: "gym", routeCode: "1", routeId: "r1-current", directionId: 0, boardingStopId: "gboard", alightingStopId: "alight", trips: [
      { tripId: "g1", serviceId: "weekday", boardSequence: 4, alightSequence: 20, boardSeconds: 7 * 3600 + 40 * 60, alightSeconds: 8 * 3600 + 10 * 60 }
    ]}
  ],
  services: [
    { serviceId: "weekday", startDate: "20260101", endDate: "20261231", weekdayMask: 31, exceptions: { "20260928": 1 } }
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
