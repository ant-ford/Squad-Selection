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
 * Text is drawn in Helvetica, whose WinAnsi encoding has no Chinese
 * characters; anything it cannot draw is left out and reported in
 * `warnings`, never a failure.
 */
import { PDFCheckBox, PDFDocument, PDFRadioGroup, PDFTextField, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

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

/** Keeps the characters the font can draw; reports how many were dropped. */
export function drawable(font: PDFFont, text: string, warnings: string[], where: string): string {
  // Typographic punctuation people type or paste, as plain equivalents.
  const plain = text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n");
  let out = "";
  let dropped = 0;
  for (const ch of plain) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      dropped++;
    }
  }
  if (dropped) warnings.push(`${where}: ${dropped} character(s) the font cannot draw were left out`);
  return out;
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

async function renderTemplate(
  part: Extract<DocumentPart, { kind: "template" }>,
  assets: Record<string, Uint8Array>,
  warnings: string[],
): Promise<PDFDocument> {
  const doc = await PDFDocument.load(asset(assets, part.asset));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(part.fields ?? {})) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new RenderError(`${part.asset}: no field "${name}"`);
    if (field instanceof PDFTextField) {
      const text = drawable(font, typeof value === "string" ? value : value ? "Yes" : "", warnings, `${part.asset} "${name}"`);
      const max = field.getMaxLength();
      field.setText(max !== undefined && text.length > max ? text.slice(0, max) : text);
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
    form.removeField(field);
  }

  for (const item of part.text ?? []) {
    const page = pageOf(doc, item.page, part.asset);
    const text = drawable(font, item.text, warnings, `${part.asset} text on page ${item.page}`).replace(/\n+/g, " ");
    let size = item.size ?? 9;
    if (item.maxWidth) while (size > 5 && font.widthOfTextAtSize(text, size) > item.maxWidth) size -= 0.5;
    page.drawText(text, { x: item.x, y: item.y, size, font });
  }

  for (const item of part.images ?? []) {
    const page = pageOf(doc, item.page, part.asset);
    const embedded = await embedImage(doc, asset(assets, item.asset), item.asset);
    drawFitted(page, embedded, item);
  }

  // Signature and button fields left unfilled cannot be flattened either.
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField || field instanceof PDFCheckBox || field instanceof PDFRadioGroup)) form.removeField(field);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  return doc;
}

/** One A4 page with an image (an ID card, a certificate) fitted under its caption. */
async function imagePage(out: PDFDocument, bytes: Uint8Array, name: string, caption: string | undefined, warnings: string[]) {
  const page = out.addPage([A4.width, A4.height]);
  const embedded = await embedImage(out, bytes, name);
  let top = A4.height - MARGIN;
  if (caption) {
    const font = await out.embedFont(StandardFonts.HelveticaBold);
    const text = drawable(font, caption, warnings, `caption of ${name}`);
    page.drawText(text, { x: MARGIN, y: top - 12, size: 12, font });
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
      const all = filled.getPageIndices();
      const keep = part.pages ? part.pages.map((n) => {
        if (!all.includes(n - 1)) throw new RenderError(`${part.asset}: no page ${n}`);
        return n - 1;
      }) : all;
      for (const page of await out.copyPages(filled, keep)) out.addPage(page);
    } else if (part.kind === "image") {
      await imagePage(out, asset(assets, part.asset), part.asset, part.caption, warnings);
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
