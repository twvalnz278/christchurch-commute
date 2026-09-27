import type { JourneyConfig, JourneyOptionConfig, Origin } from "./types.js";

const expectedRouteCodes: Record<Origin, "27" | "1"> = { home: "27", gym: "1" };

export function parseConfig(raw: string | undefined): JourneyConfig {
  if (!raw) throw new Error("JOURNEY_CONFIG secret is missing");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("JOURNEY_CONFIG must be an object");
  const config = value as Partial<JourneyConfig>;
  if (config.timeZone !== "Pacific/Auckland") throw new Error("timeZone must be Pacific/Auckland");
  if (config.deadlineLocal !== "08:30") throw new Error("deadlineLocal must remain the hard 08:30 deadline");
  if (config.destination !== "287 Durham Street North, Christchurch Central City, Christchurch 8013") throw new Error("destination must remain fixed");
  if (!Number.isFinite(config.freshnessSeconds) || (config.freshnessSeconds ?? 0) <= 0) throw new Error("freshnessSeconds must be positive");
  if (!Number.isFinite(config.arrivalMarginMinutes) || (config.arrivalMarginMinutes ?? 0) < 0) throw new Error("arrivalMarginMinutes must be non-negative");
  if (!Number.isFinite(config.walkingBufferMinutes) || (config.walkingBufferMinutes ?? 0) < 0) throw new Error("walkingBufferMinutes must be non-negative");
  if (!Number.isFinite(config.boardingLeadMinutes) || (config.boardingLeadMinutes ?? 0) < 0) throw new Error("boardingLeadMinutes must be non-negative");
  if (!config.options || config.options.length !== 2) throw new Error("exactly two options are required");
  const origins = new Set<Origin>();
  for (const option of config.options) validateOption(option, origins);
  if (!origins.has("home") || !origins.has("gym")) throw new Error("home and gym options are required");
  return config as JourneyConfig;
}

function validateOption(option: JourneyOptionConfig, origins: Set<Origin>): void {
  if (option.origin !== "home" && option.origin !== "gym") throw new Error("origin must be home or gym");
  if (origins.has(option.origin)) throw new Error(`duplicate ${option.origin} option`);
  origins.add(option.origin);
  if (option.routeCode !== expectedRouteCodes[option.origin]) throw new Error(`${option.origin} must use Route ${expectedRouteCodes[option.origin]}`);
  if (!option.routeId || !option.originDescription || !option.boardingStopId || !option.alightingStopId) {
    throw new Error("each option needs a confirmed origin, route ID, and stop IDs");
  }
  if (option.origin === "gym" && option.originDescription !== "4 Bellewood Avenue, Belfast, Christchurch") {
    throw new Error("gym origin must remain Flex Fitness Belfast's fixed address");
  }
  if (!Number.isFinite(option.accessWalkingMinutes) || option.accessWalkingMinutes < 0) throw new Error("accessWalkingMinutes must be non-negative");
  if (!Number.isFinite(option.egressWalkingMinutes) || option.egressWalkingMinutes < 0) throw new Error("egressWalkingMinutes must be non-negative");
  if (!Number.isInteger(option.transferCount) || option.transferCount < 0) throw new Error("transferCount must be a non-negative integer");
}
