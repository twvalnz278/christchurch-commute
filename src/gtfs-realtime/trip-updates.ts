import { TRIP_UPDATES_URL, checkedFetch } from "../http.js";
import { isFresh } from "../freshness.js";
import type { ScheduleOption } from "../schedule.js";
import type { JourneyCandidate } from "../types.js";

const UNKNOWN_REALTIME_UNCERTAINTY_MINUTES = 3;
const TRIP_CANCELED = 3;
const TRIP_REPLACEMENT = 5;
const TRIP_DELETED = 7;
const STOP_SKIPPED = 1;
const STOP_NO_DATA = 2;

interface FeedHeader { version: string; timestamp?: number }
interface StopTimeEvent { time?: number; delay?: number; uncertainty?: number }
interface StopTimeUpdate {
  stopSequence?: number;
  stopId?: string;
  arrival?: StopTimeEvent;
  departure?: StopTimeEvent;
  scheduleRelationship?: number;
}
interface TripUpdate {
  id: string;
  tripId?: string;
  routeId?: string;
  directionId?: number;
  startDate?: string;
  scheduleRelationship?: number;
  timestamp?: number;
  stopTimeUpdates: StopTimeUpdate[];
}

export interface TripUpdatesFeed {
  header: FeedHeader;
  tripUpdates: TripUpdate[];
}

export async function downloadTripUpdates(apiKey: string): Promise<TripUpdatesFeed> {
  return parseTripUpdates(await checkedFetch(TRIP_UPDATES_URL, apiKey, 10_000_000));
}

export function overlayRealtimeCandidates(
  staticCandidates: JourneyCandidate[],
  scheduled: ScheduleOption,
  feed: TripUpdatesFeed,
  now: Date,
  freshnessSeconds: number,
  readyAt: Date,
  serviceDate: string
): { candidates: JourneyCandidate[]; note: string } {
  const feedTimestamp = feed.header.timestamp;
  if (!feedTimestamp) return { candidates: staticCandidates, note: "GTFS-Realtime timestamp missing; using static GTFS fallback." };
  const observedAt = new Date(feedTimestamp * 1000);
  if (!isFresh(observedAt.toISOString(), now, freshnessSeconds)) {
    return { candidates: staticCandidates, note: "GTFS-Realtime feed is stale/future-dated; using static GTFS fallback." };
  }

  const updateByTrip = new Map<string, TripUpdate>();
  for (const update of feed.tripUpdates) {
    if (update.tripId) updateByTrip.set(update.tripId, update);
  }
  const scheduleByTrip = new Map(scheduled.trips.map((trip) => [trip.tripId, trip]));
  const output: JourneyCandidate[] = [];
  let realtimeCount = 0;
  let cancelledCount = 0;

  for (const candidate of staticCandidates) {
    const update = updateByTrip.get(candidate.tripId);
    const trip = scheduleByTrip.get(candidate.tripId);
    if (!update || !trip) {
      output.push(candidate);
      continue;
    }
    if (update.startDate && update.startDate !== serviceDate) {
      output.push(candidate);
      continue;
    }
    if (update.routeId && update.routeId !== scheduled.routeId) {
      output.push(candidate);
      continue;
    }
    if (update.directionId !== undefined && update.directionId !== scheduled.directionId) {
      output.push(candidate);
      continue;
    }
    if (update.scheduleRelationship === TRIP_CANCELED ||
        update.scheduleRelationship === TRIP_REPLACEMENT ||
        update.scheduleRelationship === TRIP_DELETED) {
      cancelledCount++;
      continue;
    }

    const boardUpdate = findStopUpdate(update, scheduled.boardingStopId, trip.boardSequence);
    const alightUpdate = findStopUpdate(update, scheduled.alightingStopId, trip.alightSequence);
    if (boardUpdate?.scheduleRelationship === STOP_SKIPPED || alightUpdate?.scheduleRelationship === STOP_SKIPPED) {
      cancelledCount++;
      continue;
    }

    const scheduledBoardMs = new Date(candidate.expectedBoarding).valueOf();
    const scheduledArrivalMs = new Date(candidate.expectedArrival).valueOf();
    let board = resolveEvent(boardUpdate, "departure", scheduledBoardMs);
    let alight = resolveEvent(alightUpdate, "arrival", scheduledArrivalMs);

    // GTFS-RT permits propagation of the last known delay to following stops.
    // Propagate from the boarding stop only when there is no intervening update
    // that could supersede or terminate that propagation.
    if (board && !alight && canPropagateBoardDelay(update, trip.boardSequence, trip.alightSequence, alightUpdate)) {
      const delayMs = board.timeMs - scheduledBoardMs;
      alight = { timeMs: scheduledArrivalMs + delayMs, uncertaintyMinutes: board.uncertaintyMinutes };
    }

    if (!board && boardUpdate?.scheduleRelationship === STOP_NO_DATA) board = undefined;
    if (!alight && alightUpdate?.scheduleRelationship === STOP_NO_DATA) alight = undefined;

    const hasRealtime = Boolean(board || alight);
    const expectedBoardingMs = board?.timeMs ?? scheduledBoardMs;
    const expectedArrivalMs = alight?.timeMs ?? scheduledArrivalMs;
    if (expectedBoardingMs < readyAt.valueOf() || expectedArrivalMs <= expectedBoardingMs) continue;

    if (!hasRealtime) {
      output.push(candidate);
      continue;
    }

    realtimeCount++;
    const directBoth = Boolean(board && alight);
    const uncertaintyMinutes = Math.max(
      board?.uncertaintyMinutes ?? 0,
      alight?.uncertaintyMinutes ?? 0,
      directBoth ? 0 : UNKNOWN_REALTIME_UNCERTAINTY_MINUTES
    );
    output.push({
      ...candidate,
      expectedBoarding: new Date(expectedBoardingMs).toISOString(),
      expectedArrival: new Date(expectedArrivalMs).toISOString(),
      source: "gtfs-rt-trip-updates",
      sourceReference: `trip:${candidate.tripId}`,
      confidence: directBoth ? "A" : "B",
      uncertaintyMinutes,
      observedAt: observedAt.toISOString(),
      note: directBoth
        ? "Fresh GTFS-Realtime prediction at both configured stops."
        : "Fresh GTFS-Realtime prediction is partial; missing target time falls back to static GTFS."
    });
  }

  const note = `GTFS-Realtime fresh: ${realtimeCount} candidate(s) enhanced; ${cancelledCount} canceled/replaced/skipped candidate(s) removed.`;
  return { candidates: output, note };
}

