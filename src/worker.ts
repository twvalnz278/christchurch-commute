import { parseConfig } from "./config.js";
import { formatText } from "./format.js";
import { VerifiedMetroSource } from "./metro.js";
import { buildReport } from "./report.js";
import { parseJourneySchedule } from "./schedule.js";
import type { Env, Origin } from "./types.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return text("Method not allowed", 405, { allow: "GET" });
    if (url.pathname === "/health") {
      const requiredSecretsPresent = Boolean(env.METRO_API_KEY && env.JOURNEY_CONFIG && env.JOURNEY_SCHEDULE && env.COMMUTE_TOKEN);
      return Response.json({
        status: requiredSecretsPresent ? "ready-for-live-validation" : "not-ready",
        productionReady: false,
        requiredSecretsPresent,
        scheduleFallback: "compact GTFS schedule secret with calendar/calendar_dates and pickup/drop-off restrictions",
        tripUpdates: "fresh GTFS-Realtime overlays static trips when available; stale/missing realtime falls back conservatively",
        serviceAlerts: "mandatory fail-closed safety gate",
        weather: "Open-Meteo walking-only risk adjustment with conservative failure fallback",
        siriEstimatedTime: "diagnostic only; not used for recommendations"
      }, { headers: jsonHeaders });
    }
    if (url.pathname !== "/commute") return text("Not found", 404);
    if (!env.COMMUTE_TOKEN) return text("Commute endpoint is not configured", 503);
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${env.COMMUTE_TOKEN}`) return text("Unauthorized", 401, { "www-authenticate": "Bearer" });
    const origin = url.searchParams.get("origin");
    if (origin !== "home" && origin !== "gym") return text("origin must be home or gym", 400);
    return commute(request, env, origin);
  }
};

async function commute(request: Request, env: Env, origin: Origin): Promise<Response> {
  try {
    const config = parseConfig(env.JOURNEY_CONFIG);
    const schedule = parseJourneySchedule(env.JOURNEY_SCHEDULE, config);
    if (!env.METRO_SOURCE && !env.METRO_API_KEY) throw new Error("METRO_API_KEY secret is missing");
    const source = env.METRO_SOURCE ?? new VerifiedMetroSource(env.METRO_API_KEY!, schedule);
    const report = await buildReport(config, source, origin, new Date());
    const wantsJson = request.headers.get("accept")?.includes("application/json");
    return new Response(wantsJson ? JSON.stringify(report) : formatText(report), {
      headers: wantsJson ? jsonHeaders : { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown runtime error";
    return text(`Journey unverified. ${reason}; check MetroGo.`, 503);
  }
}

function text(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extraHeaders }
  });
}
