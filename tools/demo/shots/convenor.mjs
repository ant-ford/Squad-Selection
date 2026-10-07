// The Men's Convenor guide (eddy-site guides/convenor): HKHA registration,
// Suspensions, Data checks and a person's page, as Chris Tam.
//   node tools/demo/shots/run.mjs convenor ../eddy-site/guides/img

const as = 'mens-convenor';

/** The registration list item for `name`, by its row button. */
const regItem = (name) =>
  `[...document.querySelectorAll('main li')].find((li) => li.querySelector('button[aria-expanded]')?.getAttribute('aria-label')?.includes(${JSON.stringify(name)}))`;

/** The tabs and the list under them. */
const tabsAndList = `[document.querySelector('main [role=tablist]'), document.querySelector('main [role=tabpanel] ul')]`;

/** Types into a React-controlled field. */
const type = (selector, text) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)});
  el.dispatchEvent(new Event('input', { bubbles: true }));`;

export default [
  {
    name: 'conv-menu',
    as,
    path: '/registration',
    steps: async (page) => page.openMenu('Menu'),
    el: `document.querySelector('[role=menu]')`,
  },
  { name: 'conv-registration', as, path: '/registration' },
  {
    name: 'conv-reg-player',
    as,
    path: '/registration',
    steps: async (page) => page.click('Tom Reid'),
    el: regItem('Tom Reid'),
    pad: 4,
  },
  {
    name: 'conv-reg-name',
    as,
    path: '/registration',
    steps: async (page) => page.click('Callum Reeves'),
    el: `${regItem('Callum Reeves')}.querySelector('input[id^="rn-"]').closest('div.flex-wrap')`,
  },
  { name: 'conv-reg-missing', as, path: '/registration?view=missing' },
  { name: 'conv-suspensions', as, path: '/suspensions' },
  {
    name: 'conv-susp-add',
    as,
    path: '/suspensions?person=demoP109',
    steps: async (page) => {
      await page.sleep(400);
      await page.click('Increase');
      await page.eval(type('[role=dialog] textarea', 'Red card v Kowloon CC C.'));
    },
  },
  {
    name: 'conv-susp-cards',
    as,
    path: '/suspensions',
    steps: async (page) => page.click('Cards', { selector: '[role=tab]' }),
    el: tabsAndList,
  },
  { name: 'conv-checks', as, path: '/data-checks', el: tabsAndList },
  {
    name: 'conv-link-card',
    as,
    path: '/data-checks',
    steps: async (page) => page.click('Link', { exact: true, nth: 1 }),
  },
  {
    name: 'conv-rereg',
    as,
    path: '/data-checks',
    steps: async (page) => page.click('Re-registrations', { selector: '[role=tab]' }),
    el: `document.querySelector('main [role=tabpanel] ul')`,
  },
  { name: 'conv-people', as, path: '/people?q=ha' },
  { name: 'conv-person', as, path: '/people/demoP102' },
];
