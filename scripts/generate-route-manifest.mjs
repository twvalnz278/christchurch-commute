import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) fail("Usage: npm run gtfs:manifest -- <discovery.json>");
const source = resolve(input);
const report = JSON.parse(await readFile(source, "utf8"));

const route27 = select(report, "27", "0");
const route1 = select(report, "1", "0");
const manifests = {
  home: manifest(route27, "27"),
  gym: manifest(route1, "1")
};

const output = resolve("src/route-manifest.ts");
await writeFile(output, render(manifests, String(report.serviceDate ?? "unknown")), "utf8");
console.log(`Compact public route manifest written to ${output}. No private origin or boarding stop was included.`);

function select(report, routeCode, directionId) {
  const matches = (report.routes ?? []).filter((route) =>
    route.route_short_name === routeCode &&
    Array.isArray(route.observed_direction_ids) &&
    route.observed_direction_ids.includes(directionId)
  );
  if (matches.length !== 1) fail(`Expected exactly one Route ${routeCode} direction ${directionId} discovery record; found ${matches.length}`);
  return matches[0];
}

function manifest(route, routeCode) {
  const ids = [];
  for (const pattern of route.trip_patterns ?? []) {
    for (const id of pattern.trip_ids ?? []) if (!ids.includes(id)) ids.push(id);
  }
  if (!route.route_id || ids.length === 0) fail(`Route ${routeCode} discovery record has no route_id or trip_ids`);
  return { routeCode, routeId: route.route_id, directionId: 0, tripIds: ids };
}

function render(items, date) {
  return `import type { Origin } from "./types.js";

export interface RouteManifest {
  routeCode: "27" | "1";
  routeId: string;
  directionId: number;
  generatedFromServiceDate: string;
  allowedTripIds: ReadonlySet<string>;
}

/**
 * GENERATED from public Metro GTFS discovery data.
 * Contains no private home address or boarding stop.
 * Run npm run gtfs:manifest -- data/discovery/routes-1-27.json after refreshing GTFS.
 */
const manifests: Record<Origin, RouteManifest> = {
  home: {
    routeCode: "27",
    routeId: ${JSON.stringify(items.home.routeId)},
    directionId: ${items.home.directionId},
    generatedFromServiceDate: ${JSON.stringify(date)},
    allowedTripIds: new Set(${JSON.stringify(items.home.tripIds)})
  },
  gym: {
    routeCode: "1",
    routeId: ${JSON.stringify(items.gym.routeId)},
    directionId: ${items.gym.directionId},
    generatedFromServiceDate: ${JSON.stringify(date)},
    allowedTripIds: new Set(${JSON.stringify(items.gym.tripIds)})
  }
};

export function routeManifestFor(origin: Origin): RouteManifest {
  return manifests[origin];
}
`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
