import { overlayRealtimeCandidates, parseTripUpdates } from "../src/gtfs-realtime/trip-updates.js";
import type { ScheduleOption } from "../src/schedule.js";
import type { JourneyCandidate } from "../src/types.js";

const encoder = new TextEncoder();
const now = new Date("2026-09-27T18:00:00.000Z");
const observed = Math.floor(now.valueOf() / 1000);
const boardTime = Math.floor(new Date("2026-09-27T18:32:00.000Z").valueOf() / 1000);
const alightTime = Math.floor(new Date("2026-09-27T19:02:00.000Z").valueOf() / 1000);

const feed = parseTripUpdates(makeFeed(0, true));
if (feed.header.version !== "2.0" || feed.header.timestamp !== observed) throw new Error("feed header was not parsed");
const item = feed.tripUpdates[0];
if (item?.tripId !== "trip-1" || item.routeId !== "route-27" || item.directionId !== 0) throw new Error("trip descriptor was not parsed");

const scheduled: ScheduleOption = {
  origin: "home",
  routeCode: "27",
  routeId: "route-27",
  directionId: 0,
  boardingStopId: "board",
  alightingStopId: "alight",
  trips: [{ tripId: "trip-1", serviceId: "weekday", boardSequence: 3, alightSequence: 10, boardSeconds: 7 * 3600 + 30 * 60, alightSeconds: 8 * 3600 }]
};
const staticCandidate: JourneyCandidate = {
  origin: "home",
  tripId: "trip-1",
  expectedBoarding: "2026-09-27T18:30:00.000Z",
  expectedArrival: "2026-09-27T19:00:00.000Z",
  source: "gtfs-static",
  sourceReference: "static:trip-1",
  confidence: "C",
  uncertaintyMinutes: 5
};

const overlaid = overlayRealtimeCandidates(
  [staticCandidate],
  scheduled,
  feed,
  now,
  120,
  new Date("2026-09-27T18:10:00.000Z"),
  "20260928"
);
if (overlaid.candidates[0]?.confidence !== "A") throw new Error("both target predictions should produce confidence A");
if (overlaid.candidates[0]?.uncertaintyMinutes !== 3) throw new Error("omitted realtime uncertainty must be treated as unknown, not zero");
if (overlaid.candidates[0]?.expectedBoarding !== "2026-09-27T18:32:00.000Z") throw new Error("realtime boarding time mismatch");
console.log("PASS overlays fresh exact realtime and treats omitted uncertainty conservatively");

const canceled = overlayRealtimeCandidates(
  [staticCandidate],
  scheduled,
  parseTripUpdates(makeFeed(3, false)),
  now,
  120,
  new Date("2026-09-27T18:10:00.000Z"),
  "20260928"
);
if (canceled.candidates.length !== 0) throw new Error("canceled realtime trip must remove static fallback");
console.log("PASS cancellation relationship overrides the static trip");

function makeFeed(scheduleRelationship: number, includeStops: boolean): Uint8Array {
  const tripDescriptor = concat(
    field(1, text("trip-1")),
    field(3, text("20260928")),
    varintField(4, scheduleRelationship),
    field(5, text("route-27")),
    varintField(6, 0)
  );
  const parts = [field(1, tripDescriptor)];
  if (includeStops) {
    parts.push(field(2, stop(3, "board", boardTime)));
    parts.push(field(2, stop(10, "alight", alightTime)));
  }
  parts.push(varintField(4, observed));
  const update = concat(...parts);
  const entity = concat(field(1, text("entity-1")), field(3, update));
  const header = concat(field(1, text("2.0")), varintField(3, observed));
  return concat(field(1, header), field(2, entity));
}

function stop(sequence: number, stopId: string, time: number): Uint8Array {
  const event = varintField(2, time); // uncertainty intentionally omitted
  return concat(
    varintField(1, sequence),
    field(2, event),
    field(3, event),
    field(4, text(stopId))
  );
}

function text(value: string): Uint8Array { return encoder.encode(value); }
function field(number: number, value: Uint8Array): Uint8Array {
  return concat(Uint8Array.from(varint(number * 8 + 2)), Uint8Array.from(varint(value.length)), value);
}
function varintField(number: number, value: number): Uint8Array {
  return Uint8Array.from([...varint(number * 8), ...varint(value)]);
}
function varint(value: number): number[] {
  const bytes: number[] = [];
  let current = value;
  while (current >= 128) {
    bytes.push((current % 128) + 128);
    current = Math.floor(current / 128);
  }
  bytes.push(current);
  return bytes;
}
function concat(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}
