import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { checkedFetch, TRIP_UPDATES_URL } from "../dist/src/http.js";

const apiKey = process.env.METRO_API_KEY;
if (!apiKey) fail("METRO_API_KEY is not set. Never pass it as a command argument.");

const output = resolve("data/diagnostics/trip-updates.pb");
const payload = await checkedFetch(TRIP_UPDATES_URL, apiKey, 10_000_000);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, payload, { mode: 0o600 });
console.log(`GTFS-Realtime Trip Updates fixture saved to ${output} (${payload.byteLength} bytes). No request headers or credentials were stored.`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
