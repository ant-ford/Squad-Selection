// Who the demo signs in as: open any screen with `?as=<key>`. Fictional people.
// `offices` are the person's Active officer rows; the officers' sections they
// open follow from SECTION_OFFICES below.

/**
 * @typedef {'membershipOfficer'|'sectionChair'|'sectionCaptain'|'kitConvenor'|'hockeyConvenor'|'assistantDirector'|'umpireCoordinator'} Office
 * @typedef {{
 *   label: string,
 *   id: string,
 *   name: string,
 *   offices: Office[],
 *   coachTeams?: string[],
 *   umpiring?: 'umpire'|'coordinator',
 *   socialSecretaryOf?: string[],
 * }} Persona
 */

/** @type {Record<string, Persona>} */
export const PERSONAS = {
  player: { label: 'Player', id: 'demoSam', name: 'Sam Carter', offices: [] },
  coach: { label: 'Coach', id: 'demoJo', name: 'Jo Bennett', offices: [], coachTeams: ['HKFC C', 'HKFC D'] },
  'section-captain': { label: 'Section Captain', id: 'demoAlex', name: 'Alex Morgan', offices: ['sectionCaptain'] },
  'mens-convenor': { label: "Men's Convenor", id: 'demoChris', name: 'Chris Tam', offices: ['hockeyConvenor'] },
  'membership-officer': { label: 'Membership Officer', id: 'demoDaniel', name: 'Daniel Price', offices: ['membershipOfficer'] },
  'kit-convenor': { label: 'Kit Convenor', id: 'demoDan', name: 'Dan Marsh', offices: ['kitConvenor'] },
  'umpire-coordinator': { label: 'Umpire Coordinator', id: 'demoGraham', name: 'Graham Holt', offices: ['umpireCoordinator'], umpiring: 'coordinator' },
  umpire: { label: 'Umpire', id: 'demoRavi', name: 'Ravi Patel', offices: [], umpiring: 'umpire' },
  'social-secretary': { label: 'Social Secretary', id: 'demoWill', name: 'Will Ashford', offices: [], socialSecretaryOf: ['HKFC C'] },
};

/** Mirrors SECTION_OFFICES in worker/src/auth.ts: keep the two in step. */
export const SECTION_OFFICES = {
  membership: ['membershipOfficer', 'sectionCaptain'],
  chairman: ['sectionChair', 'sectionCaptain'],
  kit: ['kitConvenor', 'sectionCaptain'],
  planning: ['sectionCaptain'],
  trials: ['sectionCaptain', 'assistantDirector'],
  registration: ['hockeyConvenor'],
  people: ['membershipOfficer', 'hockeyConvenor', 'sectionCaptain'],
  club: ['sectionCaptain'],
  dataChecks: ['hockeyConvenor', 'sectionCaptain'],
  discipline: ['hockeyConvenor'],
};

/** @param {Persona} p */
export function sectionsOf(p) {
  return Object.keys(SECTION_OFFICES).filter((s) => SECTION_OFFICES[s].some((o) => p.offices.includes(o)));
}
