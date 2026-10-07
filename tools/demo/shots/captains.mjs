// The Section Captains' guide (eddy-site guides/captains): offices and
// teams, People and a person's page, making players inactive, System.
//   node tools/demo/shots/run.mjs captains ../eddy-site/guides/img
const SC = 'section-captain';

/** A person-page block, by its heading (AdminBlock's aria-label). */
const block = (title) => `document.querySelector('main section[aria-label=${JSON.stringify(title)}]')`;

/** Opens the ⋮ menu of the nth ranking row (Radix opens on pointerdown). */
const rowMenu = (nth) => `
  const b = document.querySelectorAll('[aria-label^="More actions for"]')[${nth}];
  b.scrollIntoView({ block: 'center' });
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));`;

/** Waits (up to 10 s) until `selector` matches, for the lazy-loaded ranking. */
const waitFor = (selector) => `
  for (let i = 0; i < 100 && !document.querySelector(${JSON.stringify(selector)}); i++) await new Promise((r) => setTimeout(r, 100));`;

export default [
  // The burger: every officer screen a Section Captain opens.
  { name: 'cap-menu', as: SC, path: '/', steps: (p) => p.openMenu('Menu') },
  { name: 'cap-offices', as: SC, path: '/club' },
  { name: 'cap-handover', as: SC, path: '/club', steps: (p) => p.click('Hand over') },
  {
    name: 'cap-teams',
    as: SC,
    path: '/club',
    steps: async (p) => {
      await p.click('Teams', { selector: '[role=tab]' });
      await p.settle();
      await p.click('HKFC C');
    },
  },
  { name: 'cap-people', as: SC, path: '/people?q=ar' },
  { name: 'cap-person', as: SC, path: '/people/demoP102' },
  { name: 'cap-squad', as: SC, path: '/people/demoP102', el: `[${block('Stage')}, ${block('Squad')}, ${block('Active')}]`, pad: 6 },
  {
    name: 'cap-ranking-menu',
    as: SC,
    path: '/coach/ranking',
    steps: async (p) => {
      await p.eval(waitFor('[aria-label^="More actions for"]'));
      await p.eval(rowMenu(3));
      await p.sleep(400);
    },
  },
  {
    name: 'cap-inactive',
    as: SC,
    path: '/coach/ranking',
    steps: async (p) => {
      await p.eval(waitFor('[aria-label^="More actions for"]'));
      await p.click('Inactive', { selector: '[role=tab]' });
      await p.settle();
    },
    el: `[document.querySelector('[role=tablist]'), document.querySelector('[role=tabpanel] ul')]`,
    pad: 8,
  },
  { name: 'cap-system', as: SC, path: '/system' },
];
