// The Kit Convenor's guide (eddy-site guides/kit), as Dan Marsh.
const header = `document.querySelector('header')`;
const set = (no) => `[...document.querySelectorAll('button, [role=button]')].find((e) => new RegExp('^#?${no}\\\\b').test(e.innerText.trim()))`;
const filter = (label) => (page) => page.click(label, { selector: 'button' });

export default [
  { name: 'kit-header', as: 'kit-convenor', path: '/', steps: (page) => page.openMenu('Menu'), el: `[${header}, document.querySelector('[role=menu]')]`, pad: 0 },
  { name: 'kit-arrive', as: 'kit-convenor', path: '/kit?order=demoOrder2' },
  { name: 'kit-board', as: 'kit-convenor', path: '/kit' },
  {
    name: 'kit-handout', as: 'kit-convenor', path: '/kit',
    steps: async (page) => {
      await page.click('Hand out kit');
      await page.eval(`const i = document.querySelector('[role=dialog] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Ben'); i.dispatchEvent(new Event('input', { bubbles: true }));`);
      await page.sleep(400);
      await page.click('Ben Hughes', { selector: '[role=dialog] button, [role=dialog] [role=option], [role=dialog] li' });
    },
  },
  { name: 'kit-set', as: 'kit-convenor', path: '/kit', steps: (page) => page.eval(`${set(12)}.click()`) },
  { name: 'kit-sizes', as: 'kit-convenor', path: '/kit', steps: filter('Size issues') },
  { name: 'kit-swap', as: 'kit-convenor', path: '/kit', steps: async (page) => { await filter('Size issues')(page); await page.eval(`${set(66)}.click()`); } },
  { name: 'kit-needs', as: 'kit-convenor', path: '/kit', steps: filter('Needs kit') },
  { name: 'kit-spare', as: 'kit-convenor', path: '/kit', steps: async (page) => { await filter('Needs kit')(page); await page.click('Spare #11'); } },
  { name: 'kit-insights', as: 'kit-convenor', path: '/kit', steps: filter('Insights') },
  { name: 'kit-captain', as: 'player:kit-holding', path: '/', el: `document.querySelector('section[aria-label=Kit]')`, pad: 8 },
  { name: 'kit-player', as: 'player', path: '/', el: `document.querySelector('section[aria-label=Kit]')`, pad: 8 },
  { name: 'kit-offered', as: 'player:kit-offered', path: '/', el: `document.querySelector('section[aria-label=Kit]')`, pad: 8 },
];
