import { dateForServiceSeconds, localServiceDate, weekdayBitForServiceDate } from "./deadline.js";
import type { JourneyCandidate, JourneyConfig, JourneyOptionConfig, Origin } from "./types.js";

export const STATIC_UNCERTAINTY_MINUTES = 5;

export interface ScheduleTrip {
  tripId: string;
  serviceId: string;
  boardSequence: number;
  alightSequence: number;
  boardSeconds: number;
  alightSeconds: number;
}

export interface ScheduleOption {
  origin: Origin;
  routeCode: "27" | "1";
  routeId: string;
  directionId: number;
  boardingStopId: string;
  alightingStopId: string;
  trips: ScheduleTrip[];
}

export interface ScheduleService {
  serviceId: string;
  startDate: string;
  endDate: string;
  weekdayMask: number;
  exceptions?: Record<string, 1 | 2>;
}

export interface JourneySchedule {
  version: 1 | 2;
  generatedAt: string;
  timeZone: "Pacific/Auckland";
  options: ScheduleOption[];
  services: ScheduleService[];
}

type CompactTrip = [string, string, number, number, number, number];
type CompactOption = [Origin, "27" | "1", string, number, string, string, CompactTrip[]];
type CompactService = [string, string, string, number, Record<string, 1 | 2>?];
interface CompactJourneySchedule {
  v: 2;
  g: string;
  z: "Pacific/Auckland";
  o: CompactOption[];
  s: CompactService[];
}

export function parseJourneySchedule(raw: string | undefined, config: JourneyConfig): JourneySchedule {
  if (!raw) throw new Error("JOURNEY_SCHEDULE secret is missing");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("JOURNEY_SCHEDULE must be an object");

  const schedule = isCompactSchedule(value)
    ? expandCompactSchedule(value)
    : value as Partial<JourneySchedule>;

  if (schedule.version !== 1 && schedule.version !== 2) throw new Error("JOURNEY_SCHEDULE version is unsupported");
  if (schedule.timeZone !== config.timeZone) throw new Error("JOURNEY_SCHEDULE timeZone does not match JOURNEY_CONFIG");
  if (!schedule.generatedAt || Number.isNaN(new Date(schedule.generatedAt).valueOf())) throw new Error("JOURNEY_SCHEDULE generatedAt is invalid");
  if (!Array.isArray(schedule.options) || schedule.options.length !== 2) throw new Error("JOURNEY_SCHEDULE must contain home and gym options");
  if (!Array.isArray(schedule.services) || schedule.services.length === 0) throw new Error("JOURNEY_SCHEDULE has no service rules");

  for (const configOption of config.options) {
    const option = schedule.options.find((item) => item.origin === configOption.origin);
    if (!option) throw new Error(`JOURNEY_SCHEDULE is missing ${configOption.origin}`);
    if (option.routeCode !== configOption.routeCode) throw new Error(`JOURNEY_SCHEDULE route mismatch for ${configOption.origin}`);
    if (option.boardingStopId !== configOption.boardingStopId || option.alightingStopId !== configOption.alightingStopId) {
      throw new Error(`JOURNEY_SCHEDULE stop IDs do not match JOURNEY_CONFIG for ${configOption.origin}`);
    }
    if (!Array.isArray(option.trips) || option.trips.length === 0) throw new Error(`JOURNEY_SCHEDULE has no trips for ${configOption.origin}`);
    for (const trip of option.trips) {
      if (!trip.tripId || !trip.serviceId) throw new Error("JOURNEY_SCHEDULE trip IDs/service IDs are required");
      if (!Number.isInteger(trip.boardSequence) || !Number.isInteger(trip.alightSequence) || trip.boardSequence >= trip.alightSequence) {
        throw new Error("JOURNEY_SCHEDULE stop sequence is invalid");
      }
      if (!Number.isFinite(trip.boardSeconds) || !Number.isFinite(trip.alightSeconds) || trip.boardSeconds < 0 || trip.alightSeconds <= trip.boardSeconds) {
        throw new Error("JOURNEY_SCHEDULE trip times are invalid");
      }
    }
  }
  return schedule as JourneySchedule;
}

export function staticCandidates(
  schedule: JourneySchedule,
  option: JourneyOptionConfig,
  now: Date,
  walkingBufferMinutes: number,
  boardingLeadMinutes: number
): JourneyCandidate[] {
  const scheduled = schedule.options.find((item) => item.origin === option.origin);
  if (!scheduled) return [];
  const serviceDate = localServiceDate(now, schedule.timeZone);
  const active = activeServiceIds(schedule, serviceDate);
  const readyAt = now.valueOf() + (option.accessWalkingMinutes + walkingBufferMinutes + boardingLeadMinutes) * 60_000;

  const candidates: JourneyCandidate[] = [];
  for (const trip of scheduled.trips) {
    if (!active.has(trip.serviceId)) continue;
    const boarding = dateForServiceSeconds(serviceDate, trip.boardSeconds, schedule.timeZone);
    const arrival = dateForServiceSeconds(serviceDate, trip.alightSeconds, schedule.timeZone);
    if (boarding.valueOf() < readyAt || arrival <= boarding) continue;
    candidates.push({
      origin: option.origin,
      tripId: trip.tripId,
      expectedBoarding: boarding.toISOString(),
      expectedArrival: arrival.toISOString(),
      source: "gtfs-static",
      sourceReference: `static:${trip.tripId}`,
      confidence: "C",
      uncertaintyMinutes: STATIC_UNCERTAINTY_MINUTES,
      note: "Static GTFS fallback; realtime prediction is not yet available for this trip."
    });
  }
  return candidates;
}

export function scheduleOption(schedule: JourneySchedule, origin: Origin): ScheduleOption {
  const value = schedule.options.find((option) => option.origin === origin);
  if (!value) throw new Error(`JOURNEY_SCHEDULE is missing ${origin}`);
  return value;
}

function activeServiceIds(schedule: JourneySchedule, serviceDate: string): Set<string> {
  const weekdayBit = weekdayBitForServiceDate(serviceDate);
  const active = new Set<string>();
  for (const service of schedule.services) {
    const exception = service.exceptions?.[serviceDate];
    if (exception === 1) {
      active.add(service.serviceId);
      continue;
    }
    if (exception === 2) continue;
    if (service.startDate <= serviceDate && serviceDate <= service.endDate && (service.weekdayMask & weekdayBit) !== 0) {
      active.add(service.serviceId);
    }
  }
  return active;
}

function isCompactSchedule(value: unknown): value is CompactJourneySchedule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CompactJourneySchedule>;
  return candidate.v === 2 && Array.isArray(candidate.o) && Array.isArray(candidate.s);
}

function expandCompactSchedule(value: CompactJourneySchedule): JourneySchedule {
  return {
    version: 2,
    generatedAt: value.g,
    timeZone: value.z,
    options: value.o.map((option) => ({
      origin: option[0],
      routeCode: option[1],
      routeId: option[2],
      directionId: option[3],
      boardingStopId: option[4],
      alightingStopId: option[5],
      trips: option[6].map((trip) => ({
        tripId: trip[0],
        serviceId: trip[1],
        boardSequence: trip[2],
        alightSequence: trip[3],
        boardSeconds: trip[4],
        alightSeconds: trip[5]
      }))
    })),
    services: value.s.map((service) => ({
      serviceId: service[0],
      startDate: service[1],
      endDate: service[2],
      weekdayMask: service[3],
      ...(service[4] && Object.keys(service[4]).length ? { exceptions: service[4] } : {})
    }))
  };
}
