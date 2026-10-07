import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { WORDMARK_PATH, WORDMARK_VIEWBOX } from '../src/components/brand/EddyWordmark';

// On screen, the product name is <EddyWordmark /> (Fairwater Script, as
// outlines); plain "Eddy" only where the device or another app draws the text:
// the tab title, manifest, push, emails, WhatsApp, calendar, CSV, PDF, and
// alt / aria-label / title on HTML elements (screen readers read "Eddy").
// Those live in .ts files or in the attributes allowed below, so this scan of
// what the .tsx files render catches a plain "Eddy" put back on a screen.

const ROOT = path.resolve(__dirname, '..');
const NAME = /\bEddy\b/;

/** Attributes of HTML/SVG elements that the device reads out or shows as a tooltip, not on the page. */
const ALLOWED_ATTRIBUTES = new Set(['alt', 'aria-label', 'aria-description', 'title']);

/**
 * Exceptions, as "file: text" (the file relative to src/). Each needs a reason.
 * None yet: add one only for text drawn by the device or another app.
 */
const ALLOWED: string[] = [];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : f.endsWith('.tsx') ? [p] : [];
  });
}

const literalText = (n: ts.Node): string | null =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)
    ? n.text
    : ts.isTemplateExpression(n)
      ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join('…')
      : null;

/** Every string in an expression, skipping nested JSX attributes (checked on their own). */
function stringsIn(node: ts.Node, out: string[] = []): string[] {
  const t = literalText(node);
  if (t !== null && !ts.isJsxText(node)) out.push(t);
  ts.forEachChild(node, (c) => {
    if (!ts.isJsxAttribute(c) && !ts.isJsxText(c)) stringsIn(c, out);
  });
  return out;
}

const tagName = (a: ts.JsxAttribute) => {
  const el = a.parent.parent; // JsxAttributes -> JsxOpeningElement / JsxSelfClosingElement
  return ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el) ? el.tagName.getText() : '';
};

/** The plain "Eddy"s a .tsx source renders: JSX text, strings shown as children, on-screen props and prop defaults. */
function plainNames(source: string, fileName = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && NAME.test(n.text)) found.push(n.text.trim());
    if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      found.push(...stringsIn(n.expression).filter((s) => NAME.test(s)));
    }
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText();
      const intrinsic = /^[a-z]/.test(tagName(n));
      if (!(intrinsic && ALLOWED_ATTRIBUTES.has(name))) {
        found.push(...stringsIn(n.initializer).filter((s) => NAME.test(s)).map((s) => `${name}=${s}`));
      }
    }
    // A prop's default (Login's title used to default to 'Eddy').
    if (ts.isBindingElement(n) && n.initializer) {
      found.push(...stringsIn(n.initializer).filter((s) => NAME.test(s)).map((s) => `${n.name.getText()} = ${s}`));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe('the Eddy wordmark', () => {
  it('no .tsx file shows a plain "Eddy"', () => {
    const src = path.join(ROOT, 'src');
    const offenders = files(src)
      .filter((f) => !f.endsWith(path.join('brand', 'EddyWordmark.tsx')))
      .flatMap((f) => plainNames(readFileSync(f, 'utf8'), f).map((t) => `${path.relative(src, f).replace(/\\/g, '/')}: ${t}`))
      .filter((o) => !ALLOWED.includes(o));
    expect(offenders).toEqual([]);
  });

  it('the boot loader in index.html shows the wordmark, not the plain name', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const shown = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(title|script|style)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, ' ');
    expect(shown).not.toMatch(NAME);
    // The same outlines as the component, so the two loaders match.
    expect(html).toContain(`viewBox="${WORDMARK_VIEWBOX}"`);
    expect(html).toContain(`d="${WORDMARK_PATH}"`);
  });

  it('the scan catches each way of showing the name, and allows what screen readers read', () => {
    expect(plainNames('const a = <p>Saved in Eddy</p>;')).toEqual(['Saved in Eddy']);
    expect(plainNames("const a = <p>{ok ? 'In Eddy' : null}</p>;")).toEqual(['In Eddy']);
    expect(plainNames('const a = <p>{`${n} in Eddy`}</p>;')).toEqual(['… in Eddy']);
    expect(plainNames('const a = <Field hint="Eddy reads it" />;')).toEqual(['hint=Eddy reads it']);
    expect(plainNames('const a = <ErrorState title="Eddy is down" />;')).toEqual(['title=Eddy is down']);
    expect(plainNames('const a = <input placeholder="Eddy" />;')).toEqual(['placeholder=Eddy']);
    expect(plainNames("function Login({ title = 'Eddy' }) { return <h1>{title}</h1>; }")).toEqual(['title = Eddy']);
    expect(plainNames('const a = <img alt="Eddy" title="Eddy" aria-label="Eddy" />;')).toEqual([]);
    expect(plainNames("const a = <p>{x === 'eddy' ? <EddyWordmark /> : null}</p>;")).toEqual([]);
  });
});
