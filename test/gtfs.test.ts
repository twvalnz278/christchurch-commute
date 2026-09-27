import { activeServiceIdsOnDate, parseGtfsZip, resolveJourneyRouteId } from "../src/gtfs/static.js";

const encoder = new TextEncoder();
const files: Record<string, string> = {
  "routes.txt": "route_id,route_short_name\nr27,27\n",
  "stops.txt": "stop_id,stop_name\na,Fixture A\nb,Fixture B\n",
  "trips.txt": "route_id,service_id,trip_id\nr27,weekday,t1\n",
  "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,08:00:00,08:00:00,a,1\nt1,08:20:00,08:20:00,b,2\n",
  "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20260101,20261231\n"
};

const gtfs = await parseGtfsZip(makeStoredZip(files));
if (gtfs.routes[0]?.route_short_name !== "27") throw new Error("routes.txt was not parsed");
if (gtfs.stops.length !== 2 || gtfs.stopTimes.length !== 2) throw new Error("GTFS table row counts are wrong");
console.log("PASS safely parses a bounded synthetic GTFS ZIP fixture");
if (!activeServiceIdsOnDate(gtfs, "20260928").has("weekday")) throw new Error("Monday service should derive from calendar.txt");
const excepted = { ...gtfs, calendarDates: [{ service_id: "weekday", date: "20260928", exception_type: "2" }, { service_id: "special", date: "20260928", exception_type: "1" }] };
const active = activeServiceIdsOnDate(excepted, "20260928");
if (active.has("weekday") || !active.has("special")) throw new Error("calendar_dates exceptions were not applied");
console.log("PASS derives service by date from calendar and calendar_dates");

try {
  await parseGtfsZip(makeStoredZip({ ...files, "../escape.txt": "unsafe" }));
  throw new Error("unsafe entry name was accepted");
} catch (error) {
  if (error instanceof Error && error.message === "unsafe entry name was accepted") throw error;
  console.log("PASS rejects ZIP path traversal");
}

function makeStoredZip(entries: Record<string, string>): Uint8Array {
  const locals: number[] = [];
  const central: number[] = [];
  let localOffset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const crc = crc32(data);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...data];
    locals.push(...local);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(localOffset), ...nameBytes);
    localOffset += local.length;
  }
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(entries).length), ...u16(Object.keys(entries).length), ...u32(central.length), ...u32(locals.length), ...u16(0)];
  return Uint8Array.from([...locals, ...central, ...eocd]);
}

function u16(value: number): number[] { return [value & 255, (value >>> 8) & 255]; }
function u32(value: number): number[] { return [...u16(value), ...u16(value >>> 16)]; }
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const resolved = resolveJourneyRouteId(gtfs, {
  origin: "home",
  label: "fixture",
  routeCode: "27",
  routeId: "stale-route-id",
  originDescription: "private",
  boardingStopId: "a",
  alightingStopId: "b",
  accessWalkingMinutes: 1,
  egressWalkingMinutes: 1,
  transferCount: 0
});
if (resolved !== "r27") throw new Error("Route 27 should auto-resolve from current GTFS stops/order");
console.log("PASS auto-resolves a changed GTFS route_id from route code and stop order");
