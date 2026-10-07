// Every screen in README.md's "Screens and who opens them" table, with the
// demo personas that open it. smoke.mjs visits each path as each persona.
// A new screen in that table gets a line here (and fixtures for its calls).

const EVERYONE = ['player', 'coach', 'section-captain', 'mens-convenor', 'membership-officer', 'kit-convenor', 'umpire-coordinator', 'umpire', 'social-secretary'];
const COACHES = ['coach', 'section-captain'];

/** @type {{ path: string, who: string[], screen: string }[]} */
export const SCREENS = [
  { screen: 'Player view', path: '/', who: EVERYONE },
  { screen: 'Coach view', path: '/coach', who: COACHES },
  { screen: 'Squad selection', path: '/coach/match/demoM1-home', who: COACHES },
  { screen: 'Ranking', path: '/coach/ranking', who: COACHES },
  { screen: 'Team availability', path: '/coach/availability', who: COACHES },
  { screen: 'Umpire view', path: '/umpiring', who: ['umpire', 'umpire-coordinator', 'section-captain'] },
  { screen: 'Membership', path: '/membership', who: ['membership-officer', 'section-captain'] },
  { screen: 'Email lists', path: '/chairman', who: ['section-captain'] },
  { screen: 'Kit', path: '/kit', who: ['kit-convenor', 'section-captain'] },
  { screen: 'Season plans', path: '/season-plans', who: COACHES },
  { screen: 'Trial sessions', path: '/trial-sessions', who: ['section-captain'] },
  { screen: 'HKHA registration', path: '/registration', who: ['mens-convenor'] },
  { screen: 'People', path: '/people', who: ['membership-officer', 'mens-convenor', 'section-captain'] },
  { screen: "A person's admin page", path: '/people/demoP102', who: ['membership-officer', 'mens-convenor', 'section-captain'] },
  { screen: 'Suspensions', path: '/suspensions', who: ['mens-convenor'] },
  { screen: 'Offices and teams', path: '/club', who: ['section-captain'] },
  { screen: 'Data checks', path: '/data-checks', who: ['mens-convenor', 'section-captain'] },
  { screen: 'Events', path: '/events/manage', who: ['social-secretary', 'section-captain'] },
  { screen: 'An event', path: '/events/manage/demoEv1', who: ['social-secretary', 'section-captain'] },
  { screen: 'Volunteers', path: '/volunteers', who: ['coach', 'section-captain', 'membership-officer', 'kit-convenor'] },
  { screen: 'System', path: '/system', who: ['section-captain'] },
  { screen: 'Stats', path: '/stats', who: ['player', 'section-captain'] },
  { screen: 'Quizzes', path: '/quizzes', who: ['player', 'section-captain'] },
  // Not in the table, but in the players' guide.
  { screen: 'My details', path: '/my-details', who: ['player'] },
  { screen: 'My volunteering', path: '/volunteering', who: ['player'] },
];
