/** The club's season runs July to June: "2026-2027" starts 1 July 2026. */
export function seasonStartYear(today: string): number {
  const [y, m] = today.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}
