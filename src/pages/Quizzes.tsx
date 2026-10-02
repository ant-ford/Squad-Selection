import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, ChevronRight, User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { errorText } from '@/components/profile/steps';
import { Skeleton } from '@/components/ui/skeleton';
import { safeFormat } from '@/lib/dateUtils';
import { getQuizScores, listQuizzes } from '@/api/quizzes';

/**
 * The Hockey Rules quizzes: each with your latest score, and for the
 * Section Captains everyone's scores.
 */
export default function QuizzesPage() {
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['quizzes'], queryFn: listQuizzes });
  const board = useQuery({ queryKey: ['quizScores'], queryFn: getQuizScores, enabled: !!list.data?.canSeeScores });

  const body = () => {
    if (list.isLoading) return <Skeleton className="h-64 w-full" />;
    if (list.error || !list.data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{errorText(list.error)}</p>
          <button onClick={() => void list.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    return (
      <>
        <section className="rounded-xl border border-border bg-card divide-y divide-border">
          {list.data.quizzes.map((q) => (
            <button
              key={q.key}
              onClick={() => navigate(`/quizzes/${encodeURIComponent(q.key)}`)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50"
            >
              <BookOpenCheck className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{q.key}</p>
                <p className="text-xs text-muted-foreground">
                  {q.questions} questions
                  {q.myScore !== null
                    ? ` · your score ${q.myScore}/${q.points}${q.takenAt ? ` (${safeFormat(q.takenAt, 'd MMM yyyy')})` : ''}`
                    : ' · not taken yet'}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </section>
        {list.data.canSeeScores && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-base font-semibold text-foreground">Everyone's scores</h2>
            {board.isLoading && <Skeleton className="h-32 w-full" />}
            {board.data && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Name</th>
                      {board.data.quizzes.map((q) => (
                        <th key={q.key} className="py-1 pr-3 font-medium whitespace-nowrap">
                          {q.key.replace('Hockey Rules ', '')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {board.data.people.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="py-1 pr-3 text-foreground">{p.name}</td>
                        {board.data!.quizzes.map((q) => (
                          <td key={q.key} className="py-1 pr-3 text-foreground tabular-nums">
                            {p.scores[q.key] ?? '–'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Hockey Rules quizzes">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
