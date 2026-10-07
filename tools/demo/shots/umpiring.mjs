// The umpiring guide (eddy-site guides/umpiring): the Umpire Coordinator's
// week, then the club's umpires.
//   node tools/demo/shots/run.mjs umpiring ../eddy-site/guides/img
const UC = 'umpire-coordinator';
const UMP = 'umpire';

/** The duty card (li) whose text includes `game`; `nth` for a second slot of the same game. */
const card = (game, nth = 0) =>
  `[...document.querySelectorAll('main li')].filter((l) => l.querySelector('p') && l.innerText.includes(${JSON.stringify(game)}))[${nth}]`;

/** Clicks the button labelled `label` inside a card. */
const clickIn = (game, label, nth = 0) => `
  const li = ${card(game, nth)};
  const b = [...li.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(label)});
  b.scrollIntoView({ block: 'center' });
  b.click();`;

/** Sets a React-controlled <select> or <input> (the nth inside a card) and fires its event. */
const setField = (game, tag, i, value, nth = 0) => `
  const el = ${card(game, nth)}.querySelectorAll(${JSON.stringify(tag)})[${i}];
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`;

/** The value of the option whose text starts with `text`, in the nth select of a card. */
const optionValue = (game, i, text) => `
  const sel = ${card(game)}.querySelectorAll('select')[${i}];
  return [...sel.options].find((o) => o.text.startsWith(${JSON.stringify(text)})).value;`;

const messages = `[...document.querySelectorAll('main section')].filter((s) => /group$/.test(s.querySelector('h3')?.textContent ?? ''))`;

export default [
  // ── The coordinator ──
  { name: 'ump-board', as: UC, path: '/umpiring' },
  {
    name: 'ump-assign',
    as: UC,
    path: '/umpiring',
    steps: async (p) => {
      await p.eval(clickIn('Kowloon CC B vs Dragons B', 'Assign'));
      await p.sleep(300);
      const v = await p.eval(optionValue('Kowloon CC B vs Dragons B', 0, 'Henry Yip'));
      await p.eval(setField('Kowloon CC B vs Dragons B', 'select', 0, v));
      await p.sleep(300);
    },
    el: card('Kowloon CC B vs Dragons B'),
    pad: 4,
  },
  {
    name: 'ump-outside',
    as: UC,
    path: '/umpiring',
    steps: async (p) => {
      await p.eval(clickIn('Tigers vs Shaheen B', 'Assign'));
      await p.sleep(300);
      await p.eval(setField('Tigers vs Shaheen B', 'select', 1, '\u0000new'));
      await p.sleep(300);
      await p.eval(setField('Tigers vs Shaheen B', 'input', 0, 'Rufus Pemberto'));
      await p.sleep(300);
    },
    el: card('Tigers vs Shaheen B'),
    pad: 4,
  },
  { name: 'ump-offer', as: UC, path: '/umpiring', el: card('Khalsa A vs Valley A'), pad: 4 },
  { name: 'ump-clash', as: UC, path: '/umpiring', el: card('Punjab B vs Tigers B'), pad: 4 },
  { name: 'ump-cancelled', as: UC, path: '/umpiring', el: card('Dragons vs Punjab'), pad: 4 },
  { name: 'ump-moved', as: UC, path: '/umpiring', el: card('Shaheen vs Valley A'), pad: 4 },
  {
    // Last weekend: the No-show buttons, and one marked.
    name: 'ump-noshow',
    as: UC,
    path: '/umpiring',
    steps: async (p) => {
      await p.click('Previous week');
      await p.settle();
    },
    el: `[${card('Tigers B vs Dragons B')}, ${card('Valley A vs Shaheen B')}]`,
    pad: 4,
  },
  { name: 'ump-messages', as: UC, path: '/umpiring', el: messages, pad: 4 },
  {
    name: 'ump-season',
    as: UC,
    path: '/umpiring',
    steps: async (p) => {
      await p.click('Season', { selector: '[role=tab]' });
      await p.settle();
    },
  },

  // ── The club's umpires ──
  { name: 'ump-umpire', as: UMP, path: '/umpiring' },
  { name: 'ump-offered', as: UMP, path: '/umpiring', el: card('Tigers vs Shaheen B', 1), pad: 4 },
  {
    name: 'ump-duty-line',
    as: UMP,
    path: '/',
    el: `[...document.querySelectorAll('main a[href="/umpiring"], #root a[href="/umpiring"]')].find((a) => a.innerText.includes('Your duty'))`,
    pad: 8,
  },
];
