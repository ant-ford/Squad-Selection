/**
 * AI draft suggestions for the commitment review, replacing the Airtable AI
 * fields. When the member submits, the sponsor's three answers are drafted;
 * when the sponsor submits, the Membership Officer's three. The reviewer sees
 * each draft pre-filled and edits it before signing: what they submit is what
 * the review says.
 *
 * The prompts are the Airtable fields' own. The model sees the review's
 * content only (statements, attendance, practices, roles), never a name or an
 * email, and OpenRouter is asked to route only to providers that do not
 * collect data (owner decision, 2026-09-30: the paid model, no training).
 *
 * Drafting runs after the response (waitUntil), so a submission never waits
 * on it, and a failure only means the next person starts with empty boxes.
 * Without OPENROUTER_API_KEY nothing is drafted.
 */
import type { Env } from "./env";
import { db, eq } from "./data/supabase";
import { inBackground } from "./requestContext";
import { MIN_MATCH_ATTENDANCE } from "../../shared/commitmentReview";

export const DEFAULT_DRAFT_MODEL = "qwen/qwen3.8-27b";

/** What a draft is written from: one review, without who it is about. */
export interface DraftSource {
  matches_played: number | null;
  matches_team_played: number | null;
  matches_not_available: number | null;
  teams_played: string[] | null;
  playing_position: string | null;
  qualified_umpire: string | null;
  games_umpired: string | null;
  practices: string | null;
  social_functions: string[] | null;
  other_contributions: string | null;
  section_service_member: string | null;
  hkfc_service_member: string | null;
  low_participation_reason: string | null;
  section_service_sponsor: string | null;
  hkfc_service_sponsor: string | null;
  recommendation_sponsor: string | null;
}

const SOURCE_COLUMNS: (keyof DraftSource)[] = [
  "matches_played", "matches_team_played", "matches_not_available", "teams_played", "playing_position",
  "qualified_umpire", "games_umpired", "practices", "social_functions", "other_contributions",
  "section_service_member", "hkfc_service_member", "low_participation_reason",
  "section_service_sponsor", "hkfc_service_sponsor", "recommendation_sponsor",
];

const shown = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(", ") : "<none>") : v === null || v === undefined || v === "" ? "<empty>" : String(v));

/** The Airtable "Combined Context", for one review, with no names in it. */
export function draftContext(s: DraftSource, forOfficer: boolean): string {
  const pct = typeof s.matches_played === "number" && typeof s.matches_team_played === "number" && s.matches_team_played > 0
    ? `${Math.round((s.matches_played / s.matches_team_played) * 100)}%`
    : "<unknown>";
  const sections = [
    ["MEMBER INPUTS", [
      ["Potential for Section service and involvement (Member)", s.section_service_member],
      ["Other Contributions", s.other_contributions],
      ["Potential for HKFC service and involvement (Member)", s.hkfc_service_member],
      ["Reason for low participation", s.low_participation_reason],
    ]],
    ["PARTICIPATION DATA", [
      ["Matches played", s.matches_played],
      ["Matches the team played", s.matches_team_played],
      [`Match attendance (the requirement is ${Math.round(MIN_MATCH_ATTENDANCE * 100)}% minimum)`, pct],
      ["Matches marked unavailable", s.matches_not_available],
      ["Practices", s.practices],
      ["Social functions attended", s.social_functions],
    ]],
    ["UMPIRING & ROLES", [
      ["Games umpired", s.games_umpired],
      ["Qualified umpire", s.qualified_umpire],
    ]],
    ["TEAM INFORMATION", [
      ["Teams played", s.teams_played],
      ["Playing position", s.playing_position],
    ]],
    ...(forOfficer
      ? [["SPONSOR INPUTS", [
          ["Recommendation (Sponsor)", s.recommendation_sponsor],
          ["Potential for Section service and involvement (Sponsor)", s.section_service_sponsor],
          ["Potential for HKFC service and involvement (Sponsor)", s.hkfc_service_sponsor],
        ]] as const]
      : []),
  ] as const;
  return sections
    .map(([title, rows]) => `=== ${title} ===\n\n${rows.map(([label, v]) => `${label}:\n${shown(v)}`).join("\n\n")}`)
    .join("\n\n");
}

