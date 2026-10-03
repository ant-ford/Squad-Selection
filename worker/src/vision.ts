/**
 * Asks the model to read a picture and answer in JSON (owner decisions,
 * 2026-10-01 and 2026-10-03): through OpenRouter, routed only to providers
 * that neither keep nor train on what they're sent. Used for HKID and
 * passport photos (idRead.ts) and payment screenshots (paymentRead.ts).
 */
import type { Env } from "./env";
import { DEFAULT_DRAFT_MODEL } from "./reviewDrafts";

/** A picture as a data URL, at most ~5 MB. */
export const MAX_IMAGE_CHARS = 7_000_000;
export const isPhotoDataUrl = (v: unknown): v is string =>
  typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= MAX_IMAGE_CHARS;

/** The model's reply text, or null when the request failed (logged, never thrown). */
export async function askAboutPicture(env: Env, opts: { system: string; prompt: string; image: string; maxTokens: number; label: string }): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": (env.APP_ORIGIN ?? "https://app.eddy.global").replace(/\/+$/, ""),
        "X-Title": "Eddy",
      },
      body: JSON.stringify({
        model: env.AI_DRAFT_MODEL || DEFAULT_DRAFT_MODEL,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: [{ type: "text", text: opts.prompt }, { type: "image_url", image_url: { url: opts.image } }] },
        ],
        temperature: 0,
        max_tokens: opts.maxTokens,
        reasoning: { enabled: false },
        // Only providers that neither keep nor train on what they're sent.
        provider: { data_collection: "deny" },
      }),
    });
    const out = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
    const reply = out?.choices?.[0]?.message?.content;
    if (!res.ok || !reply) {
      console.error(`${opts.label} failed: ${res.status} ${out?.error?.message?.slice(0, 160) ?? ""}`);
      return null;
    }
    return reply;
  } catch (err) {
    console.error(`${opts.label} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The first JSON object in the model's reply. */
export function parseReply(reply: string): unknown {
  const m = /\{[\s\S]*\}/.exec(reply);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
