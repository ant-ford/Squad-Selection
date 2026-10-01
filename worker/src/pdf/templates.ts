/**
 * The blank PDF templates, kept in the private file store (FILES) under
 * templates/ and uploaded by scripts/migration/upload-pdf-template.mjs
 * (which repeats these keys). They stay out of the public repository.
 */
export const PDF_TEMPLATES = {
  "sports-associate-application": { key: "templates/sports-associate-application-2024-06.pdf", title: "Sports Associate Membership Application" },
  "section-membership-levy": { key: "templates/section-membership-levy-2025-05.pdf", title: "Section Membership Application" },
  "player-statement": { key: "templates/player-statement.pdf", title: "Section / DSA Player Statement" },
  "commitment-pledge": { key: "templates/commitment-pledge-2026-04.pdf", title: "HKFC Hockey Commitment Pledge" },
  "u18-registration": { key: "templates/u18-registration.pdf", title: "HockeyHK Player Registration Form (Under 18)" },
} as const;

export type PdfTemplate = keyof typeof PDF_TEMPLATES;
