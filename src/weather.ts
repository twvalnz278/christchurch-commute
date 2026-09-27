export interface WeatherObservation {
  source: "open-meteo";
  summary: string;
  extraWalkingMinutes: number;
  observedAt: string;
}

export interface WeatherSource {
  getWeather(now: Date): Promise<WeatherObservation>;
}

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const CHRISTCHURCH_CBD = { latitude: -43.5296581, longitude: 172.6334006 };

export class OpenMeteoWeatherSource implements WeatherSource {
  async getWeather(now: Date): Promise<WeatherObservation> {
    const url = new URL(FORECAST_URL);
    url.searchParams.set("latitude", String(CHRISTCHURCH_CBD.latitude));
    url.searchParams.set("longitude", String(CHRISTCHURCH_CBD.longitude));
    url.searchParams.set("hourly", "precipitation_probability,precipitation,rain,wind_gusts_10m");
    url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("timezone", "Pacific/Auckland");
    url.searchParams.set("forecast_days", "1");

    const response = await fetch(url.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Open-Meteo request failed with HTTP ${response.status}`);
    const payload = await response.json() as {
      hourly?: {
        time?: number[];
        precipitation_probability?: Array<number | null>;
        precipitation?: Array<number | null>;
        rain?: Array<number | null>;
        wind_gusts_10m?: Array<number | null>;
      };
    };
    const hourly = payload.hourly;
    if (!hourly?.time || !hourly.precipitation_probability || !hourly.precipitation || !hourly.rain || !hourly.wind_gusts_10m) {
      throw new Error("Open-Meteo hourly fields are missing");
    }

    const start = Math.floor(now.valueOf() / 1000);
    const end = start + 3 * 60 * 60;
    let maxProbability = 0;
    let maxPrecipitation = 0;
    let maxRain = 0;
    let maxGust = 0;
    let matched = 0;
    for (let i = 0; i < hourly.time.length; i++) {
      const t = hourly.time[i];
      if (t === undefined || t < start - 30 * 60 || t > end) continue;
      matched++;
      maxProbability = Math.max(maxProbability, hourly.precipitation_probability[i] ?? 0);
      maxPrecipitation = Math.max(maxPrecipitation, hourly.precipitation[i] ?? 0);
      maxRain = Math.max(maxRain, hourly.rain[i] ?? 0);
      maxGust = Math.max(maxGust, hourly.wind_gusts_10m[i] ?? 0);
    }
    if (!matched) throw new Error("Open-Meteo returned no usable forecast window");

    let extraWalkingMinutes = 0;
    if (maxProbability >= 70 || maxPrecipitation >= 2 || maxRain >= 2) extraWalkingMinutes += 4;
    else if (maxProbability >= 40 || maxPrecipitation >= 0.2 || maxRain >= 0.2) extraWalkingMinutes += 2;
    if (maxGust >= 60) extraWalkingMinutes += 2;
    extraWalkingMinutes = Math.min(extraWalkingMinutes, 6);

    return {
      source: "open-meteo",
      observedAt: now.toISOString(),
      extraWalkingMinutes,
      summary: `Open-Meteo next 3h: precip probability up to ${Math.round(maxProbability)}%, precipitation up to ${maxPrecipitation.toFixed(1)} mm/h, gusts up to ${Math.round(maxGust)} km/h; walking buffer +${extraWalkingMinutes}m`
    };
  }
}
