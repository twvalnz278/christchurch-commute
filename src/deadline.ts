export function deadlineFor(now: Date, localTime: string, timeZone: string): Date {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const desired = `${localDate}T${localTime}:00`;

  // Determine the zone offset at noon, avoiding assumptions about NZ daylight saving.
  const noonUtc = new Date(`${localDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(noonUtc);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const represented = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"), pick("second"));
  const offset = represented - noonUtc.valueOf();
  return new Date(new Date(`${desired}Z`).valueOf() - offset);
}
