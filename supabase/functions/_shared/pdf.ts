/**
 * Fills Eddy's PDF templates: the renderer behind the render-pdf Edge
 * Function. It knows nothing about members or forms. The Worker sends a
 * spec (which template, which fields, what text where) and the bytes it
 * needs (templates, signatures, photos), and gets one flattened PDF back.
 *
 * It runs on Supabase's Edge Functions rather than in the Worker because a
 * free Worker gets 10 ms of CPU, and loading a template and embedding
 * images takes far more (owner decision, 29 Sep 2026: the free route only).
 *
 * Self-contained, with no relative imports, so Deno (the function) and
 * Node (the tests, and the Worker's types) both load it as it is.
 *
 * Text is drawn in Helvetica. Text Helvetica cannot draw (Chinese names
 * and addresses) is drawn in the Chinese font when the request carries one
 * (the CJK_FONT asset: Noto Sans TC, Hong Kong's Big5-HKSCS characters),
 * embedded with only the characters used. Anything neither can draw is
 * left out and reported in `warnings`, never a failure.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField, StandardFonts, type PDFField, type PDFFont, type PDFForm, type PDFImage, type PDFPage } from "pdf-lib";

/** The asset name of the optional Chinese font (a TrueType file). */
export const CJK_FONT = "cjk-font";

/** Text placed at a spot on a flat template (PDF points, origin bottom left). */
export interface TextItem {
  /** 1-based page of the template. */
  page: number;
  x: number;
  /** The text's baseline. */
  y: number;
  text: string;
  /** Font size in points (default 9); shrunk to fit `maxWidth`. */
  size?: number;
  maxWidth?: number;
}

/** An image (a signature, a photo) fitted inside a box, keeping its shape. */
export interface ImageItem {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Name of the asset holding the PNG or JPEG. */
  asset: string;
}

export type DocumentPart =
  | {
      kind: "template";
      /** Name of the asset holding the blank template. */
      asset: string;
      /** Form fields: text for a text field, true/false for a checkbox, the option for a radio group. */
      fields?: Record<string, string | boolean>;
      /** An image drawn over a field's box (signature and photo fields), by field name. */
      fieldImages?: Record<string, string>;
      text?: TextItem[];
      images?: ImageItem[];
      /** 1-based pages to keep, in order; all when left out. */
      pages?: number[];
    }
  /** A supporting document photographed or scanned: one A4 page. */
  | { kind: "image"; asset: string; caption?: string }
  /** A PDF someone uploaded, appended as it is. */
  | { kind: "pdf"; asset: string; caption?: string };

export interface RenderSpec {
  title: string;
  parts: DocumentPart[];
}

export interface Rendered {
  pdf: Uint8Array;
  pages: number;
  /** What could not be drawn, e.g. characters Helvetica cannot encode. Never personal values. */
  warnings: string[];
}

export class RenderError extends Error {
  override name = "RenderError";
}

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 36;

/** Typographic punctuation people type or paste, as plain equivalents. */
function normalise(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n");
}

function canDraw(font: PDFFont, ch: string): boolean {
  try {
    font.encodeText(ch);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the characters `has` accepts (and line breaks); reports how many were dropped. */
function keep(text: string, has: (ch: string) => boolean, warnings: string[], where: string): string {
  let out = "";
  let dropped = 0;
  for (const ch of text) {
    if (ch === "\n" || has(ch)) out += ch;
    else dropped++;
  }
  if (dropped) warnings.push(`${where}: ${dropped} character(s) the font cannot draw were left out`);
  return out;
}

/** Keeps the characters a standard font can draw; reports how many were dropped. */
export function drawable(font: PDFFont, text: string, warnings: string[], where: string): string {
  return keep(normalise(text), (ch) => canDraw(font, ch), warnings, where);
}

/** A document's fonts: Helvetica, and the Chinese font embedded only when some text needs it. */
interface CjkFont {
  font: PDFFont;
  /** Whether the font has a glyph for the character (an embedded font draws a blank box for one it lacks). */
  has: (ch: string) => boolean;
}

interface Fonts {
  latin: PDFFont;
  cjk: () => Promise<CjkFont | null>;
}

async function fontsFor(doc: PDFDocument, assets: Record<string, Uint8Array>, bold = false): Promise<Fonts> {
  const latin = await doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  let cjk: Promise<CjkFont> | null = null;
  return {
    latin,
    cjk: () => {
      const bytes = assets[CJK_FONT];
      if (!bytes) return Promise.resolve(null);
      cjk ??= (async () => {
        doc.registerFontkit(fontkit);
        const font = await doc.embedFont(bytes, { subset: true });
        const face = fontkit.create(bytes);
        return { font, has: (ch: string) => face.hasGlyphForCodePoint(ch.codePointAt(0) ?? 0) };
      })();
      return cjk;
    },
  };
}

/** The font to draw `text` in, and the text as that font can draw it. */
async function pick(fonts: Fonts, text: string, warnings: string[], where: string): Promise<{ font: PDFFont; text: string }> {
  const plain = normalise(text);
  if ([...plain].every((ch) => ch === "\n" || canDraw(fonts.latin, ch))) return { font: fonts.latin, text: plain };
  const cjk = await fonts.cjk();
  if (!cjk) return { font: fonts.latin, text: drawable(fonts.latin, plain, warnings, where) };
  return { font: cjk.font, text: keep(plain, cjk.has, warnings, where) };
}

function asset(assets: Record<string, Uint8Array>, name: string): Uint8Array {
  const bytes = assets[name];
  if (!bytes) throw new RenderError(`Missing asset "${name}"`);
  return bytes;
}

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

async function embedImage(doc: PDFDocument, bytes: Uint8Array, name: string) {
  if (isPng(bytes)) return doc.embedPng(bytes);
  if (isJpeg(bytes)) return doc.embedJpg(bytes);
  throw new RenderError(`Asset "${name}" is not a PNG or JPEG`);
}

/** Draws an image inside a box, as large as fits, centred. */
function drawFitted(page: PDFPage, image: PDFImage, box: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height });
}