/** Every draft: plain text, and no gender assumed (the model is never told who the member is). */
const PLAIN = "Produce a concise, professional comment in plain text only. Do not add headings or extra text. Refer to the person as \"the member\" or \"they\"; never assume their gender.";

/**
 * Each draft: the column it fills, the Airtable prompt, and a hard cap set
 * comfortably above the length the prompt asks for, so it trims only a
 * runaway answer.
 */
export const DRAFTS = {
  sponsor: [
    {
      column: "section_service_draft",
      limit: 300,
      prompt: [
        "You are a sponsor reviewing a member's commitment and potential contribution to the Hockey Section.",
        "Write a brief comment (under 30 words) on the member's potential for involvement and service within the Section.",
        "Consider match attendance: higher than 70% should positively influence tone.",
        "If attendance is below 70% and a reason is provided, acknowledge it briefly and neutrally.",
        `Highlight Section-relevant contribution and potential. Calibrate tone based on attendance. ${PLAIN}`,
        "Keep it under 230 characters.",
      ],
    },
    {
      column: "hkfc_service_draft",
      limit: 240,
      prompt: [
        "You are a sponsor reviewing a member's broader potential contribution to HKFC.",
        "Write a brief comment (under 30 words) on the member's potential for involvement and service across the Club.",
        "Consider match attendance: higher than 70% should positively influence tone.",
        "If attendance is below 70% and a reason is provided, acknowledge it briefly and neutrally.",
        `Focus on Club-wide contribution potential. Calibrate tone based on attendance. ${PLAIN}`,
        "Keep it under 180 characters.",
      ],
    },
    {
      column: "recommendation_draft",
      limit: 500,
      prompt: [
        "You are a sponsor providing an objective recommendation on whether the member has met their commitment requirements and whether you support their membership.",
        "Compare the member's record against the Section's commitment requirements: umpiring, match attendance (70% minimum), training attendance, social functions, contribution to team/Section roles, overall involvement and future value.",
        "If attendance is below 70% and a reason is provided, acknowledge it neutrally.",
        "State clearly whether the member meets requirements. If shortfalls exist, note them objectively and indicate whether mitigation exists.",
        `${PLAIN} Keep it under 400 characters.`,
      ],
    },
  ],
  officer: [
    {
      column: "is_player_needed_draft",
      limit: 150,
      // Airtable's own limit; the model is asked again if it runs over.
      words: 12,
      prompt: [
        "You are the Membership Officer assessing whether the Section needs this candidate at the level indicated.",
        "Produce a single, concise sentence (12 words or fewer).",
        "Focus strictly on why the Section needs the candidate (playing strength, positional need, coaching depth, reliability, contribution).",
        "Keep tone factual and neutral. Do not add headings or extra text. Never assume the member's gender.",
        "Output: (One sentence, 12 words or fewer)",
      ],
    },
    {
      column: "other_comments_draft",
      limit: 300,
      prompt: [
        "You are the Membership Officer reviewing whether the candidate has fulfilled their Commitment Requirements and whether they demonstrate future value to the Section and HKFC.",
        "Assess the candidate against: umpiring, match attendance (70% minimum), training attendance, social functions, team/Section roles, overall contribution, future value.",
        "If shortfalls exist, note them objectively and indicate whether mitigation or exceptional contribution justifies leniency.",
        `State clearly whether expectations were met overall. ${PLAIN} Keep it under 230 characters.`,
      ],
    },
    {
      column: "other_information_draft",
      limit: 300,
      prompt: [
        "You are the Membership Officer reviewing the candidate's application.",
        "Provide any additional relevant insight that may assist the Membership Sub-Committee.",
        "Include only information that is relevant, factual, and helpful. Do not repeat information already covered in other fields.",
        "If there is no meaningful additional insight, output nothing at all.",
        `${PLAIN} Keep it under 230 characters.`,
      ],
    },
  ],
} as const;

