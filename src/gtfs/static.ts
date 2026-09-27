import { GTFS_STATIC_URL, checkedFetch } from "../http.js";
import type { JourneyOptionConfig } from "../types.js";
import { parseCsv, type CsvRow } from "./csv.js";
import { unzip } from "./zip.js";

const REQUIRED_FILES = ["routes.txt", "stops.txt", "trips.txt", "stop_times.txt"] as const;
const ZIP_LIMITS = { maxEntries: 64, maxEntryBytes: 50_000_000, maxTotalBytes: 150_000_000 };

export interface GtfsStatic {
  routes: CsvRow[];
  stops: CsvRow[];
  trips: CsvRow[];
  stopTimes: CsvRow[];
  calendar?: CsvRow[];
  calendarDates?: CsvRow[];
}

export async function downloadGtfs(apiKey: string): Promise<GtfsStatic> {
  const bytes = await checkedFetch(GTFS_STATIC_URL, apiKey, 30_000_000);
  return parseGtfsZip(bytes);
}

export async function parseGtfsZip(bytes: Uint8Array): Promise<GtfsStatic> {
  const files = await unzip(bytes, ZIP_LIMITS);
  for (const name of REQUIRED_FILES) if (!files.has(name)) throw new Error(`GTFS file ${name} is missing`);
  if (!files.has("calendar.txt") && !files.has("calendar_dates.txt")) throw new Error("GTFS service calendar is missing");
  const read = (name: string): CsvRow[] => parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(files.get(name)!));
  return {
    routes: read("routes.txt"),
    stops: read("stops.txt"),
    trips: read("trips.txt"),
    stopTimes: read("stop_times.txt"),
    ...(files.has("calendar.txt") ? { calendar: read("calendar.txt") } : {}),
    ...(files.has("calendar_dates.txt") ? { calendarDates: read("calendar_dates.txt") } : {})
  };
}

export function resolveJourneyRouteId(gtfs: GtfsStatic, option: JourneyOptionConfig): string {
  const configured = gtfs.routes.find((row) => row.route_id === option.routeId && row.route_short_name === option.routeCode);
  if (configured?.route_id && routeServesJourneyInOrder(gtfs, configured.route_id, option.boardingStopId, option.alightingStopId)) {
    return configured.route_id;
  }

  const candidates = gtfs.routes
    .filter((row) => row.route_short_name === option.routeCode && row.route_id)
    .map((row) => row.route_id)
    .filter((routeId) => routeServesJourneyInOrder(gtfs, routeId, option.boardingStopId, option.alightingStopId));

  const unique = [...new Set(candidates)];
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 0) throw new Error(`current GTFS has no Route ${option.routeCode} variant serving the configured stops in journey order`);
  throw new Error(`current GTFS has multiple Route ${option.routeCode} variants serving the configured stops; route resolution is ambiguous`);
}

function routeServesJourneyInOrder(gtfs: GtfsStatic, routeId: string, boardingStopId: string, alightingStopId: string): boolean {
  const tripIds = gtfs.trips.filter((row) => row.route_id === routeId).map((row) => row.trip_id).filter(Boolean);
  return tripIds.some((tripId) => {
    const times = gtfs.stopTimes.filter((row) => row.trip_id === tripId);
    const board = Number(times.find((row) => row.stop_id === boardingStopId)?.stop_sequence);
    const alight = Number(times.find((row) => row.stop_id === alightingStopId)?.stop_sequence);
    return Number.isFinite(board) && Number.isFinite(alight) && board < alight;
  });
}

export function validateJourneyIds(gtfs: GtfsStatic, option: JourneyOptionConfig): string[] {
  const errors: string[] = [];
  const route = gtfs.routes.find((row) => row.route_id === option.routeId);
  if (!route) errors.push(`configured route ID for ${option.label} is absent from current GTFS`);
  else if (route.route_short_name !== option.routeCode) errors.push(`configured route ID is not GTFS Route ${option.routeCode}`);
  const stopIds = new Set(gtfs.stops.map((row) => row.stop_id));
  if (!stopIds.has(option.boardingStopId)) errors.push(`boarding stop ID for ${option.label} is absent from current GTFS`);
  if (!stopIds.has(option.alightingStopId)) errors.push(`alighting stop ID for ${option.label} is absent from current GTFS`);
  if (route) {
    const tripIds = new Set(gtfs.trips.filter((row) => row.route_id === option.routeId).map((row) => row.trip_id));
    const relevantStopTimes = gtfs.stopTimes.filter((row) => tripIds.has(row.trip_id));
    const servedStops = new Set(relevantStopTimes.map((row) => row.stop_id));
    if (stopIds.has(option.boardingStopId) && !servedStops.has(option.boardingStopId)) errors.push(`Route ${option.routeCode} does not serve the configured boarding stop in current GTFS`);
    if (stopIds.has(option.alightingStopId) && !servedStops.has(option.alightingStopId)) errors.push(`Route ${option.routeCode} does not serve the configured alighting stop in current GTFS`);
    if (servedStops.has(option.boardingStopId) && servedStops.has(option.alightingStopId)) {
      const usableTrip = [...tripIds].some((tripId) => {
        const times = relevantStopTimes.filter((row) => row.trip_id === tripId);
        const board = Number(times.find((row) => row.stop_id === option.boardingStopId)?.stop_sequence);
        const alight = Number(times.find((row) => row.stop_id === option.alightingStopId)?.stop_sequence);
        return Number.isFinite(board) && Number.isFinite(alight) && board < alight;
      });
      if (!usableTrip) errors.push(`current GTFS has no Route ${option.routeCode} trip serving the configured stops in journey order`);
    }
  }
  return errors;
}

export function activeServiceIdsOnDate(gtfs: GtfsStatic, date: string): Set<string> {
  if (!/^\d{8}$/u.test(date)) throw new Error("GTFS service date must be YYYYMMDD");
  const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error("GTFS service date is invalid");
  const dayColumns = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const day = dayColumns[parsed.getUTCDay()]!;
  const active = new Set<string>();
  for (const row of gtfs.calendar ?? []) {
    if (row.service_id && row.start_date && row.end_date && row.start_date <= date && date <= row.end_date && row[day] === "1") active.add(row.service_id);
  }
  for (const exception of gtfs.calendarDates ?? []) {
    if (exception.date !== date) continue;
    if (!exception.service_id) continue;
    if (exception.exception_type === "1") active.add(exception.service_id);
    else if (exception.exception_type === "2") active.delete(exception.service_id);
  }
  return active;
}
