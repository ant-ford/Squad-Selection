/**
 * The Hockey Rules quizzes (Supabase backend; migration 20261002140000),
 * replacing Fillout forms 14-17. Anyone signed in takes them; Eddy marks
 * the answers, keeps the latest score in quiz_scores (as the Fillout form
 * wrote one score to People) and shows each answer with its explanation.
 * Section Captains see everyone's scores.
 */
import type { Env } from "./env";
import type { AuthorizedUser } from "./auth";
import { HttpError } from "./http";
import { backendFor } from "./data/backend";
import { db, eq } from "./data/supabase";
import type { QuizResult, QuizScoreBoard, QuizSummary, QuizToTake } from "../../shared/quizzes";

function requireSupabase(env: Env): void {
  if (backendFor(env, "people") !== "supabase") {
    throw new HttpError("The quizzes move into Eddy at the switch-over. Until then, use the Fillout link.", 409, "NOT_YET");
  }
}

interface Question {
  id: string;
  text: string;
  options: { id: string; label: string }[];
  correct: string[];
  points: number;
  explanation: string | null;
}
interface QuizRow {
  key: string;
  title: string;
  intro: string | null;
  questions: Question[];
}

const points = (qs: Question[]) => qs.reduce((n, q) => n + (q.points ?? 1), 0);

async function me(env: Env, user: AuthorizedUser): Promise<string> {
  const p = await db(env).one<{ id: string }>("people", `select=id&api_id=${eq(user.personId)}`);
  if (!p) throw new HttpError("Your People record was not found.", 403, "FORBIDDEN");
  return p.id;
}

export async function listQuizzes(env: Env, user: AuthorizedUser): Promise<{ quizzes: QuizSummary[]; canSeeScores: boolean }> {
  requireSupabase(env);
  const d = db(env);
  const [quizzes, personId] = await Promise.all([
    d.select<QuizRow>("quizzes", "select=key,title,questions&active=is.true&order=sort", "key"),
    me(env, user),
  ]);
  const mine = await d.select<{ quiz: string; score: number | null; taken_at: string | null }>("quiz_scores", `select=quiz,score,taken_at&person_id=${eq(personId)}`);
  return {
    quizzes: quizzes.map((q) => {
      const s = mine.find((m) => m.quiz === q.key);
      return {
        key: q.key,
        title: q.title,
        questions: q.questions.length,
        points: points(q.questions),
        myScore: s?.score === null || s?.score === undefined ? null : Number(s.score),
        takenAt: s?.taken_at ?? null,
      };
    }),
    canSeeScores: user.officerRoles.some((r) => r.office === "sectionCaptain"),
  };
}

async function loadQuiz(env: Env, key: string): Promise<QuizRow> {
  const q = await db(env).one<QuizRow>("quizzes", `select=key,title,intro,questions&key=${eq(key)}&active=is.true`);
  if (!q) throw new HttpError("That quiz was not found.", 404, "NOT_FOUND");
  return q;
}

/** The questions, without their answers. */
export async function getQuiz(env: Env, user: AuthorizedUser, key: string): Promise<QuizToTake> {
  requireSupabase(env);
  void user;
  const q = await loadQuiz(env, key);
  return { key: q.key, title: q.title, intro: q.intro, questions: q.questions.map(({ id, text, options }) => ({ id, text, options })) };
}

/** Marks the answers (all questions must be answered), keeps the score and returns the marking. */
export function markQuiz(questions: Question[], given: Record<string, unknown>): QuizResult {
  const answers = questions.map((q) => {
    const chosen = typeof given[q.id] === "string" && q.options.some((o) => o.id === given[q.id]) ? (given[q.id] as string) : null;
    const right = chosen !== null && q.correct.includes(chosen);
    return { id: q.id, chosen, correct: q.correct, right, explanation: q.explanation };
  });
  return {
    score: questions.reduce((n, q, i) => n + (answers[i].right ? q.points ?? 1 : 0), 0),
    points: points(questions),
    answers,
  };
}

export async function submitQuiz(env: Env, user: AuthorizedUser, key: string, body: Record<string, unknown>): Promise<QuizResult> {
  requireSupabase(env);
  const q = await loadQuiz(env, key);
  const given = (body.answers ?? {}) as Record<string, unknown>;
  const result = markQuiz(q.questions, given);
  if (result.answers.some((a) => a.chosen === null)) throw new HttpError("Answer every question first.", 400, "INVALID_INPUT");
  const personId = await me(env, user);
  // The latest attempt counts, as the Fillout form wrote over the score.
  await db(env).upsert("quiz_scores", [{ person_id: personId, quiz: q.key, score: result.score, taken_at: new Date().toISOString() }], "person_id,quiz");
  return result;
}

/** Everyone's scores, for the Section Captains. */
export async function quizScoreBoard(env: Env, user: AuthorizedUser): Promise<QuizScoreBoard> {
  requireSupabase(env);
  if (!user.officerRoles.some((r) => r.office === "sectionCaptain")) throw new HttpError("This is for Section Captains.", 403, "OFFICER_ACCESS_REQUIRED");
  const d = db(env);
  const [quizzes, scores] = await Promise.all([
    d.select<QuizRow>("quizzes", "select=key,title,questions&active=is.true&order=sort", "key"),
    d.select<{ quiz: string; score: number | null; people: { api_id: string; preferred_name: string | null; given_names: string | null; surname: string | null } | null }>(
      "quiz_scores",
      "select=quiz,score,people(api_id,preferred_name,given_names,surname)",
    ),
  ]);
  const byPerson = new Map<string, QuizScoreBoard["people"][number]>();
  for (const s of scores) {
    if (!s.people) continue;
    const row = byPerson.get(s.people.api_id) ?? {
      id: s.people.api_id,
      name: [s.people.preferred_name || s.people.given_names, s.people.surname].filter(Boolean).join(" ") || "?",
      scores: {},
    };
    row.scores[s.quiz] = s.score === null ? null : Number(s.score);
    byPerson.set(s.people.api_id, row);
  }
  return {
    quizzes: quizzes.map((q) => ({ key: q.key, title: q.title, points: points(q.questions) })),
    people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
