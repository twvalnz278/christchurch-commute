import { classifyAlerts, type AlertContext } from "../src/alerts.js";
import type { ServiceAlert } from "../src/gtfs-realtime/service-alerts.js";

const context: AlertContext = { routeId: "route-27-fixture", stopIds: ["board", "alight"], tripId: "trip-1", directionId: 1, nowEpochSeconds: 1_000 };

assertRisk(alert("unrelated", 1, [{ routeId: "another-route" }]), "CLEAR");
assertRisk(alert("no-service", 1, [{ routeId: context.routeId }]), "BLOCK");
assertRisk(alert("detour", 4, [{ routeId: context.routeId }]), "HIGH_RISK");
assertRisk(alert("delay", 3, [{ stopId: "board" }]), "HIGH_RISK");
assertRisk(alert("ambiguous", 8, [{ tripId: "trip-1" }]), "CONFLICT");
assertRisk(alert("expired", 1, [{ routeId: context.routeId }], [{ end: 999 }]), "CLEAR");
console.log("PASS Service Alert policy distinguishes unrelated, blocking, high-risk, ambiguous, and inactive alerts");

function alert(id: string, effect: number, informedEntities: ServiceAlert["informedEntities"], activePeriods: ServiceAlert["activePeriods"] = []): ServiceAlert {
  return { id, effect, informedEntities, activePeriods, headerText: [], descriptionText: [], url: [] };
}

function assertRisk(value: ServiceAlert, expected: string): void {
  const actual = classifyAlerts([value], context)[0]?.risk;
  if (actual !== expected) throw new Error(`${value.id}: expected ${expected}, got ${actual}`);
}
