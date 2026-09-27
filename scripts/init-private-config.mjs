import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const homeStop = process.argv[2];
if (!homeStop || !/^\d+$/u.test(homeStop)) {
  console.error("Usage: npm run journey:config:init -- <home-boarding-stop-id>");
  process.exit(1);
}

const output = resolve("data/private/journey-config.private.json");
const config = {
  timeZone: "Pacific/Auckland",
  deadlineLocal: "08:30",
  destination: "287 Durham Street North, Christchurch Central City, Christchurch 8013",
  freshnessSeconds: 120,
  arrivalMarginMinutes: 10,
  walkingBufferMinutes: 2,
  boardingLeadMinutes: 2,
  options: [
    {
      origin: "home",
      label: "Home → Route 27",
      routeCode: "27",
      routeId: "27_4175_6_3",
      originDescription: "Private home (address intentionally not stored)",
      boardingStopId: homeStop,
      alightingStopId: "53074",
      accessWalkingMinutes: 14,
      egressWalkingMinutes: 12,
      transferCount: 0
    },
    {
      origin: "gym",
      label: "Flex Fitness Belfast → Route 1",
      routeCode: "1",
      routeId: "1_0854_6_3",
      originDescription: "4 Bellewood Avenue, Belfast, Christchurch",
      boardingStopId: "15357",
      alightingStopId: "53074",
      accessWalkingMinutes: 8,
      egressWalkingMinutes: 12,
      transferCount: 0
    }
  ]
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(config), { mode: 0o600 });
console.log(`Private journey config written to ${output}.`);
console.log("No home street address was stored. Review the stop ID and walking baselines before generating JOURNEY_SCHEDULE.");
