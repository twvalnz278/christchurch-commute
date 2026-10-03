import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseGtfsZip } from "../dist/src/gtfs/static.js";

const input = resolve(process.argv[2] ?? "data/production/gtfs.zip");
const configPath = resolve(process.argv[3] ?? "data/private/journey-config.private.json");
const output = resolve(process.argv[4] ?? "data/private/journey-schedule.private.json");

const gtfs = await parseGtfsZip(new Uint8Array(await readFile(input)));
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.options) || config.options.length !== 2) fail("Private journey config must contain exactly two options.");

const servicesNeeded = new Set();
const options = config.options.map((option) => buildOption(option));
const services = [...servicesNeeded].map((serviceId) => buildService(serviceId));
const schedule = {
  v: 2,
  g: new Date().toISOString(),
  z: "Pacific/Auckland",
  o: options.map((option) => [
    option.origin,
    option.routeCode,
    option.routeId,
    option.directionId,
    option.boardingStopId,
    option.alightingStopId,
    option.trips.map((trip) => [
      trip.tripId,
      trip.serviceId,
      trip.boardSequence,
      trip.alightSequence,
      trip.boardSeconds,
      trip.alightSeconds
    ])
  ]),
  s: services.map((service) => [
    service.serviceId,
    service.startDate,
    service.endDate,
    service.weekdayMask,
    service.exceptions ?? {}
  ])
};
const json = JSON.stringify(schedule);
if (Buffer.byteLength(json, "utf8") > 4_900) {
  fail(`Generated JOURNEY_SCHEDULE is ${Buffer.byteLength(json, "utf8")} bytes; Cloudflare's per-variable limit is 5 KB even after compact encoding.`);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, json, { mode: 0o600 });
console.log(`Validated compact v2 JOURNEY_SCHEDULE written to ${output} (${Buffer.byteLength(json, "utf8")} bytes).`);
console.log("It contains public Metro route/stop/trip schedule data only; no private home address is copied.");

function buildOption(option) {
  if (option.origin !== "home" && option.origin !== "gym") fail("Config origin must be home or gym.");
  if (!option.routeCode || !option.boardingStopId || !option.alightingStopId) fail(`Missing route/stops for ${option.origin}.`);

  const routeIds = routeCandidates(option);
  const tripRows = gtfs.trips.filter((trip) => routeIds.includes(trip.route_id));
  const usable = [];

  for (const trip of tripRows) {
    const times = gtfs.stopTimes
      .filter((time) => time.trip_id === trip.trip_id)
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    const board = times.find((time) => time.stop_id === option.boardingStopId);
    const alight = times.find((time) => time.stop_id === option.alightingStopId);
    if (!board || !alight) continue;
    const boardSequence = Number(board.stop_sequence);
    const alightSequence = Number(alight.stop_sequence);
    if (!Number.isInteger(boardSequence) || !Number.isInteger(alightSequence) || boardSequence >= alightSequence) continue;

    // GTFS pickup/drop-off type 1 means passengers may not board/alight.
    // This excludes Route 1 express trips that pass the Belfast Rd stop without pickup.
    if ((board.pickup_type ?? "0") === "1" || (alight.drop_off_type ?? "0") === "1") continue;

    const boardSeconds = parseGtfsTime(board.departure_time || board.arrival_time);
    const alightSeconds = parseGtfsTime(alight.arrival_time || alight.departure_time);
    if (boardSeconds === undefined || alightSeconds === undefined || alightSeconds <= boardSeconds) continue;

    // Keep only morning trips that could possibly satisfy the 08:30 hard deadline.
    if (boardSeconds < 4 * 3600 || boardSeconds > 8.5 * 3600 || alightSeconds > 8.5 * 3600) continue;
    if (!trip.trip_id || !trip.service_id || !serviceCanRunWeekday(trip.service_id)) continue;
    servicesNeeded.add(trip.service_id);
    usable.push({
      tripId: trip.trip_id,
      serviceId: trip.service_id,
      boardSequence,
      alightSequence,
      boardSeconds,
      alightSeconds,
      routeId: trip.route_id,
      directionId: Number(trip.direction_id || 0)
    });
  }

  if (usable.length === 0) fail(`No usable morning Route ${option.routeCode} trips serve ${option.boardingStopId} → ${option.alightingStopId} with legal pickup/drop-off.`);
  const routeIdsUsed = [...new Set(usable.map((trip) => trip.routeId))];
  const directions = [...new Set(usable.map((trip) => trip.directionId))];
  if (routeIdsUsed.length !== 1 || directions.length !== 1) {
    fail(`${option.origin} journey is ambiguous across route variants/directions; verify the configured stops.`);
  }

  return {
    origin: option.origin,
    routeCode: option.routeCode,
    routeId: routeIdsUsed[0],
    directionId: directions[0],
    boardingStopId: option.boardingStopId,
    alightingStopId: option.alightingStopId,
    trips: usable
      .sort((a, b) => a.boardSeconds - b.boardSeconds)
      .map(({ routeId, directionId, ...trip }) => trip)
  };
}

function routeCandidates(option) {
  const exact = gtfs.routes.find((route) => route.route_id === option.routeId && route.route_short_name === option.routeCode);
  if (exact?.route_id) return [exact.route_id];
  const ids = gtfs.routes
    .filter((route) => route.route_short_name === option.routeCode && route.route_id)
    .map((route) => route.route_id);
  if (ids.length === 0) fail(`No current GTFS route has route_short_name ${option.routeCode}.`);
  return ids;
}

function serviceCanRunWeekday(serviceId) {
  const calendar = (gtfs.calendar ?? []).find((row) => row.service_id === serviceId);
  if (calendar && ["monday","tuesday","wednesday","thursday","friday"].some((day) => calendar[day] === "1")) return true;
  return (gtfs.calendarDates ?? []).some((row) => {
    if (row.service_id !== serviceId || row.exception_type !== "1" || !/^\d{8}$/u.test(row.date ?? "")) return false;
    const date = row.date;
    const day = new Date(Date.UTC(Number(date.slice(0,4)), Number(date.slice(4,6)) - 1, Number(date.slice(6,8)))).getUTCDay();
    return day >= 1 && day <= 5;
  });
}

function buildService(serviceId) {
  const calendar = (gtfs.calendar ?? []).find((row) => row.service_id === serviceId);
  const weekdayMask = calendar
    ? ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
        .reduce((mask, day, index) => mask | (calendar[day] === "1" ? (1 << index) : 0), 0)
    : 0;
  const exceptions = {};
  for (const row of gtfs.calendarDates ?? []) {
    if (row.service_id !== serviceId || !/^\d{8}$/u.test(row.date ?? "")) continue;
    if (row.exception_type === "1" || row.exception_type === "2") exceptions[row.date] = Number(row.exception_type);
  }
  return {
    serviceId,
    startDate: calendar?.start_date ?? "00000000",
    endDate: calendar?.end_date ?? "99999999",
    weekdayMask,
    ...(Object.keys(exceptions).length ? { exceptions } : {})
  };
}

function parseGtfsTime(value) {
  if (!value) return undefined;
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
