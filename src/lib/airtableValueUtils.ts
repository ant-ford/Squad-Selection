/**
 * Pure helpers shared between the Worker and frontend mappers.
 * MUST NOT depend on anything Worker-specific (no Env, no fetch).
 */
export function linkId(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export function singleSelect(value: unknown): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}