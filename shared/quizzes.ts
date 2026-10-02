/**
 * The Hockey Rules quizzes (worker/src/quizzes.ts). The answer keys never
 * reach the app before the quiz is sent: it gets the questions, and the
 * marked answers back afterwards.
 */

export interface QuizSummary {
  key: string;
  title: string;
  questions: number;
  points: number;
  /** Their latest score, if they've taken it (from Fillout or Eddy). */
  myScore: number | null;
  takenAt: string | null;
}

/** GET /api/quizzes/:key: what to answer. */
export interface QuizToTake {
  key: string;
  title: string;
  intro: string | null;
  questions: { id: string; text: string; options: { id: string; label: string }[] }[];
}

/** POST /api/quizzes/:key: the marked answers. */
export interface QuizResult {
  score: number;
  points: number;
  answers: { id: string; chosen: string | null; correct: string[]; right: boolean; explanation: string | null }[];
}

/** GET /api/quizzes/scores (Section Captains): everyone's scores. */
export interface QuizScoreBoard {
  quizzes: { key: string; title: string; points: number }[];
  people: { id: string; name: string; scores: Record<string, number | null> }[];
}
