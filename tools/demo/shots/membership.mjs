// The Membership Officer guide (eddy-site guides/membership): People and a
// person's page, as Daniel Price.
//   node tools/demo/shots/run.mjs membership ../eddy-site/guides/img

const as = 'membership-officer';

/** A person page block by its heading. */
const block = (title) => `document.querySelector('main section[aria-label=${JSON.stringify(title)}]')`;

export default [
  {
    name: 'mo-menu',
    as,
    path: '/people',
    steps: async (page) => page.openMenu('Menu'),
    el: `document.querySelector('[role=menu]')`,
  },
  { name: 'mo-people', as, path: '/people?q=re' },
  { name: 'mo-person', as, path: '/people/demoP102' },
  {
    name: 'mo-membership',
    as,
    path: '/people/demoP102',
    steps: async (page) =>
      page.eval(`
        const input = [...document.querySelectorAll('${'main section[aria-label="Membership"] input'}')].find((i) => i.type === 'text');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'D20418');
        input.dispatchEvent(new Event('input', { bubbles: true }));`),
    el: block('Membership'),
  },
  { name: 'mo-stage', as, path: '/people/demoP102', el: block('Stage') },
  {
    name: 'mo-history',
    as,
    path: '/people/demoP102',
    el: `[${block('History')}.querySelector('h2'), ...${block('History')}.querySelectorAll('li')].slice(0, 6)`,
  },
  { name: 'mo-board', as, path: '/membership' },
];
