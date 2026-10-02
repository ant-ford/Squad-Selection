import { apiGet, apiPost } from '@/lib/apiClient';
import type { QuizResult, QuizScoreBoard, QuizSummary, QuizToTake } from '@shared/quizzes';

/** The Hockey Rules quizzes (worker/src/quizzes.ts). Quiz keys have spaces, so they're encoded. */

export function listQuizzes(): Promise<{ quizzes: QuizSummary[]; canSeeScores: boolean }> {
  return apiGet('/api/quizzes');
}

export function getQuiz(key: string): Promise<QuizToTake> {
  return apiGet(`/api/quizzes/${encodeURIComponent(key)}`);
}

export function submitQuiz(key: string, answers: Record<string, string>): Promise<QuizResult> {
  return apiPost(`/api/quizzes/${encodeURIComponent(key)}`, { answers });
}

export function getQuizScores(): Promise<QuizScoreBoard> {
  return apiGet('/api/quizzes/scores');
}
