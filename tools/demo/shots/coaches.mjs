// The coaches' guide (eddy-site guides/coaches), as Jo Bennett, coach of HKFC C and D.
const SQUAD = '/coach/match/demoM1-home';
// Squad rows are virtualised: scroll to the end so the HKFC D rows are drawn, then crop one.
const row = (name) => `[...document.querySelectorAll('[data-index]')].find((e) => e.innerText.includes(${JSON.stringify(name)}))`;
const toEnd = (page) => page.eval('window.scrollTo(0, document.body.scrollHeight)');
const header = `document.querySelector('header')`;

export default [
  { name: 'coach-switch', as: 'coach', path: '/coach', el: header, pad: 0 },
  { name: 'coach-menu', as: 'coach', path: '/coach', steps: (page) => page.openMenu('Menu'), el: `[${header}, document.querySelector('[role=menu]')]`, pad: 0 },
  { name: 'coach-dashboard', as: 'coach', path: '/coach' },
  { name: 'coach-popover', as: 'coach', path: '/coach', steps: (page) => page.click('3 no') },
  { name: 'squad', as: 'coach', path: SQUAD },
  { name: 'squad-save', as: 'coach', path: SQUAD, steps: async (page) => { await page.click('Noah Singh', { selector: '[data-index] *, button' }); } },
  { name: 'volunteers', as: 'coach', path: '/volunteers' },
  { name: 'row-playups', as: 'coach', path: SQUAD, steps: toEnd, el: row('Isaac Ho'), pad: 4 },
  { name: 'row-playups-amber', as: 'coach', path: SQUAD, steps: toEnd, el: row('Charlie Dunn'), pad: 4 },
  { name: 'row-support', as: 'coach', path: SQUAD, steps: toEnd, el: row('Leo Barros'), pad: 4 },
  {
    name: 'coach-availability', as: 'coach', path: SQUAD,
    steps: (page) => page.eval(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Maybe' && b.closest('[data-index]')?.innerText.includes('Noah Singh')).click()`),
  },
  { name: 'autoselect', as: 'coach', path: SQUAD, steps: (page) => page.click('Auto-select') },
  { name: 'notify', as: 'coach', path: SQUAD, steps: (page) => page.click('Notify') },
  { name: 'ranking', as: 'coach', path: '/coach/ranking' },
  { name: 'ranking-menu', as: 'coach', path: '/coach/ranking', steps: (page) => page.openMenu('More actions for Rohan Kapoor') },
  {
    name: 'attendance', as: 'coach', path: '/coach/ranking',
    steps: async (page) => { await page.openMenu('More actions for Sam Carter'); await page.click('Attendance', { selector: '[role=menuitem]' }); },
  },
  { name: 'team-availability', as: 'coach', path: '/coach/availability', steps: (page) => page.click('Expand all') },
  { name: 'season-plans', as: 'coach', path: '/season-plans' },
];