function pageOf(doc: PDFDocument, n: number, where: string): PDFPage {
  const pages = doc.getPages();
  if (!Number.isInteger(n) || n < 1 || n > pages.length) throw new RenderError(`${where}: no page ${n}`);
  return pages[n - 1];
}

/**
 * Takes a field off the form. pdf-lib's own removal looks up each box's
 * appearance and fails on boxes that have none (some of the club's
 * signature boxes), so those are unhooked from their pages by hand.
 */
function removeField(doc: PDFDocument, form: PDFForm, field: PDFField) {
  try {
    form.removeField(field);
    return;
  } catch {
    // fall through
  }
  for (const widget of field.acroField.getWidgets()) {
    const ref = doc.context.getObjectRef(widget.dict);
    if (ref) for (const page of doc.getPages()) page.node.removeAnnot(ref);
  }
  form.acroForm.removeField(field.acroField);
}

/** The size an auto-sized field (font size 0) starts from: pdf-lib would fill the box's height. */
const AUTO_SIZE = 10;

/**
 * A one-line field gets a smaller font when the text would run past its
 * box: from its own size (many of the club's are 12 pt), or for auto-sized
 * fields from 10 pt, so text in neighbouring boxes looks alike.
 */
function shrinkToFit(field: PDFTextField, font: PDFFont, text: string) {
  if (!text) return;
  const da = field.acroField.getDefaultAppearance();
  // A few of the club's fields have no default appearance; give them one to size.
  if (!da) field.acroField.setDefaultAppearance("/Helv 0 Tf 0 g");
  const own = Number(/(\d+(?:\.\d+)?)\s+Tf/.exec(da ?? "")?.[1] ?? 0);
  // Multi-line boxes wrap; an auto-sized one would fill its height with one line.
  if (field.isMultiline()) {
    if (!own) field.setFontSize(AUTO_SIZE);
    return;
  }
  const rect = field.acroField.getWidgets()[0]?.getRectangle();
  if (!rect?.width) return;
  const size = own || Math.min(AUTO_SIZE, Math.max(6, rect.height - 4));
  let fitted = size;
  while (fitted > 6 && font.widthOfTextAtSize(text, fitted) > rect.width - 4) fitted -= 0.5;
  if (fitted !== own) field.setFontSize(fitted);
}

