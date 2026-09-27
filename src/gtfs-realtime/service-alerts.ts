import { SERVICE_ALERTS_URL, checkedFetch } from "../http.js";

export interface ServiceAlertFeed {
  header: { version: string; timestamp?: number };
  alerts: ServiceAlert[];
}

export interface ServiceAlert {
  id: string;
  activePeriods: Array<{ start?: number; end?: number }>;
  informedEntities: Array<{ agencyId?: string; routeId?: string; stopId?: string; routeType?: number; tripId?: string; directionId?: number }>;
  cause?: number;
  effect?: number;
  headerText: Translation[];
  descriptionText: Translation[];
  url: Translation[];
  severityLevel?: number;
}

export interface Translation { text: string; language?: string }

export async function downloadServiceAlerts(apiKey: string): Promise<ServiceAlertFeed> {
  return parseServiceAlerts(await checkedFetch(SERVICE_ALERTS_URL, apiKey, 5_000_000));
}

/** Decodes the official GTFS-Realtime FeedMessage/Alert schema and ignores unknown fields. */
export function parseServiceAlerts(bytes: Uint8Array): ServiceAlertFeed {
  const reader = new ProtoReader(bytes);
  let header: ServiceAlertFeed["header"] | undefined;
  const alerts: ServiceAlert[] = [];
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) header = parseHeader(reader.message());
    else if (field === 2 && wire === 2) {
      const alert = parseEntity(reader.message());
      if (alert) alerts.push(alert);
    } else reader.skip(wire);
  }
  if (!header?.version) throw new Error("GTFS-Realtime header or version is missing");
  return { header, alerts };
}

function parseHeader(reader: ProtoReader): ServiceAlertFeed["header"] {
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

function parseEntity(reader: ProtoReader): ServiceAlert | undefined {
  let id = "";
  let alertReader: ProtoReader | undefined;
  let deleted = false;
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) id = reader.string();
    else if (field === 2 && wire === 0) deleted = reader.uint() !== 0;
    else if (field === 5 && wire === 2) alertReader = reader.message();
    else reader.skip(wire);
  }
  return deleted || !alertReader ? undefined : parseAlert(id, alertReader);
}

function parseAlert(id: string, reader: ProtoReader): ServiceAlert {
  const result: ServiceAlert = { id, activePeriods: [], informedEntities: [], headerText: [], descriptionText: [], url: [] };
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) result.activePeriods.push(parsePeriod(reader.message()));
    else if (field === 5 && wire === 2) result.informedEntities.push(parseSelector(reader.message()));
    else if (field === 6 && wire === 0) result.cause = reader.uint();
    else if (field === 7 && wire === 0) result.effect = reader.uint();
    else if (field === 8 && wire === 2) result.url = parseTranslatedString(reader.message());
    else if (field === 10 && wire === 2) result.headerText = parseTranslatedString(reader.message());
    else if (field === 11 && wire === 2) result.descriptionText = parseTranslatedString(reader.message());
    else if (field === 14 && wire === 0) result.severityLevel = reader.uint();
    else reader.skip(wire);
  }
  return result;
}

function parsePeriod(reader: ProtoReader): { start?: number; end?: number } {
  const period: { start?: number; end?: number } = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (wire === 0 && field === 1) period.start = reader.uint();
    else if (wire === 0 && field === 2) period.end = reader.uint();
    else reader.skip(wire);
  }
  return period;
}

function parseSelector(reader: ProtoReader): ServiceAlert["informedEntities"][number] {
  const selector: ServiceAlert["informedEntities"][number] = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (wire === 2 && field === 1) selector.agencyId = reader.string();
    else if (wire === 2 && field === 2) selector.routeId = reader.string();
    else if (wire === 0 && field === 3) selector.routeType = reader.uint();
    else if (wire === 2 && field === 4) Object.assign(selector, parseTripDescriptor(reader.message()));
    else if (wire === 2 && field === 5) selector.stopId = reader.string();
    else if (wire === 0 && field === 6) selector.directionId = reader.uint();
    else reader.skip(wire);
  }
  return selector;
}

function parseTripDescriptor(reader: ProtoReader): { tripId?: string; directionId?: number } {
  const trip: { tripId?: string; directionId?: number } = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1 && wire === 2) trip.tripId = reader.string();
    else if (field === 6 && wire === 0) trip.directionId = reader.uint();
    else reader.skip(wire);
  }
  return trip;
}

function parseTranslatedString(reader: ProtoReader): Translation[] {
  const translations: Translation[] = [];
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field !== 1 || wire !== 2) reader.skip(wire);
    else {
      const translation = reader.message();
      let text = "";
      let language: string | undefined;
      while (!translation.done) {
        const [translationField, translationWire] = translation.tag();
        if (translationField === 1 && translationWire === 2) text = translation.string();
        else if (translationField === 2 && translationWire === 2) language = translation.string();
        else translation.skip(translationWire);
      }
      if (text) translations.push({ text, ...(language ? { language } : {}) });
    }
  }
  return translations;
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
