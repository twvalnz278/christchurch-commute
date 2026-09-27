import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { activeServiceIdsOnDate, parseGtfsZip } from "../dist/src/gtfs/static.js";

const arguments_ = process.argv.slice(2);
const input = resolve(arguments_[0] && arguments_[0] !== "--output" ? arguments_[0] : "data/production/gtfs.zip");
const outputIndex = arguments_.indexOf("--output");
const output = outputIndex >= 0 && arguments_[outputIndex + 1] ? resolve(arguments_[outputIndex + 1]) : undefined;
const dateIndex = arguments_.indexOf("--date");
const serviceDate = dateIndex >= 0 && arguments_[dateIndex + 1] ? arguments_[dateIndex + 1] : nzServiceDate();
const gtfs = await parseGtfsZip(new Uint8Array(await readFile(input)));
const activeServiceIds = activeServiceIdsOnDate(gtfs, serviceDate);
const targetRoutes = gtfs.routes.filter((route) => route.route_short_name === "27" || route.route_short_name === "1");
const stopById = new Map(gtfs.stops.map((stop) => [stop.stop_id, stop]));
const timesByTrip = new Map();
for (const time of gtfs.stopTimes) {
  const values = timesByTrip.get(time.trip_id) ?? [];
  values.push(time);
  timesByTrip.set(time.trip_id, values);
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceFile: input,
  warning: "Candidate pools only. A human must verify boarding/alighting stops, direction, walking route, and service day before configuration.",
  privateHomeAddressIncluded: false,
  serviceDate,
  activeServiceIds: [...activeServiceIds],
  routes: targetRoutes.map((route) => describeRoute(route))
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, json, { mode: 0o600 });
  console.log(`Discovery report saved to ${output}. It contains public GTFS stop coordinates but no private home address.`);
} else process.stdout.write(json);

function describeRoute(route) {
  const trips = gtfs.trips.filter((trip) => trip.route_id === route.route_id);
  const patterns = new Map();
  for (const trip of trips) {
    const ordered = [...(timesByTrip.get(trip.trip_id) ?? [])]
      .sort((left, right) => Number(left.stop_sequence) - Number(right.stop_sequence))
      .map((time) => publicStop(time));
    const key = JSON.stringify([trip.trip_headsign ?? "", trip.direction_id ?? "", ordered.map((stop) => stop.stop_id)]);
    const existing = patterns.get(key);
    if (existing) {
      existing.trip_ids.push(trip.trip_id);
      existing.service_ids = [...new Set([...existing.service_ids, trip.service_id])];
      existing.active_on_service_date ||= activeServiceIds.has(trip.service_id);
    } else patterns.set(key, { trip_headsign: trip.trip_headsign ?? "", direction_id: trip.direction_id ?? "", trip_ids: [trip.trip_id], service_ids: [trip.service_id], active_on_service_date: activeServiceIds.has(trip.service_id), ordered_stops: ordered });
  }
  const directionTerms = route.route_short_name === "27" ? /huntsbury|christchurch|city/iu : /cashmere|christchurch|city/iu;
  const relevantPatterns = [...patterns.values()].filter((pattern) => directionTerms.test(pattern.trip_headsign));
  const candidatePatterns = relevantPatterns.length ? relevantPatterns : [...patterns.values()];
  return {
    route_short_name: route.route_short_name,
    route_id: route.route_id,
    route_long_name: route.route_long_name ?? "",
    observed_trip_headsings: [...new Set(trips.map((trip) => trip.trip_headsign ?? ""))],
    observed_direction_ids: [...new Set(trips.map((trip) => trip.direction_id ?? ""))],
    direction_filter_note: relevantPatterns.length
      ? "Candidate patterns match the user-provided Huntsbury/Christchurch-city or Cashmere/Christchurch-city direction terms; verify manually."
      : "No headsign matched the expected direction terms, so all patterns are included and must be reviewed manually.",
    trip_patterns: [...patterns.values()],
    all_stops_served: uniqueStops([...patterns.values()].flatMap((pattern) => pattern.ordered_stops)),
    candidate_direction_trip_patterns: candidatePatterns,
    candidate_stops_for_human_review: uniqueStops(candidatePatterns.flatMap((pattern) => pattern.ordered_stops))
  };
}

function nzServiceDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
}

function publicStop(time) {
  const stop = stopById.get(time.stop_id) ?? {};
  return {
    stop_sequence: time.stop_sequence,
    stop_id: time.stop_id,
    stop_name: stop.stop_name ?? "",
    stop_lat: stop.stop_lat ?? "",
    stop_lon: stop.stop_lon ?? ""
  };
}

function uniqueStops(stops) {
  return [...new Map(stops.map((stop) => [stop.stop_id, { stop_id: stop.stop_id, stop_name: stop.stop_name, stop_lat: stop.stop_lat, stop_lon: stop.stop_lon }])).values()];
}