async function renderTemplate(
  part: Extract<DocumentPart, { kind: "template" }>,
  assets: Record<string, Uint8Array>,
  warnings: string[],
): Promise<PDFDocument> {
  const doc = await PDFDocument.load(asset(assets, part.asset));
  const fonts = await fontsFor(doc, assets);
  const font = fonts.latin;
  const form = doc.getForm();

  for (const [name, value] of Object.entries(part.fields ?? {})) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new RenderError(`${part.asset}: no field "${name}"`);
    if (field instanceof PDFTextField) {
      const picked = await pick(fonts, typeof value === "string" ? value : value ? "Yes" : "", warnings, `${part.asset} "${name}"`);
      const max = field.getMaxLength();
      const text = max !== undefined && picked.text.length > max ? picked.text.slice(0, max) : picked.text;
      field.setText(text);
      shrinkToFit(field, picked.font, text);
      // Drawn now in the font it needs; the rest are drawn in Helvetica below.
      if (picked.font !== font) field.updateAppearances(picked.font);
    } else if (field instanceof PDFCheckBox) {
      if (value === true) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (typeof value !== "string") throw new RenderError(`${part.asset}: radio "${name}" needs an option`);
      if (value) {
        if (!field.getOptions().includes(value)) throw new RenderError(`${part.asset}: radio "${name}" has no option "${value}"`);
        field.select(value);
      }
    } else {
      throw new RenderError(`${part.asset}: field "${name}" cannot take a value`);
    }
  }

  // Images over fields (signatures, the photo box): drawn on the page, then
  // the field itself goes, since flattening cannot draw these field types.
  for (const [name, assetName] of Object.entries(part.fieldImages ?? {})) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new RenderError(`${part.asset}: no field "${name}"`);
    const widget = field.acroField.getWidgets()[0];
    const pageIndex = doc.getPages().findIndex((p) => p.ref === widget?.P());
    if (!widget || pageIndex < 0) throw new RenderError(`${part.asset}: field "${name}" is not on a page`);
    const bytes = asset(assets, assetName);
    const embedded = await embedImage(doc, bytes, assetName);
    drawFitted(doc.getPages()[pageIndex], embedded, widget.getRectangle());
    removeField(doc, form, field);
  }

  for (const item of part.text ?? []) {
    const page = pageOf(doc, item.page, part.asset);
    const picked = await pick(fonts, item.text, warnings, `${part.asset} text on page ${item.page}`);
    const text = picked.text.replace(/\n+/g, " ");
    let size = item.size ?? 9;
    if (item.maxWidth) while (size > 5 && picked.font.widthOfTextAtSize(text, size) > item.maxWidth) size -= 0.5;
    page.drawText(text, { x: item.x, y: item.y, size, font: picked.font });
  }

  for (const item of part.images ?? []) {
    const page = pageOf(doc, item.page, part.asset);
    const embedded = await embedImage(doc, asset(assets, item.asset), item.asset);
    drawFitted(page, embedded, item);
  }

  // Signature and button fields left unfilled cannot be flattened either.
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField || field instanceof PDFCheckBox || field instanceof PDFRadioGroup)) removeField(doc, form, field);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  return doc;
}

/** One A4 page with an image (an ID card, a certificate) fitted under its caption. */
async function imagePage(out: PDFDocument, assets: Record<string, Uint8Array>, name: string, caption: string | undefined, warnings: string[]) {
  const bytes = asset(assets, name);
  const page = out.addPage([A4.width, A4.height]);
  const embedded = await embedImage(out, bytes, name);
  let top = A4.height - MARGIN;
  if (caption) {
    const { font, text } = await pick(await fontsFor(out, assets, true), caption, warnings, `caption of ${name}`);
    page.drawText(text.replace(/\n+/g, " "), { x: MARGIN, y: top - 12, size: 12, font });
    top -= 28;
  }
  drawFitted(page, embedded, { x: MARGIN, y: MARGIN, width: A4.width - 2 * MARGIN, height: top - MARGIN });
}

/** Renders every part in order into one PDF. */
export async function renderDocument(spec: RenderSpec, assets: Record<string, Uint8Array>): Promise<Rendered> {
  if (!spec || !Array.isArray(spec.parts) || spec.parts.length === 0) throw new RenderError("Nothing to render");
  const warnings: string[] = [];
  const out = await PDFDocument.create();
  out.setTitle(typeof spec.title === "string" ? spec.title.slice(0, 200) : "Document");
  out.setProducer("Eddy");
  out.setCreator("Eddy");

  for (const part of spec.parts) {
    if (part.kind === "template") {
      const filled = await renderTemplate(part, assets, warnings);
      // Fonts and images are written into a document only when it is saved;
      // its pages are copied out instead, so write them now.
      await filled.flush();
      const all = filled.getPageIndices();
      const keep = part.pages ? part.pages.map((n) => {
        if (!all.includes(n - 1)) throw new RenderError(`${part.asset}: no page ${n}`);
        return n - 1;
      }) : all;
      for (const page of await out.copyPages(filled, keep)) out.addPage(page);
    } else if (part.kind === "image") {
      await imagePage(out, assets, part.asset, part.caption, warnings);
    } else if (part.kind === "pdf") {
      const bytes = asset(assets, part.asset);
      if (!isPdf(bytes)) throw new RenderError(`Asset "${part.asset}" is not a PDF`);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
    } else {
      throw new RenderError(`Unknown part kind "${(part as { kind: unknown }).kind}"`);
    }
  }

  const pdf = await out.save({ useObjectStreams: true });
  return { pdf, pages: out.getPageCount(), warnings };
}
