/**
 * Where a person's name links to on the officer lists (Membership, HKHA
 * registration): their person page, for viewers who open People (the
 * `people` section); null otherwise, and the name stays plain text.
 */
export function personPageHref(sections: readonly string[] | undefined, id: string | null | undefined): string | null {
  return id && sections?.includes('people') ? `/people/${encodeURIComponent(id)}` : null;
}
