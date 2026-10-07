// The social secretaries' events guide (eddy-site guides/events): Will Ashford
// (HKFC C's social secretary), Alex Morgan (a Section Captain, who keeps every
// event) and Sam Carter (a player) on the demo events in fixtures/events.ts.
// Variants used: section-captain:charges-sent, player:checkin-open.

/** The smallest <section> with a heading starting `heading`. */
const section = (heading) =>
  `[...document.querySelectorAll('section')].filter((s) => [...s.querySelectorAll('h2,h3')].some((h) => h.innerText.trim().startsWith(${JSON.stringify(heading)}))).sort((a, b) => a.innerText.length - b.innerText.length)[0]`;
/** A form field (label and control) by its label. */
const field = (label) =>
  `[...document.querySelectorAll('main label')].find((l) => l.innerText.replace('*', '').trim() === ${JSON.stringify(label)}).parentElement`;
const fieldset = (legend) => `[...document.querySelectorAll('main fieldset')].find((f) => f.querySelector('legend')?.innerText.trim() === ${JSON.stringify(legend)})`;
const tabPanel = `document.querySelector('[role=tabpanel]')`;

/** Types into the element a selector finds, as a person would. */
const type = async (page, selector, text) => {
  await page.eval(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('type: ' + ${JSON.stringify(selector)}); el.focus(); el.select?.();`);
  await page.send('Input.insertText', { text });
  await page.sleep(300);
};
/** Sets a select or input (date pickers) the way React notices. */
const setValue = async (page, expr, value) => {
  await page.eval(`const el = ${expr}; if (!el) throw new Error('setValue: nothing matches');
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));`);
  await page.sleep(250);
};
const control = (label) => `${field(label)}.querySelector('input,select,textarea')`;

// The Christmas Party: the second Friday of December.
const xmas = (() => {
  const now = new Date();
  const y = now.getMonth() === 11 && now.getDate() > 14 ? now.getFullYear() + 1 : now.getFullYear();
  const d = new Date(Date.UTC(y, 11, 1));
  d.setUTCDate(1 + ((5 - d.getUTCDay() + 7) % 7) + 7);
  const day = (n) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return { on: day(0), answerBy: day(-7) };
})();

/**
 * A filled-in form asks "Leave site?" when the next shot navigates away:
 * accept it, so the run doesn't stall.
 */
const acceptLeave = (page) => {
  if (page.acceptsLeave) return;
  page.acceptsLeave = true;
  page.on((msg) => {
    if (msg.method === 'Page.javascriptDialogOpening') void page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
};

/** The new event form, filled in as the Christmas Party (a Section Captain: club-wide). */
const christmasForm = async (page) => {
  acceptLeave(page);
  await setValue(page, `[...document.querySelectorAll('main select')].find((s) => [...s.options].some((o) => o.value === 'Christmas Party'))`, 'Christmas Party');
  await type(page, 'main input[name=title]', 'Christmas Party');
  await setValue(page, control('Starts'), `${xmas.on}T19:30`);
  await setValue(page, control('Ends'), `${xmas.on}T23:30`);
  await setValue(page, control('Answer by'), `${xmas.answerBy}T18:00`);
  await type(page, `main input[placeholder^="e.g. HKFC"]`, "Members' Bar, HKFC");
  await page.eval('document.activeElement?.blur()');
};
const paymentForm = async (page) => {
  acceptLeave(page);
  await setValue(page, control('Payment'), 'account');
  await type(page, 'main input[type=number]', '350');
  await page.click('Members can bring guests', { selector: 'label' });
  await page.click('Dietary requirements', { selector: 'label' });
  await page.click('Required', { selector: 'label' });
  await page.eval('document.activeElement?.blur()');
};

export default [
  // Players
  { name: 'ev-sheet', as: 'player', path: '/?event=demoEv2' },
  { name: 'ev-poster', as: 'player', path: '/?event=demoEv2', steps: (page) => page.click('poster full size', { wait: 1500 }) },
  {
    name: 'ev-answer', as: 'player', path: '/?event=demoEv2',
    steps: async (page) => {
      acceptLeave(page);
      await page.click('Going', { selector: '[role=radio]', exact: true });
      await page.click('Add a guest');
      await type(page, '[aria-label="Guest 1 name"]', 'Mia Carter');
      await type(page, '[aria-label="Guest 1 dietary requirements"]', 'Vegetarian');
      await page.eval(`[...document.querySelectorAll('[role=dialog] label')].find((l) => l.innerText.startsWith('Your dietary')).querySelector('input').setAttribute('data-shot', 'diet')`);
      await type(page, '[data-shot=diet]', 'No nuts');
      await page.eval('document.activeElement?.blur()');
    },
    el: section('Are you coming?'), pad: 8,
  },
  { name: 'ev-bill', as: 'player', path: '/?event=demoEv1', el: section('Your bill'), pad: 8 },
  {
    name: 'ev-signup', as: 'player', path: '/?event=demoEv2',
    steps: async (page) => {
      await page.click('Sign up someone else');
      await type(page, '[aria-label="Search players by name"]', 'ch');
      await page.sleep(600);
    },
    el: section("Other players you're signing up"), pad: 8,
  },
  { name: 'ev-checkin', as: 'player:checkin-open', path: '/checkin/demoEv4?c=demo3f9a1c7e5b2d' },

  // Social secretaries
  { name: 'ev-menu', as: 'social-secretary', path: '/', steps: (page) => page.openMenu('Menu'), el: `[document.querySelector('header'), document.querySelector('[role=menu]')]`, pad: 0 },
  { name: 'ev-secs', as: 'section-captain', path: '/events/manage', el: section('Team social secretaries'), pad: 8 },
  { name: 'ev-form', as: 'section-captain', path: '/events/manage/new', steps: christmasForm, el: `[${field('Type')}, ${field('Location')}]`, pad: 12 },
  { name: 'ev-form-pay', as: 'section-captain', path: '/events/manage/new', steps: paymentForm, el: `[${field('Payment')}, ${fieldset('Ask people for')}]`, pad: 12 },
  { name: 'ev-form-who', as: 'section-captain', path: '/events/manage/new', el: fieldset("Who's invited"), pad: 8 },
  { name: 'ev-detail', as: 'section-captain', path: '/events/manage/demoEv2' },
  { name: 'ev-answers', as: 'section-captain', path: '/events/manage/demoEv2?tab=answers', el: tabPanel, pad: 8 },
  { name: 'ev-payme', as: 'social-secretary', path: '/events/manage/demoEv1?tab=payments', el: tabPanel, pad: 8 },
  { name: 'ev-treasurer', as: 'section-captain:charges-sent', path: '/events/manage/demoEv2?tab=payments', el: tabPanel, pad: 8 },
  { name: 'ev-register', as: 'section-captain', path: '/events/manage/demoEv4?tab=register', el: tabPanel, pad: 8 },
  { name: 'ev-qr', as: 'section-captain', path: '/events/manage/demoEv4', steps: (page) => page.click('Check-in QR code', { wait: 800 }) },
];
