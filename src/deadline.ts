export function localServiceDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const value = `${pick("year")}${pick("month")}${pick("day")}`;
  if (!/^\d{8}$/u.test(value)) throw new Error("Could not determine local service date");
  return value;
}

export function weekdayBitForServiceDate(serviceDate: string): number {
  const { year, month, day } = parseServiceDate(serviceDate);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  // Monday=bit0 ... Sunday=bit6
  const mondayBased = (weekday + 6) % 7;
  return 1 << mondayBased;
}

export function dateForServiceSeconds(serviceDate: string, seconds: number, timeZone: string): Date {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("GTFS service seconds must be non-negative");
  const { year, month, day } = parseServiceDate(serviceDate);
  const totalSeconds = Math.floor(seconds);
  const dayOffset = Math.floor(totalSeconds / 86_400);
  const secondsOfDay = totalSeconds % 86_400;
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return zonedLocalToDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    Math.floor(secondsOfDay / 3600),
    Math.floor((secondsOfDay % 3600) / 60),
    secondsOfDay % 60,
    timeZone
  );
}

export function deadlineFor(now: Date, localTime: string, timeZone: string): Date {
  const serviceDate = localServiceDate(now, timeZone);
  const match = /^(\d{2}):(\d{2})$/u.exec(localTime);
  if (!match) throw new Error("deadline local time must be HH:MM");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("deadline local time is invalid");
  const { year, month, day } = parseServiceDate(serviceDate);
  return zonedLocalToDate(year, month, day, hour, minute, 0, timeZone);
}

function parseServiceDate(value: string): { year: number; month: number; day: number } {
  if (!/^\d{8}$/u.test(value)) throw new Error("GTFS service date must be YYYYMMDD");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new Error("GTFS service date is invalid");
  }
  return { year, month, day };
}

function zonedLocalToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const nominalUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = nominalUtc;
  // Two passes handle ordinary offset changes without hard-coding New Zealand DST rules.
  for (let pass = 0; pass < 2; pass++) {
    const offset = zoneOffsetMilliseconds(new Date(candidate), timeZone);
    candidate = nominalUtc - offset;
  }
  const result = new Date(candidate);
  if (Number.isNaN(result.valueOf())) throw new Error("Could not construct zoned date");
  return result;
}

function zoneOffsetMilliseconds(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(at);
  const pick = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const represented = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,
    pick("minute"),
    pick("second")
  );
  return represented - at.valueOf();
}
