import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiGetBlob } from '@/lib/apiClient';
import { CLUB_DOCS, type ClubDoc } from '@shared/application';

/**
 * A club document kept behind sign-in (CLUB_DOCS), such as the New Members
 * Info Sheet the new joiner invitation links to: fetched with the person's
 * sign-in and shown here, with a download link.
 */
export default function ClubDocPage() {
  const { name = '' } = useParams();
  const doc = CLUB_DOCS[name as ClubDoc];
  const file = useQuery({ queryKey: ['clubDoc', name], queryFn: () => apiGetBlob(`/api/club-docs/${name}`), enabled: !!doc, staleTime: Infinity });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.data) return;
    const u = URL.createObjectURL(file.data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file.data]);

  const body = () => {
    if (!doc) return <p className="text-sm text-muted-foreground">There's no document at this address.</p>;
    if (file.isLoading || (file.data && !url)) return <Skeleton className="h-[70vh] w-full" />;
    if (file.error || !url) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{file.error instanceof ApiError ? file.error.message : 'Could not open the document.'}</p>
          <button onClick={() => void file.refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">{doc.title}</h2>
          <a
            href={url}
            download={`${doc.title}.pdf`}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" /> Download
          </a>
        </div>
        <object data={url} type="application/pdf" className="w-full h-[75vh] rounded-md border border-border">
          <p className="text-sm text-muted-foreground p-4">This browser can't show the PDF here: use Download.</p>
        </object>
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title={doc?.title ?? 'Club document'} back="/" />
      <main className="flex-1 container mx-auto max-w-4xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
