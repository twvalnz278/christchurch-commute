import { buildReport } from "../src/report.js";
import type { JourneyConfig, MetroSource } from "../src/types.js";

const config: JourneyConfig = {
  timeZone: "Pacific/Auckland",
  deadlineLocal: "08:30",
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013",
  freshnessSeconds: 120,
  arrivalMarginMinutes: 10,
  walkingBufferMinutes: 2,
  boardingLeadMinutes: 2,
  options: [
    { origin: "home", label: "Home → Route 27", routeCode: "27", routeId: "r27", originDescription: "private", boardingStopId: "board", alightingStopId: "alight", accessWalkingMinutes: 14, egressWalkingMinutes: 10, transferCount: 0 },
    { origin: "gym", label: "Gym → Route 1", routeCode: "1", routeId: "r1", originDescription: "4 Bellewood Avenue, Belfast, Christchurch", boardingStopId: "gboard", alightingStopId: "alight", accessWalkingMinutes: 8, egressWalkingMinutes: 10, transferCount: 0 }
  ]
};

let calls = 0;
const source: MetroSource = {
  async getJourney() {
    calls++;
    return { origin: "home", candidates: [] };
  }
};

const sunday = await buildReport(config, source, "home", new Date("2026-09-27T03:00:00.000Z"));
if (sunday.status !== "outside-window" || calls !== 0) throw new Error("weekend should not call Metro");

const mondayAfterDeadline = await buildReport(config, source, "home", new Date("2026-09-27T20:00:00.000Z"));
if (mondayAfterDeadline.status !== "outside-window" || calls !== 0) throw new Error("after-deadline check should not call Metro");

console.log("PASS weekend and passed-deadline checks are explicit and make no external calls");
