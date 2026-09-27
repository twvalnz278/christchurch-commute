import { evaluate } from "./evaluate.js";
import type { JourneyConfig, MetroSource, Origin, Report } from "./types.js";
import { OpenMeteoWeatherSource, type WeatherSource } from "./weather.js";

export async function buildReport(
  config: JourneyConfig,
  source: MetroSource,
  origin: Origin,
  now: Date,
  weatherSource: WeatherSource = new OpenMeteoWeatherSource()
): Promise<Report> {
  const option = config.options.find((candidate) => candidate.origin === origin);
  if (!option) throw new Error(`configuration for ${origin} is missing`);

  let weatherExtra = 2;
  let weather: Report["weather"] = {
    summary: "Weather unavailable; conservative fallback walking buffer +2m applied.",
    extraWalkingMinutes: 2,
    source: "fallback"
  };
  try {
    const observation = await weatherSource.getWeather(now);
    weatherExtra = observation.extraWalkingMinutes;
    weather = {
      summary: observation.summary,
      extraWalkingMinutes: observation.extraWalkingMinutes,
      source: "open-meteo"
    };
  } catch {
    // Weather must never make a journey less conservative. A failed weather lookup adds 2 minutes.
  }

  const effectiveWalkingBuffer = config.walkingBufferMinutes + weatherExtra;
  const observation = await source.getJourney(option, now, effectiveWalkingBuffer, config.boardingLeadMinutes);
  const report = evaluate({ ...config, options: [option] }, [observation], now, weatherExtra);
  return { ...report, weather };
}
