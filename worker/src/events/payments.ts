import type { Env } from "../env";
import type { AuthorizedUser } from "../auth";
import { HttpError } from "../http";
import { db, eq } from "../data/supabase";
import { eventRights } from "../eventAccess";
import { uploadBytes } from "../details";
import { readPaymentProof } from "../paymentRead";
import { computeCharges, judgeProof, type ChargeList, type PaymentInfo } from "../../../shared/events";
import {
  text,
  nameOf,
  type ResponseRow,
  RESPONSE_COLS,
  RESPONSE_KEY,
  toDetails,
  toChargeInput,
  type PaymentRow,
  PAYMENT_COLS,
  toPayment,
  loadEvent,
  requireManages,
} from "./shared";

// ── Paying (step 2) ──────────────────────────────────────────────────────

/**
 * A payer's PayMe / FPS screenshot: stored (replacing any earlier one), read
 * by Qwen, and compared with what they owe. A reference already used on
 * another payment is flagged. The social secretary still confirms it.
 */
export async function uploadPaymentProof(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<PaymentInfo> {
  if (!env.FILES) throw new HttpError("File storage is not configured.", 500, "SERVER_MISCONFIGURED");
  const [rights, ev] = await Promise.all([eventRights(env, user), loadEvent(env, id)]);
  if (ev.payment_mode !== "payme_fps" || ev.status !== "published") throw new HttpError("This event isn't paid by PayMe or FPS.", 409, "NOT_PAYME");
  const me = rights.personUuid;
  const d = db(env);
  const rows = await d.select<ResponseRow>(
    "event_responses",
    `select=${RESPONSE_COLS}&event_id=${eq(ev.id)}&or=(and(person_id.eq.${me},signed_up_by_id.is.null),signed_up_by_id.eq.${me})`,
    RESPONSE_KEY,
  );
  const due = computeCharges(toDetails(ev, null), rows.map(toChargeInput)).find((c) => c.payerId === user.personId)?.total ?? 0;
  if (due <= 0) throw new HttpError("You've nothing to pay for this event.", 409, "NOTHING_DUE");
  const { bytes, type } = uploadBytes("photo", body.dataUrl);
  const read = await readPaymentProof(env, body.dataUrl as string);
  const used = read.reference
    ? await d.select<{ event_id: string; payer_id: string }>("event_payments", `select=event_id,payer_id&reference=${eq(read.reference)}`)
    : [];
  const duplicate = used.some((u) => !(u.event_id === ev.id && u.payer_id === me));
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `events/${ev.id}/payments/${crypto.randomUUID()}.${ext}`;
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256 } });
  const [file] = await d.insert<{ id: string }>("files", [
    { r2_key: key, kind: "payment_proof", event_id: ev.id, person_id: me, filename: `payment.${ext}`, content_type: type, bytes: bytes.length, sha256 },
  ]);
  const old = await d.one<{ file_id: string | null }>("event_payments", `select=file_id&event_id=${eq(ev.id)}&payer_id=${eq(me)}`);
  await d.upsert(
    "event_payments",
    [
      {
        event_id: ev.id,
        payer_id: me,
        file_id: file.id,
        amount_due: due,
        amount_read: read.amount,
        paid_on: read.paidOn,
        reference: read.reference,
        payee: read.payee,
        read_status: judgeProof(read, due, duplicate),
        // A new screenshot needs checking again.
        confirmed_by: null,
        confirmed_at: null,
      },
    ],
    "event_id,payer_id",
  );
  if (old?.file_id) {
    const f = await d.one<{ r2_key: string }>("files", `select=r2_key&id=${eq(old.file_id)}`);
    await d.remove("files", `id=${eq(old.file_id)}`);
    if (f) await env.FILES.delete(f.r2_key);
  }
  const saved = await d.one<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&event_id=${eq(ev.id)}&payer_id=${eq(me)}`);
  return toPayment(env, saved!);
}

/** Who owes what, with each payer's proof; and, once sent to the treasurer, what changed since. */
export async function getCharges(env: Env, user: AuthorizedUser, id: string): Promise<ChargeList> {
  const { event } = await requireManages(env, user, id);
  const d = db(env);
  const [rows, payments] = await Promise.all([
    d.select<ResponseRow>("event_responses", `select=${RESPONSE_COLS}&event_id=${eq(event.id)}`, RESPONSE_KEY),
    d.select<PaymentRow>("event_payments", `select=${PAYMENT_COLS}&event_id=${eq(event.id)}`),
  ]);
  const charges = computeCharges(toDetails(event, null), rows.map(toChargeInput));
  const payers = await Promise.all(
    charges.map(async (c) => {
      const p = payments.find((x) => x.payer?.api_id === c.payerId);
      return { ...c, payment: p ? await toPayment(env, p) : null };
    }),
  );
  const sent = event.charges_sent_at;
  return {
    payers,
    total: Math.round(charges.reduce((t, c) => t + c.total, 0) * 100) / 100,
    sentAt: sent,
    changedSince: sent ? rows.filter((r) => Date.parse(r.updated_at) > Date.parse(sent)).map((r) => nameOf(r.person)).sort() : [],
  };
}

/** The charge list has gone to the treasurer (membership account events). */
export async function markChargesSent(env: Env, user: AuthorizedUser, id: string): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  if (event.payment_mode !== "account") throw new HttpError("Only membership account events go to the treasurer.", 409, "NOT_ACCOUNT");
  await db(env).update("events", `id=${eq(event.id)}`, { charges_sent_at: new Date().toISOString() });
  return { ok: true };
}

/** The social secretary checked a payer's proof against the real PayMe or bank record (or takes that back). */
export async function confirmPayment(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { rights, event } = await requireManages(env, user, id);
  const d = db(env);
  const payer = await d.one<{ id: string }>("people", `select=id&api_id=${eq(text(body.personId, 40))}`);
  if (!payer) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const confirmed = body.confirmed === true;
  const done = await d.update<{ event_id: string }>("event_payments", `event_id=${eq(event.id)}&payer_id=${eq(payer.id)}`, {
    confirmed_by: confirmed ? rights.personUuid || null : null,
    confirmed_at: confirmed ? new Date().toISOString() : null,
  });
  if (!done.length) throw new HttpError("They haven't uploaded a payment yet.", 404, "NOT_FOUND");
  return { ok: true };
}

/** Lets someone off the charge, guests included (or charges them again). */
export async function waiveCharge(env: Env, user: AuthorizedUser, id: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const { event } = await requireManages(env, user, id);
  const d = db(env);
  const person = await d.one<{ id: string }>("people", `select=id&api_id=${eq(text(body.personId, 40))}`);
  if (!person) throw new HttpError("That person wasn't found.", 404, "NOT_FOUND");
  const done = await d.update<{ event_id: string }>("event_responses", `event_id=${eq(event.id)}&person_id=${eq(person.id)}`, { charge_waived: body.waived === true });
  if (!done.length) throw new HttpError("They haven't answered.", 404, "NOT_FOUND");
  return { ok: true };
}
