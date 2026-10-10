// The players' guide (eddy-site guides/players), as Sam Carter.
const card = (text) => `[...document.querySelectorAll('[role=button]')].find((e) => e.innerText.includes(${JSON.stringify(text)}))`;
const cardButton = (text, label) =>
  `[...${card(text)}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(label)}).click()`;
const account = async (page, item) => {
  await page.openMenu('My account');
  await page.click(item, { selector: '[role=menuitem]' });
};

export default [
  { name: 'home', as: 'player', path: '/' },
  {
    name: 'account-menu', as: 'player', path: '/',
    steps: (page) => page.openMenu('My account'),
    el: `[document.querySelector('header'), document.querySelector('[role=menu]')]`, pad: 0,
  },
  { name: 'card-selected', as: 'player', path: '/', el: card('Valley B'), pad: 8 },
  { name: 'card-maybe', as: 'player', path: '/', el: card('Kowloon CC A'), pad: 8 },
  { name: 'note-sheet', as: 'player', path: '/', steps: (page) => page.eval(cardButton('Shaheen', 'Maybe')) },
  { name: 'fixture-sheet', as: 'player', path: '/', steps: (page) => page.eval(`${card('Valley B')}.click()`) },
  {
    name: 'same-day', as: 'player', path: '/',
    steps: async (page) => {
      await page.eval(cardButton('Valley B', 'No'));
      await page.settle();
      await page.eval(`const el = document.querySelector('[role=dialog] textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Away all day'); el.dispatchEvent(new Event('input', { bubbles: true }));`);
      await page.click('Save answer', { exact: true });
      await page.settle();
    },
    el: `[...document.querySelectorAll('div,section')].filter((e) => /^(Other games on|You're out for all of)/.test(e.innerText ?? '')).pop()`, pad: 10,
  },
  {
    name: 'playups', as: 'player', path: '/',
    steps: (page) => page.click('Play-up opportunities'),
    el: `[...document.querySelectorAll('button')].find((b) => /^play-up opportunities/i.test(b.innerText.trim())).parentElement`, pad: 8,
  },
  { name: 'prefs', as: 'player', path: '/', steps: async (page) => { await account(page, 'Availability preferences'); await page.click('Add a preference'); } },
  { name: 'calendar', as: 'player', path: '/', steps: async (page) => { await account(page, 'Sync to calendar'); await page.click('Get calendar link'); } },
  { name: 'details-kit', as: 'player', path: '/my-details?step=kit' },
  { name: 'kit-player', as: 'player', path: '/', el: `document.querySelector('section[aria-label=Kit]')`, pad: 8 },
  { name: 'kit-offered', as: 'player:kit-offered', path: '/', el: `document.querySelector('section[aria-label=Kit]')`, pad: 8 },
  {
    name: 'invite', as: 'player', path: '/',
    steps: async (page) => { await page.openMenu('Menu'); await page.click('Invite someone to join', { selector: '[role=menuitem]' }); },
  },
  {
    name: 'stats', as: 'player', path: '/',
    steps: async (page) => {
      await account(page, 'My season stats');
      await page.eval(`const v = [...document.querySelectorAll('[role=dialog] *')].find((e) => e.scrollHeight > e.clientHeight + 20); if (v) v.scrollTop = v.scrollHeight;`);
    },
  },
  { name: 'stats-club', as: 'player', path: '/stats' },
  { name: 'stats-teams', as: 'player', path: '/stats', steps: (page) => page.click('Teams', { selector: '[role=tab]', exact: true }) },
  {
    name: 'stats-career', as: 'player', path: '/stats',
    steps: async (page) => { await page.click('Players', { selector: '[role=tab]', exact: true }); await page.click('My career'); },
  },
  { name: 'stats-charms', as: 'player', path: '/stats', steps: (page) => page.click('Charms', { selector: '[role=tab]', exact: true }) },
];
