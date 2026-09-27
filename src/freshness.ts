export function isFresh(observedAt: string, now: Date, maxAgeSeconds: number): boolean {
  const observed = new Date(observedAt);
  if (Number.isNaN(observed.valueOf())) return false;
  const age = (now.valueOf() - observed.valueOf()) / 1000;
  return age >= 0 && age <= maxAgeSeconds;
}
