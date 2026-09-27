import { OpenMeteoWeatherSource } from "../src/weather.js";

const originalFetch = globalThis.fetch;
const now = new Date("2026-09-27T18:00:00.000Z");
globalThis.fetch = async () => {
  const start = Math.floor(now.valueOf() / 1000);
  return Response.json({
    hourly: {
      time: [start, start + 3600, start + 7200],
      precipitation_probability: [10, 80, 30],
      precipitation: [0, 2.5, 0],
      rain: [0, 2.5, 0],
      wind_gusts_10m: [20, 65, 25]
    }
  });
};
try {
  const result = await new OpenMeteoWeatherSource().getWeather(now);
  if (result.extraWalkingMinutes !== 6) throw new Error("heavy rain + strong gusts should add six minutes");
  if (!result.summary.includes("Open-Meteo")) throw new Error("weather summary should include attribution");
  console.log("PASS Open-Meteo weather only increases walking buffer");
} finally {
  globalThis.fetch = originalFetch;
}
