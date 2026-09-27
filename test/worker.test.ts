import worker from "../src/worker.js";

const health = await worker.fetch(new Request("https://worker.invalid/health"), {});
if (health.status !== 200) throw new Error("health endpoint should respond without contacting Metro");
const healthBody = await health.json() as Record<string, unknown>;
if (healthBody.productionReady !== false || healthBody.tripUpdates !== "UNVERIFIED/TODO") throw new Error("health must disclose incomplete integrations");
console.log("PASS /health reports incomplete integration without secrets");

for (const url of ["https://worker.invalid/commute", "https://worker.invalid/commute?origin=other"]) {
  const response = await worker.fetch(new Request(url), {});
  if (response.status !== 400) throw new Error("invalid origin should return 400");
}
console.log("PASS /commute requires home or gym origin");

const unavailable = await worker.fetch(new Request("https://worker.invalid/commute?origin=home"), {});
if (unavailable.status !== 503 || !(await unavailable.text()).includes("MetroGo")) throw new Error("unconfigured commute must fail closed");
console.log("PASS /commute fails closed without secrets");

const oldReport = await worker.fetch(new Request("https://worker.invalid/report"), {});
if (oldReport.status !== 404) throw new Error("legacy /report route must not exist");
console.log("PASS legacy /report is removed");
