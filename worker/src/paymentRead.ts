/**
 * Reads a PayMe or FPS payment screenshot for an event (owner, 3 Oct 2026:
 * Qwen reads it and keeps track; the social secretary confirms against
 * the real PayMe or bank record, since a screenshot is easy to fake).
 */
import type { Env } from "./env";
import { askAboutPicture, parseReply } from "./vision";

export interface PaymentRead {
  amount: number | null;
  paidOn: string | null;
  reference: string | null;
  payee: string | null;
}

const SYSTEM = [
  "You read payment confirmation screenshots for a Hong Kong sports club.",
  "The picture should be a PayMe or FPS (Faster Payment System) transfer, or a bank app's record of one.",
  "Reply with one JSON object and nothing else, using null for anything you can't read clearly:",
  '{"amount": number, "currency": string, "date": "YYYY-MM-DD", "reference": string, "payee": string, "succeeded": boolean}',
  "amount is the sum sent, as a plain number (350 or 350.5), without the currency.",
  "reference is the transaction, reference or FPS reference number, exactly as shown.",
  "payee is who it was paid to: their name, phone number, FPS ID or PayMe name.",
  "succeeded is false if the screen shows the payment failed, was cancelled or is only pending.",
  "If it isn't a payment confirmation, every value is null. Do not guess.",
].join("\n");

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, max) : null);

/** The model's answer, checked: anything doubtful left out; a failed or non-HKD payment has no amount. */
export function toPaymentRead(raw: unknown): PaymentRead {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = typeof o.amount === "number" ? o.amount : typeof o.amount === "string" ? Number(o.amount.replace(/[^0-9.]/g, "")) : NaN;
  const currency = text(o.currency, 10)?.toUpperCase().replace(/[^A-Z$]/g, "");
  const hkd = !currency || ["HKD", "HK$", "$"].includes(currency);
  const amount = Number.isFinite(n) && n > 0 && n < 100_000 && hkd && o.succeeded !== false ? Math.round(n * 100) / 100 : null;
  const date = text(o.date, 10);
  return {
    amount,
    paidOn: date && /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) ? date : null,
    reference: text(o.reference, 60)?.replace(/\s+/g, "") ?? null,
    payee: text(o.payee, 100),
  };
}

/** Nothing read when the model isn't set up or fails: the social secretary checks it by eye. */
export async function readPaymentProof(env: Env, image: string): Promise<PaymentRead> {
  const reply = await askAboutPicture(env, { system: SYSTEM, prompt: "This is a payment screenshot.", image, maxTokens: 300, label: "Payment read" });
  return reply ? toPaymentRead(parseReply(reply)) : { amount: null, paidOn: null, reference: null, payee: null };
}