function findStopUpdate(update: TripUpdate, stopId: string, stopSequence: number): StopTimeUpdate | undefined {
  return update.stopTimeUpdates.find((item) =>
    item.stopId === stopId || (item.stopSequence !== undefined && item.stopSequence === stopSequence)
  );
}

function resolveEvent(
  update: StopTimeUpdate | undefined,
  preferred: "arrival" | "departure",
  scheduledMs: number
): { timeMs: number; uncertaintyMinutes: number } | undefined {
  if (!update || update.scheduleRelationship === STOP_SKIPPED || update.scheduleRelationship === STOP_NO_DATA) return undefined;
  const primary = preferred === "arrival" ? update.arrival : update.departure;
  const secondary = preferred === "arrival" ? update.departure : update.arrival;
  const event = primary ?? secondary;
  if (!event) return undefined;
  const timeMs = event.time !== undefined
    ? event.time * 1000
    : event.delay !== undefined
      ? scheduledMs + event.delay * 1000
      : undefined;
  if (timeMs === undefined || !Number.isFinite(timeMs)) return undefined;
  const uncertaintyMinutes = event.uncertainty === undefined || event.uncertainty < 0
    ? UNKNOWN_REALTIME_UNCERTAINTY_MINUTES
    : Math.ceil(event.uncertainty / 60);
  return { timeMs, uncertaintyMinutes };
}

function canPropagateBoardDelay(
  update: TripUpdate,
  boardSequence: number,
  alightSequence: number,
  alightUpdate: StopTimeUpdate | undefined
): boolean {
  if (alightUpdate) return false;
  return !update.stopTimeUpdates.some((item) =>
    item.stopSequence !== undefined &&
    item.stopSequence > boardSequence &&
    item.stopSequence < alightSequence
  );
}

/** Decodes the official GTFS-Realtime FeedMessage/TripUpdate subset used by this project. */
export function parseTripUpdates(bytes: Uint8Array): TripUpdatesFeed {
  const reader = new ProtoReader(bytes);
  let header: FeedHeader | undefined;
  const tripUpdates: TripUpdate[] = [];
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) header = parseHeader(reader.message());
    else if (field === 2 && wire === 2) {
      const entity = parseEntity(reader.message());
      if (entity) tripUpdates.push(entity);
    } else reader.skip(wire);
  }
  if (!header?.version) throw new Error("GTFS-Realtime header or version is missing");
  return { header, tripUpdates };
}

