import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyProfile } from '@/lib/queries';
import { getQuiz, submitQuiz } from '@/api/quizzes';
import type { QuizResult, QuizToTake } from '@shared/quizzes';

/**
 * One Hockey Rules quiz: every question, then Send; Eddy marks it and shows
 * each answer with its explanation. Taking it again replaces the score.
 */
export default function QuizTakePage() {
  const { key = '' } = useParams();
  const quiz = useQuery({ queryKey: ['quiz', key], queryFn: () => getQuiz(key) });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Hockey Rules quiz" back="/quizzes" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {quiz.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : quiz.error || !quiz.data ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">{errorText(quiz.error)}</p>
            <button onClick={() => void quiz.refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : (
          <Quiz key={quiz.data.key} quiz={quiz.data} />
        )}
      </main>
      <AppFooter />
    </div>
  );
}

function Quiz({ quiz }: { quiz: QuizToTake }) {
  const queryClient = useQueryClient();
  const name = useMyProfile().data?.preferredName ?? 'there';
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => submitQuiz(quiz.key, answers),
    onSuccess: (r) => {
      setResult(r);
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ['quizzes'] });
      window.scrollTo({ top: 0 });
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const left = quiz.questions.filter((q) => !answers[q.id]).length;
  const marked = (id: string) => result?.answers.find((a) => a.id === id);

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-base font-semibold text-foreground">{quiz.title}</h2>
        {result ? (
          <p className="text-sm text-foreground">
            You scored <span className="font-semibold">{result.score}</span> out of {result.points}. Each answer is marked below, with why.
          </p>
        ) : (
          quiz.intro && <p className="text-sm text-muted-foreground whitespace-pre-line">{quiz.intro.replace(/\{name\}/g, name)}</p>
        )}
      </section>

      {quiz.questions.map((q, i) => {
        const m = marked(q.id);
        return (
          <section key={q.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <p className="text-sm font-medium text-foreground whitespace-pre-line">{q.text || `Question ${i + 1}`}</p>
            <div className="space-y-1">
              {q.options.map((o) => {
                const chosen = answers[q.id] === o.id;
                const isRight = m?.correct.includes(o.id);
                const tone = !m ? '' : isRight ? 'border-primary bg-primary/5' : chosen ? 'border-destructive bg-destructive/5' : '';
                return (
                  <label key={o.id} className={`flex gap-2 items-start text-sm text-foreground rounded-md border border-transparent px-2 py-1.5 ${tone}`}>
                    <input
                      type="radio"
                      name={q.id}
                      className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={chosen}
                      disabled={!!result}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                    />
                    <span className="flex-1">{o.label}</span>
                    {m && isRight && <Check className="h-4 w-4 text-primary shrink-0" aria-label="Right answer" />}
                    {m && chosen && !isRight && <X className="h-4 w-4 text-destructive shrink-0" aria-label="Your answer" />}
                  </label>
                );
              })}
            </div>
            {m && !m.right && m.explanation && <p className="text-xs text-muted-foreground whitespace-pre-line">{m.explanation}</p>}
          </section>
        );
      })}

      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2 pb-4">
        {result ? (
          <button
            className={secondary}
            onClick={() => {
              setResult(null);
              setAnswers({});
              window.scrollTo({ top: 0 });
            }}
          >
            Take it again
          </button>
        ) : (
          <button className={primary} disabled={send.isPending || left > 0} onClick={() => send.mutate()}>
            {send.isPending ? 'Marking…' : left > 0 ? `${left} to answer` : 'Send my answers'}
          </button>
        )}
      </div>
    </>
  );
}
