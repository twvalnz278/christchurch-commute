import { deadlineFor, localServiceDate, weekdayBitForServiceDate } from "./deadline.js";
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

  const serviceDate = localServiceDate(now, config.timeZone);
  const deadline = deadlineFor(now, config.deadlineLocal, config.timeZone);
  const weekdayBit = weekdayBitForServiceDate(serviceDate);
  if ((weekdayBit & (32 | 64)) !== 0) {
    return outsideWindow(config, option.origin, option.label, now, deadline, serviceDate, "Weekend: weekday commute automation is inactive.");
  }
  if (now.valueOf() >= deadline.valueOf()) {
    return outsideWindow(config, option.origin, option.label, now, deadline, serviceDate, "The 08:30 commute deadline has already passed.");
  }

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
    // Weather failure must never reduce conservatism.
  }

  const effectiveWalkingBuffer = config.walkingBufferMinutes + weatherExtra;
  const observation = await source.getJourney(
    option,
    now,
    effectiveWalkingBuffer,
    config.boardingLeadMinutes,
    config.freshnessSeconds
  );
  const report = evaluate({ ...config, options: [option] }, [observation], now, weatherExtra);
  return { ...report, weather };
}

function outsideWindow(
  config: JourneyConfig,
  origin: Origin,
  label: string,
  now: Date,
  deadline: Date,
  serviceDate: string,
  reason: string
): Report {
  return {
    generatedAt: now.toISOString(),
    deadline: deadline.toISOString(),
    localServiceDate: serviceDate,
    status: "outside-window",
    safeRecommendation: false,
    headline: "Commute check outside the weekday morning window.",
    options: [{
      origin,
      label,
      verified: false,
      reason
    }],
    fallback: "No morning recommendation is required right now.",
    notes: [reason]
  };
}
