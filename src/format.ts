import type { Report } from "./types.js";

export function formatText(report: Report): string {
  const lines = [report.headline, `Hard deadline: ${report.deadline}`];
  for (const option of report.options) {
    lines.push(`${option.verified ? "VERIFIED" : "UNVERIFIED"} — ${option.label}: ${option.reason}`);
    if (option.leaveBy) lines.push(`Leave origin by: ${option.leaveBy}`);
    if (option.expectedBoarding) lines.push(`Expected boarding: ${option.expectedBoarding}`);
    if (option.conservativeArrival) lines.push(`Conservative work arrival: ${option.conservativeArrival}`);
  }
  lines.push(`Fallback: ${report.fallback}`);
  return lines.join("\n");
}
