import type { ServiceAlert } from "./gtfs-realtime/service-alerts.js";

export type AlertRisk = "CLEAR" | "ANNOTATE" | "HIGH_RISK" | "BLOCK" | "CONFLICT";

export interface AlertContext {
  routeId: string;
  stopIds: string[];
  tripId?: string;
  directionId?: number;
  nowEpochSeconds: number;
}

export interface AlertPolicy {
  blockEffects: number[];
  highRiskEffects: number[];
  annotateEffects: number[];
  blockTerms: string[];
  highRiskTerms: string[];
}

export const CONSERVATIVE_ALERT_POLICY: AlertPolicy = {
  // Official GTFS-RT Effect values: NO_SERVICE=1; significant delay=3; detour=4; stop moved=9.
  blockEffects: [1],
  highRiskEffects: [3, 4, 9],
  annotateEffects: [2, 6],
  blockTerms: ["cancelled", "canceled", "no service", "stop closed", "stop closure"],
  highRiskTerms: ["significant delay", "detour"]
};

export interface ClassifiedAlert {
  alertId: string;
  risk: AlertRisk;
  reason: string;
}

export function classifyAlerts(alerts: ServiceAlert[], context: AlertContext, policy: AlertPolicy = CONSERVATIVE_ALERT_POLICY): ClassifiedAlert[] {
  return alerts.map((alert) => classifyAlert(alert, context, policy));
}

function classifyAlert(alert: ServiceAlert, context: AlertContext, policy: AlertPolicy): ClassifiedAlert {
  if (!isActive(alert, context.nowEpochSeconds)) return result(alert, "CLEAR", "alert is not active");
  const selectors = alert.informedEntities;
  const relevant = selectors.length === 0 || selectors.some((selector) => {
    if (selector.routeId && selector.routeId !== context.routeId) return false;
    if (selector.stopId && !context.stopIds.includes(selector.stopId)) return false;
    if (selector.tripId && selector.tripId !== context.tripId) return false;
    if (selector.directionId !== undefined && selector.directionId !== context.directionId) return false;
    return true;
  });
  if (!relevant) return result(alert, "CLEAR", "alert selectors do not affect the configured journey");

  const text = [...alert.headerText, ...alert.descriptionText].map((translation) => translation.text.toLocaleLowerCase("en-NZ")).join(" ");
  if (alert.effect !== undefined && policy.blockEffects.includes(alert.effect)) return result(alert, "BLOCK", `relevant alert has configured blocking effect ${alert.effect}`);
  if (policy.blockTerms.some((term) => text.includes(term.toLocaleLowerCase("en-NZ")))) return result(alert, "BLOCK", "relevant alert contains configured cancellation/no-service/closure language");
  if (alert.effect !== undefined && policy.highRiskEffects.includes(alert.effect)) return result(alert, "HIGH_RISK", `relevant alert has configured high-risk effect ${alert.effect}`);
  if (policy.highRiskTerms.some((term) => text.includes(term.toLocaleLowerCase("en-NZ")))) return result(alert, "HIGH_RISK", "relevant alert contains configured delay/detour language");
  if (alert.effect !== undefined && policy.annotateEffects.includes(alert.effect)) return result(alert, "ANNOTATE", `relevant alert has configured annotation effect ${alert.effect}`);
  return result(alert, "CONFLICT", "relevant alert is ambiguous under the configured policy");
}

function isActive(alert: ServiceAlert, now: number): boolean {
  if (!alert.activePeriods.length) return true;
  return alert.activePeriods.some((period) => (period.start === undefined || period.start <= now) && (period.end === undefined || now < period.end));
}

function result(alert: ServiceAlert, risk: AlertRisk, reason: string): ClassifiedAlert {
  return { alertId: alert.id, risk, reason };
}
