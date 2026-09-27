import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchSiriEstimatedTime } from "../dist/src/siri.js";

const routeCode = process.argv[2];
if (routeCode !== "27" && routeCode !== "1") fail("Usage: npm run siri:diagnose -- 27|1");
const apiKey = process.env.METRO_API_KEY;
if (!apiKey) fail("METRO_API_KEY is not set. Never pass it as a command argument.");

const output = resolve(`data/diagnostics/siri-route-${routeCode}.response`);
const payload = await fetchSiriEstimatedTime(apiKey, routeCode);
const sanitized = redact(payload, [apiKey, "Ocp-Apim-Subscription-Key"]);
await mkdir(dirname(output), { recursive: true });
// Only the response body is saved. Request URL, headers, and credentials are excluded.
await writeFile(output, sanitized, { mode: 0o600 });
console.log(`Sanitized raw response-body fixture saved to ${output} (${sanitized.byteLength} bytes). No headers or credentials were stored.`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function redact(bytes, values) {
  let result = bytes;
  const replacement = new TextEncoder().encode("[REDACTED]");
  for (const value of values) {
    const needle = new TextEncoder().encode(value);
    if (!needle.length) continue;
    const output = [];
    for (let index = 0; index < result.length;) {
      const matches = index + needle.length <= result.length && needle.every((byte, offset) => result[index + offset] === byte);
      if (matches) {
        output.push(...replacement);
        index += needle.length;
      } else output.push(result[index++]);
    }
    result = Uint8Array.from(output);
  }
  return result;
}
