import type { Report } from "./types.js";

const TIME_ZONE = "Pacific/Auckland";

export function formatText(report: Report): string {
  const lines = [report.headline, `Status: ${report.status}`, `Hard deadline: ${localTime(report.deadline)}`];
  if (report.weather) lines.push(`Weather: ${report.weather.summary}`);
  for (const option of report.options) {
    lines.push(`${option.verified ? "VERIFIED" : "UNVERIFIED"} — ${option.label}: ${option.reason}`);
    if (option.confidence) lines.push(`Confidence: ${option.confidence}${option.source ? ` (${option.source})` : ""}`);
    if (option.leaveBy) lines.push(`Leave by: ${localTime(option.leaveBy)}`);
    if (option.expectedBoarding) lines.push(`Bus: ${localTime(option.expectedBoarding)}`);
    if (option.conservativeArrival) lines.push(`Conservative work arrival: ${localTime(option.conservativeArrival)}`);
    if (option.note) lines.push(`Note: ${option.note}`);
  }
  for (const note of report.notes ?? []) lines.push(`Data note: ${note}`);
  lines.push(`Fallback: ${report.fallback}`);
  return lines.join("\n");
}

function localTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.valueOf())) return iso;
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}
