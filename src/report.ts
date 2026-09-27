import { evaluate } from "./evaluate.js";
import type { JourneyConfig, MetroSource, Origin, Report } from "./types.js";

export async function buildReport(config: JourneyConfig, source: MetroSource, origin: Origin, now: Date): Promise<Report> {
  const option = config.options.find((candidate) => candidate.origin === origin);
  if (!option) throw new Error(`configuration for ${origin} is missing`);
  const observation = await source.getJourney(option, now);
  return evaluate({ ...config, options: [option] }, [observation], now);
}
