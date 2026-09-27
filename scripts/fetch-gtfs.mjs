import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { checkedFetch, GTFS_STATIC_URL } from "../dist/src/http.js";

const output = resolve("data/production/gtfs.zip");
const temporary = `${output}.partial`;
const apiKey = process.env.METRO_API_KEY;
if (!apiKey) fail("METRO_API_KEY is not set. Enter it only through your local environment; never pass it as an argument.");

await mkdir(dirname(output), { recursive: true });
try {
  const bytes = await checkedFetch(GTFS_STATIC_URL, apiKey, 30_000_000);
  // Parse the entire archive before it is made available to discovery commands.
  const parsed = await import("../dist/src/gtfs/static.js");
  await parsed.parseGtfsZip(bytes);
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, output);
  console.log(`Validated GTFS ZIP saved to ${output} (${bytes.byteLength} bytes).`);
} catch (error) {
  await rm(temporary, { force: true });
  fail(error instanceof Error ? error.message : "GTFS download failed");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