function parseHeader(reader: ProtoReader): FeedHeader {
  let version = "";
  let timestamp: number | undefined;
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) version = reader.string();
    else if (field === 3 && wire === 0) timestamp = reader.uint();
    else reader.skip(wire);
  }
  return { version, ...(timestamp === undefined ? {} : { timestamp }) };
}

function parseEntity(reader: ProtoReader): TripUpdate | undefined {
  let id = "";
  let deleted = false;
  let update: TripUpdate | undefined;
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) id = reader.string();
    else if (field === 2 && wire === 0) deleted = reader.uint() !== 0;
    else if (field === 3 && wire === 2) update = parseTripUpdate(id, reader.message());
    else reader.skip(wire);
  }
  return deleted ? undefined : update;
}

function parseTripUpdate(id: string, reader: ProtoReader): TripUpdate {
  const update: TripUpdate = { id, stopTimeUpdates: [] };
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) Object.assign(update, parseTripDescriptor(reader.message()));
    else if (field === 2 && wire === 2) update.stopTimeUpdates.push(parseStopTimeUpdate(reader.message()));
    else if (field === 4 && wire === 0) update.timestamp = reader.uint();
    else reader.skip(wire);
  }
  return update;
}

function parseTripDescriptor(reader: ProtoReader): Pick<TripUpdate, "tripId" | "routeId" | "directionId" | "startDate" | "scheduleRelationship"> {
  const result: Pick<TripUpdate, "tripId" | "routeId" | "directionId" | "startDate" | "scheduleRelationship"> = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) result.tripId = reader.string();
    else if (field === 3 && wire === 2) result.startDate = reader.string();
    else if (field === 4 && wire === 0) result.scheduleRelationship = reader.uint();
    else if (field === 5 && wire === 2) result.routeId = reader.string();
    else if (field === 6 && wire === 0) result.directionId = reader.uint();
    else reader.skip(wire);
  }
  return result;
}

function parseStopTimeUpdate(reader: ProtoReader): StopTimeUpdate {
  const result: StopTimeUpdate = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 0) result.stopSequence = reader.uint();
    else if (field === 2 && wire === 2) result.arrival = parseStopTimeEvent(reader.message());
    else if (field === 3 && wire === 2) result.departure = parseStopTimeEvent(reader.message());
    else if (field === 4 && wire === 2) result.stopId = reader.string();
    else if (field === 5 && wire === 0) result.scheduleRelationship = reader.uint();
    else reader.skip(wire);
  }
  return result;
}

function parseStopTimeEvent(reader: ProtoReader): StopTimeEvent {
  const result: StopTimeEvent = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 0) result.delay = reader.int32();
    else if (field === 2 && wire === 0) result.time = reader.uint();
    else if (field === 3 && wire === 0) result.uncertainty = reader.int32();
    else reader.skip(wire);
  }
  return result;
}

class ProtoReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get done(): boolean { return this.offset >= this.bytes.length; }
  tag(): [number, number] {
    const tag = this.uint();
    const field = Math.floor(tag / 8);
    if (!field) throw new Error("invalid protobuf field number");
    return [field, tag & 7];
  }
  uint(): number {
    const value = this.varintBigInt();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("protobuf integer exceeds JavaScript safe range");
    return Number(value);
  }
  int32(): number {
    return Number(BigInt.asIntN(32, this.varintBigInt()));
  }
  string(): string { return new TextDecoder("utf-8", { fatal: true }).decode(this.bytesForLength()); }
  message(): ProtoReader { return new ProtoReader(this.bytesForLength()); }
  skip(wire: number): void {
    if (wire === 0) this.varintBigInt();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.advance(this.uint());
    else if (wire === 5) this.advance(4);
    else throw new Error(`unsupported protobuf wire type ${wire}`);
  }
  private varintBigInt(): bigint {
    let value = 0n;
    let shift = 0n;
    for (let count = 0; count < 10; count++) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) throw new Error("truncated protobuf varint");
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error("invalid protobuf varint");
  }
  private bytesForLength(): Uint8Array {
    const length = this.uint();
    const start = this.offset;
    this.advance(length);
    return this.bytes.subarray(start, start + length);
  }
  private advance(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) throw new Error("truncated protobuf field");
    this.offset += length;
  }
}