export type DraftStep = keyof typeof DRAFTS;

/** The model's answer as a draft: no reasoning block, no quotes, within the limit at a sentence or word boundary. */
export function cleanDraft(text: string, limit: number): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim().replace(/^["'“]+|["'”]+$/g, "").trim();
  if (/^(nothing|none|n\/a|<empty>)\.?$/i.test(t)) return "";
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > limit * 0.6) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return (word > 0 ? cut.slice(0, word) : cut).replace(/[,;:\s]+$/, "") + "…";
}

/** Words in a draft, as a person would count them. */
export const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** One completion from the drafting model (also the applicant form's Polish button, apply.ts). */
export async function complete(env: Env, system: string, context: string, retry?: { previous: string; ask: string }): Promise<string> {
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
        { role: "system", content: system },
        { role: "user", content: `Context:\n${context}\n\nOutput:` },
        ...(retry ? [{ role: "assistant", content: retry.previous }, { role: "user", content: retry.ask }] : []),
      ],
      temperature: 0.3,
      max_tokens: 800,
      // A short plain answer is wanted, not a reasoning model's thinking: left
      // on, the thinking used up the allowance and the longest draft came
      // back empty (preview, 2026-09-30).
      reasoning: { enabled: false },
      // Only providers that neither keep nor train on the prompt.
      provider: { data_collection: "deny" },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  } | null;
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body?.error?.message?.slice(0, 160) ?? "error"}`);
  const choice = body?.choices?.[0];
  if (!choice?.message?.content?.trim()) throw new Error(`OpenRouter gave no text (finish: ${choice?.finish_reason ?? "?"})`);
  return choice.message.content;
}

/** Drafts one step's answers for a review and stores them. Returns how many were written. */
export async function generateDrafts(env: Env, reviewApiId: string, step: DraftStep): Promise<number> {
  if (!env.OPENROUTER_API_KEY) return 0;
  const d = db(env);
  const source = await d.one<DraftSource>("api_reviews", `select=${SOURCE_COLUMNS.join(",")}&id=${eq(reviewApiId)}`);
  if (!source) return 0;
  const context = draftContext(source, step === "officer");
  const results = await Promise.allSettled(
    DRAFTS[step].map(async (draft) => {
      const system = draft.prompt.join("\n");
      let text = cleanDraft(await complete(env, system, context), draft.limit);
      // A word limit the model overshot: asked once more, and the shorter answer kept.
      const words = "words" in draft ? draft.words : undefined;
      if (words && wordCount(text) > words) {
        const again = cleanDraft(
          await complete(env, system, context, {
            previous: text,
            ask: `That is ${wordCount(text)} words. Rewrite it as one sentence of ${words} words or fewer.`,
          }),
          draft.limit,
        );
        if (again && wordCount(again) < wordCount(text)) text = again;
      }
      return [draft.column, text] as const;
    }),
  );
  const patch: Record<string, string> = {};
  for (const r of results) {
    if (r.status === "rejected") {
      console.error(`Review ${reviewApiId}: a ${step} draft failed: ${r.reason instanceof Error ? r.reason.message : "error"}`);
    } else if (r.value[1]) {
      // "Nothing to add" (other_information) is a legitimate empty answer; it is simply not stored.
      patch[r.value[0]] = r.value[1];
    }
  }
  if (Object.keys(patch).length === 0) return 0;
  await d.update("commitments", `api_id=${eq(reviewApiId)}`, {
    ...patch,
    drafts_generated_at: new Date().toISOString(),
    drafts_model: env.AI_DRAFT_MODEL || DEFAULT_DRAFT_MODEL,
  });
  return Object.keys(patch).length;
}

/** After a submission: draft the next step's answers once the response has gone. */
export function draftNextStep(env: Env, reviewApiId: string, step: DraftStep): void {
  if (!env.OPENROUTER_API_KEY) return;
  void inBackground(() => generateDrafts(env, reviewApiId, step));
}
