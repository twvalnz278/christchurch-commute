import { parseTripUpdates } from "../src/gtfs-realtime/trip-updates.js";

const encoder = new TextEncoder();
const field = (number: number, value: Uint8Array) => Uint8Array.from([number * 8 + 2, value.length, ...value]);
const text = (value: string) => encoder.encode(value);
const varintField = (number: number, value: number) => Uint8Array.from([number * 8, ...varint(value)]);

const tripDescriptor = Uint8Array.from([
  ...field(1, text("trip-1")),
  ...field(5, text("route-27")),
  ...varintField(6, 0)
]);
const event = (time: number) => Uint8Array.from([...varintField(2, time), ...varintField(3, 30)]);
const stop = (seq: number, stopId: string, time: number) => Uint8Array.from([
  ...varintField(1, seq),
  ...field(2, event(time)),
  ...field(3, event(time)),
  ...field(4, text(stopId))
]);
const update = Uint8Array.from([
  ...field(1, tripDescriptor),
  ...field(2, stop(1, "board", 1_800_000_000)),
  ...field(2, stop(2, "alight", 1_800_001_200)),
  ...varintField(4, 1_799_999_900)
]);
const entity = Uint8Array.from([...field(1, text("entity-1")), ...field(3, update)]);
const header = Uint8Array.from([...field(1, text("2.0")), ...varintField(3, 1_799_999_900)]);
const feed = Uint8Array.from([...field(1, header), ...field(2, entity)]);

const parsed = parseTripUpdates(feed);
if (parsed.header.version !== "2.0") throw new Error("GTFS-RT version was not parsed");
if (parsed.header.timestamp !== 1_799_999_900) throw new Error("feed timestamp was not parsed");
const item = parsed.tripUpdates[0];
if (item?.tripId !== "trip-1" || item.routeId !== "route-27" || item.directionId !== 0) throw new Error("trip descriptor was not parsed");
if (item.stopTimeUpdates[0]?.stopId !== "board" || item.stopTimeUpdates[1]?.arrival?.time !== 1_800_001_200) throw new Error("stop time updates were not parsed");
console.log("PASS parses official GTFS-Realtime Trip Updates fields");

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
