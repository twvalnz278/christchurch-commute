import { parseConfig } from "./config.js";
import { formatText } from "./format.js";
import { cachedGtfsLoader, VerifiedMetroSource } from "./metro.js";
import { buildReport } from "./report.js";
import type { Env, Origin } from "./types.js";

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") return text("Method not allowed", 405, { allow: "GET" });
    if (url.pathname === "/health") {
      return Response.json({
        status: "not-ready",
        productionReady: false,
        gtfsStatic: env.METRO_API_KEY ? "endpoint configured; credential present" : "endpoint configured; credential missing",
        tripUpdates: "endpoint/parser validated against a production feed capture; configured journey validation pending",
        serviceAlerts: "parser implemented; recommendation integration pending",
        siriEstimatedTime: "JSON envelope observed; journey payload absent in captured fixtures",
        vehiclePositions: "endpoint identified; integration optional/TODO"
      }, { headers: jsonHeaders });
    }
    if (url.pathname !== "/commute") return text("Not found", 404);
    const origin = url.searchParams.get("origin");
    if (origin !== "home" && origin !== "gym") return text("origin must be home or gym", 400);
    return commute(request, env, origin);
  }
};

async function commute(request: Request, env: Env, origin: Origin): Promise<Response> {
  try {
    const config = parseConfig(env.JOURNEY_CONFIG);
    if (!env.METRO_SOURCE && !env.METRO_API_KEY) throw new Error("METRO_API_KEY secret is missing");
    const source = env.METRO_SOURCE ?? new VerifiedMetroSource(env.METRO_API_KEY!, cachedGtfsLoader(env.METRO_API_KEY!));
    const report = await buildReport(config, source, origin, new Date());
    const wantsJson = request.headers.get("accept")?.includes("application/json");
    return new Response(wantsJson ? JSON.stringify(report) : formatText(report), {
      headers: wantsJson ? jsonHeaders : { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }
    });
  } catch {
    return text("Journey unverified. Configuration or live data is unavailable; check MetroGo.", 503);
  }
}

function text(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extraHeaders } });
}
