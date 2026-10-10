// Club stats (one season per request) and the Hockey Rules quizzes.
import type { SeasonStats } from '@/api/stats';
import type { MatchResult, PlayerSeason, TeamSeason, UmpireSeason, WDL } from '@shared/clubStats';
import { SUMMARY_VERSION } from '@shared/clubStats';
import type { QuizScoreBoard, QuizSummary, QuizToTake } from '@shared/quizzes';
import type { Persona } from '../personas.mjs';
import type { Routes } from './routing';
import { OTHERS, PERSONAS, SEASON, SQUAD_PLAYERS, at } from './data';

/** A repeatable pseudo-random sequence, so a season always comes out the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const EXTRA = ['Toby Grant', 'Rafael Diaz', 'Hugo Martin', 'Ian Kwan', 'Zac Palmer', 'Josh Tang', 'Cody Reid', 'Nate Wu', 'Owen Pike', 'Sid Rao',
  'Gabe Lowe', 'Eli Fong', 'Theo Blake', 'Mason Yu', 'Rhys Evans', 'Kai Lo', 'Declan Hart', 'Ollie Shaw', 'Vik Joshi', 'Ruben Cruz'];
const keyOf = (name: string) => SQUAD_PLAYERS.find((p) => p.name === name)?.id ?? `demo${name.replace(/\W/g, '')}`;
const ROSTERS: Record<string, string[]> = {
  'HKFC A': [...OTHERS.filter(([, t]) => t === 'HKFC A').map(([n]) => n), ...EXTRA.slice(0, 10)],
  'HKFC B': [...OTHERS.filter(([, t]) => t === 'HKFC B').map(([n]) => n), ...EXTRA.slice(10, 20)],
  'HKFC C': SQUAD_PLAYERS.filter((p) => p.team === 'HKFC C').map((p) => p.name),
  'HKFC D': [...SQUAD_PLAYERS.filter((p) => p.team === 'HKFC D').map((p) => p.name), 'Rory Blake', 'Jack Moss', 'Dev Anand', 'Sean Kerr'],
};
const DIVS: Record<string, string> = { 'HKFC A': 'Premier', 'HKFC B': 'Division 1', 'HKFC C': 'Division 2', 'HKFC D': 'Division 4' };
const STRENGTH: Record<string, number> = { 'HKFC A': 0.55, 'HKFC B': 0.5, 'HKFC C': 0.6, 'HKFC D': 0.42 };
const OPPS = ['Valley', 'Kowloon CC', 'Dragons', 'Shaheen', 'Khalsa', 'Punjab', 'Tigers', 'Gurkha'];
const VENUES = ['HKFC', 'King’s Park', 'Happy Valley 1', 'Happy Valley 3', 'Po Kong Village Road'];
const UMPS = ['Graham Holt', 'Anita Sharma', 'Pete Lo', 'Martin Kerr', 'Helen Chu', 'Rob Dawson', 'Imran Qureshi', 'Wendy Tam'];

const wdl = (): WDL => ({ w: 0, d: 0, l: 0 });

function seasonStats(season: string, me: Persona): SeasonStats {
  const start = Number(season.slice(0, 4));
  const current = Number(SEASON.slice(0, 4));
  const base = { version: SUMMARY_VERSION, season, generatedAt: new Date().toISOString(), me: me.id, myCards: { yellow: start === current ? 0 : 1, red: 0 } };
  const splits = { appointed: wdl(), duty: wdl(), unknown: wdl() };
  if (!(start >= current - 4 && start <= current)) {
    return { ...base, matches: 0, derbies: 0, teams: [], players: [], umpires: [], umpireSplits: splits, results: [] };
  }
  const r = rng(start * 7919);
  const perTeam = start === current ? 5 : 18;
  const teams: TeamSeason[] = [];
  const players = new Map<string, PlayerSeason>();
  const umpires = new Map<string, UmpireSeason>();
  const results: MatchResult[] = [];
  const firstDay = Date.UTC(start, 8, 6);
  for (const team of Object.keys(ROSTERS)) {
    teams.push({ team, division: DIVS[team], played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cleanSheets: 0, leagues: {}, home: wdl(), away: wdl(), venues: {}, opponents: {} });
  }
  // Week by week, so the results come out oldest first as the summaries hold them.
  for (let g = 0; g < perTeam; g++) {
    for (const t of teams) {
      const team = t.team;
      const roster = ROSTERS[team];
      const div = g >= perTeam - 2 && perTeam > 5 ? 'HKHA Cup' : DIVS[team];
      const opp = `${OPPS[Math.floor(r() * OPPS.length)]}${team === 'HKFC A' ? '' : ` ${'ABC'[Math.floor(r() * 3)]}`}`;
      const home = r() < 0.5;
      const venue = home ? 'HKFC' : VENUES[1 + Math.floor(r() * 4)];
      const s = STRENGTH[team];
      const gf = Math.floor(r() * 4 * s + r() * 1.6);
      const ga = Math.floor(r() * 3 * (1 - s) + r() * 1.4);
      const k: keyof WDL = gf > ga ? 'w' : gf === ga ? 'd' : 'l';
      t.played++; t[k]++; t.gf += gf; t.ga += ga;
      if (ga === 0) t.cleanSheets++;
      const lg = (t.leagues[div] ??= { ...wdl(), gf: 0, ga: 0 });
      lg[k]++; lg.gf += gf; lg.ga += ga;
      t[home ? 'home' : 'away'][k]++;
      (t.venues[venue] ??= wdl())[k]++;
      const o = (t.opponents[opp] ??= { ...wdl(), gf: 0, ga: 0 });
      o[k]++; o.gf += gf; o.ga += ga;
      const date = new Date(firstDay + g * 7 * 86_400_000).toISOString().slice(0, 10);
      const index = results.push({ date, home: home ? team : opp, away: home ? opp : team, homeScore: home ? gf : ga, awayScore: home ? ga : gf, division: div, venue }) - 1;
      const appointed = team === 'HKFC A' || team === 'HKFC B';
      splits[appointed ? 'appointed' : 'duty'][k]++;
      for (const u of [UMPS[Math.floor(r() * UMPS.length)], UMPS[Math.floor(r() * UMPS.length)]]) {
        const e = umpires.get(u) ?? { key: u, name: u, games: 0, appointed: 0, duty: 0, hkfc: wdl(), derbies: 0, cardsToHkfc: 0 };
        e.games++; e[appointed ? 'appointed' : 'duty']++; e.hkfc[k]++;
        if (r() < 0.25) e.cardsToHkfc++;
        umpires.set(u, e);
      }
      const lineup = roster.filter((_, i) => r() < (i < 8 ? 0.92 : 0.6)).slice(0, 14);
      results[index].matchCards = { [home ? 'home' : 'away']: { yellow: g % 3 === 0 ? 1 : 0, red: g === 12 ? 1 : 0 } };
      let goalsLeft = gf;
      lineup.forEach((name, i) => {
        const key = keyOf(name);
        const p = players.get(key) ?? { key, name, teams: {}, played: [] };
        players.set(key, p);
        const line = (p.teams[team] ??= { ...wdl(), apps: 0, goals: 0, captain: 0, keeper: 0, playUps: 0 });
        line.apps++; line[k]++;
        if (i === 1 + (g % 3)) line.captain++;
        if (/Tom Fletcher|Max Keller|Alex Morgan|Adam Walsh/.test(name)) line.keeper++;
        const forward = /Jamie Wong|Kenji Tanaka|Luca Rossi|Sam Carter|Rohan Kapoor|Henry Yip|Arjun Mehta|Isaac Ho/.test(name);
        let goals = 0;
        while (goalsLeft > 0 && r() < (forward ? 0.45 : 0.08)) { line.goals++; goals++; goalsLeft--; }
        p.played!.push([index, goals, home ? 0 : 1]);
      });
    }
  }
  return { ...base, matches: results.length, derbies: 0, teams, players: [...players.values()], umpires: [...umpires.values()], umpireSplits: splits, results };
}

const QUIZZES: QuizSummary[] = [
  { key: 'rules-1', title: 'Hockey Rules: the basics', questions: 10, points: 10, myScore: 8, takenAt: at(-12, 20) },
  { key: 'rules-2', title: 'Hockey Rules: penalty corners', questions: 8, points: 8, myScore: null, takenAt: null },
  { key: 'rules-3', title: 'Hockey Rules: cards and suspensions', questions: 6, points: 6, myScore: null, takenAt: null },
];

const QUIZ: QuizToTake = {
  key: 'rules-2',
  title: 'Hockey Rules: penalty corners',
  intro: 'Eight questions. Pick one answer for each.',
  questions: [
    { id: 'q1', text: 'How many defenders, including the goalkeeper, may stand behind the back line at a penalty corner?', options: [{ id: 'a', label: '4' }, { id: 'b', label: '5' }, { id: 'c', label: '6' }] },
    { id: 'q2', text: 'Where must the ball be injected from?', options: [{ id: 'a', label: 'The back line, at least 10 m from the goal post' }, { id: 'b', label: 'The top of the circle' }] },
  ],
};

function scores(): QuizScoreBoard {
  const people = [PERSONAS.player, ...SQUAD_PLAYERS.slice(1, 8).map((p) => ({ id: p.id, name: p.name }))];
  return {
    quizzes: QUIZZES.map(({ key, title, points }) => ({ key, title, points })),
    people: people.map((p, i) => ({ id: p.id, name: p.name, scores: { 'rules-1': i % 3 === 2 ? null : 6 + (i % 5), 'rules-2': i % 2 ? 5 + (i % 4) : null, 'rules-3': null } })),
  };
}

export const routes: Routes = {
  'GET /api/stats/season': ({ query, persona }) => seasonStats(query.get('season') ?? SEASON, persona),
  'GET /api/quizzes': ({ persona }) => ({ quizzes: QUIZZES, canSeeScores: persona.offices.includes('sectionCaptain') }),
  'GET /api/quizzes/scores': () => scores(),
  'GET /api/quizzes/:key': () => QUIZ,
};
