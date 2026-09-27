import { fetchSiriEstimatedTime } from "../src/siri.js";

const originalFetch = globalThis.fetch;
let called = false;
globalThis.fetch = async (input, init) => {
  called = true;
  const url = new URL(String(input));
  if (url.origin + url.pathname !== "https://apis.metroinfo.co.nz/rti/siri/v1/et") throw new Error("unexpected SIRI endpoint");
  if (url.searchParams.get("routecode") !== "27") throw new Error("routecode parameter is missing");
  const headers = new Headers(init?.headers);
  if (headers.get("Ocp-Apim-Subscription-Key") !== ["fixture", "value"].join("-")) throw new Error("subscription header is missing");
  return new Response(Uint8Array.from([1, 2, 3]));
};

try {
  const payload = await fetchSiriEstimatedTime(["fixture", "value"].join("-"), "27");
  if (!called || payload.length !== 3) throw new Error("SIRI response was not returned");
  console.log("PASS SIRI uses only the verified endpoint, routecode query, and subscription header");
} finally {
  globalThis.fetch = originalFetch;
}
