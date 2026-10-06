/**
 * Filling a WhatsApp message for one person (review item D3). Templates
 * imported from Airtable say {{Preferred Name}}; Eddy's own say {first name}.
 * Both become what the person goes by. Any other {{placeholder}} is left as
 * it is, for the sender to edit before sending.
 */
export function fillMessage(template: string, person: { firstName?: string | null; name?: string | null }): string {
  const first = (person.firstName || person.name?.split(" ")[0] || "").trim() || "there";
  return template.replace(/\{\{\s*preferred name\s*\}\}|\{\s*first name\s*\}/gi, first);
}
