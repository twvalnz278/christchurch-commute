import worker from "../src/worker.js";

const health = await worker.fetch(new Request("https://worker.invalid/health"), {});
if (health.status !== 200) throw new Error("health endpoint should respond without contacting external services");
const healthBody = await health.json() as Record<string, unknown>;
if (healthBody.productionReady !== false || healthBody.requiredSecretsPresent !== false) {
  throw new Error("health must disclose that live validation/secrets are incomplete");
}
console.log("PASS /health reports readiness without exposing secret values");

const authEnv = { COMMUTE_TOKEN: "fixture-token" };
for (const url of ["https://worker.invalid/commute", "https://worker.invalid/commute?origin=other"]) {
  const response = await worker.fetch(new Request(url, { headers: { authorization: "Bearer fixture-token" } }), authEnv);
  if (response.status !== 400) throw new Error("invalid origin should return 400");
}
console.log("PASS /commute requires home or gym origin");

for (const path of ["/commute?origin=home", "/validate"]) {
  const unauthorized = await worker.fetch(new Request(`https://worker.invalid${path}`), authEnv);
  if (unauthorized.status !== 401) throw new Error(`${path} must require bearer auth`);
}
console.log("PASS /commute and /validate require bearer auth");

const unavailable = await worker.fetch(
  new Request("https://worker.invalid/commute?origin=home", { headers: { authorization: "Bearer fixture-token" } }),
  authEnv
);
if (unavailable.status !== 503 || !(await unavailable.text()).includes("JOURNEY_CONFIG")) {
  throw new Error("unconfigured commute must fail closed with a safe diagnostic");
}
console.log("PASS /commute fails closed without required journey secrets");

const oldReport = await worker.fetch(new Request("https://worker.invalid/report"), {});
if (oldReport.status !== 404) throw new Error("legacy /report route must not exist");
console.log("PASS legacy /report is removed");
