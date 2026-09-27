import { TRIP_UPDATES_URL, checkedFetch } from "../http.js";
import type { RouteManifest } from "../route-manifest.js";
import type { JourneyObservation, JourneyOptionConfig, LiveJourneyCandidate } from "../types.js";

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

export async function observeTripUpdates(
  apiKey: string,
  option: JourneyOptionConfig,
  manifest: RouteManifest,
  now: Date,
  walkingBufferMinutes: number,
  boardingLeadMinutes: number
): Promise<JourneyObservation> {
  try {
    const feed = await downloadTripUpdates(apiKey);
    const observedSeconds = feed.header.timestamp;
    if (!observedSeconds) return { origin: option.origin, candidates: [], error: "GTFS-Realtime feed timestamp is missing" };
    const observedAt = new Date(observedSeconds * 1000);
    const readyAt = now.valueOf() + (option.accessWalkingMinutes + walkingBufferMinutes + boardingLeadMinutes) * 60_000;
    const candidates: LiveJourneyCandidate[] = [];

    for (const update of feed.tripUpdates) {
      if (!update.tripId || !manifest.allowedTripIds.has(update.tripId)) continue;
      if (update.routeId && update.routeId !== manifest.routeId) continue;
      const board = update.stopTimeUpdates.find((item) => item.stopId === option.boardingStopId);
      const alight = update.stopTimeUpdates.find((item) => item.stopId === option.alightingStopId);
      if (!board || !alight) continue;
      if (board.stopSequence !== undefined && alight.stopSequence !== undefined && board.stopSequence >= alight.stopSequence) continue;
      const boardTime = eventTime(board.departure) ?? eventTime(board.arrival);
      const alightTime = eventTime(alight.arrival) ?? eventTime(alight.departure);
      if (boardTime === undefined || alightTime === undefined) continue;
      if (boardTime * 1000 < readyAt || alightTime <= boardTime) continue;
      const uncertaintySeconds = Math.max(board.arrival?.uncertainty ?? 0, board.departure?.uncertainty ?? 0, alight.arrival?.uncertainty ?? 0, alight.departure?.uncertainty ?? 0);
      candidates.push({
        origin: option.origin,
        observedAt: observedAt.toISOString(),
        expectedBoarding: new Date(boardTime * 1000).toISOString(),
        expectedArrival: new Date(alightTime * 1000).toISOString(),
        source: "gtfs-rt-trip-updates",
        sourceReference: `trip:${update.tripId}`,
        uncertaintyMinutes: Math.ceil(uncertaintySeconds / 60)
      });
    }

    candidates.sort((a, b) => new Date(a.expectedArrival).valueOf() - new Date(b.expectedArrival).valueOf());
    return {
      origin: option.origin,
      candidates: candidates.slice(0, 1),
      ...(candidates.length ? {} : { error: "No catchable GTFS-Realtime trip update matched the configured journey" })
    };
  } catch (error) {
    return {
      origin: option.origin,
      candidates: [],
      error: error instanceof Error ? error.message : "GTFS-Realtime Trip Updates request failed"
    };
  }
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

function parseTripDescriptor(reader: ProtoReader): Pick<TripUpdate, "tripId" | "routeId" | "directionId"> {
  const result: Pick<TripUpdate, "tripId" | "routeId" | "directionId"> = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) result.tripId = reader.string();
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
    if (field === 1 && wire === 0) reader.uint(); // delay is not used; absolute event time is authoritative here
    else if (field === 2 && wire === 0) result.time = reader.uint();
    else if (field === 3 && wire === 0) result.uncertainty = reader.uint();
    else reader.skip(wire);
  }
  return result;
}

function eventTime(event: StopTimeEvent | undefined): number | undefined {
  return event?.time;
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
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 10; count++) {
      const byte = this.bytes[this.offset++];
      if (byte === undefined) throw new Error("truncated protobuf varint");
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw new Error("protobuf integer exceeds JavaScript safe range");
        return value;
      }
      multiplier *= 128;
    }
    throw new Error("invalid protobuf varint");
  }
  string(): string { return new TextDecoder("utf-8", { fatal: true }).decode(this.bytesForLength()); }
  message(): ProtoReader { return new ProtoReader(this.bytesForLength()); }
  skip(wire: number): void {
    if (wire === 0) this.uint();
    else if (wire === 1) this.advance(8);
    else if (wire === 2) this.advance(this.uint());
    else if (wire === 5) this.advance(4);
    else throw new Error(`unsupported protobuf wire type ${wire}`);
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
