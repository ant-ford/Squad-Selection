import { useState } from "react";
import { CalendarDays, Copy, Check, Calendar, Mail, Smartphone } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { apiGet } from "@/lib/apiClient";
import { toast } from "sonner";

export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  const { user } = useAuth();
  const [webcalUrl, setWebcalUrl] = useState<string | null>(null);
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const email = user?.email;

  if (!activeTab || activeTab === "all" || !email) return null;

  const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
  const baseUrl = apiUrl.startsWith('http') ? apiUrl : `http://${apiUrl}`;

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const link = await apiGet<{ team: string; sig: string }>(
        `/api/calendar/team-link`, 
        { email, team: activeTab }
      );
      const rawHttpsUrl = `${baseUrl}/api/calendar/team-feed.ics?team=${link.team}&sig=${link.sig}`;
      const rawWebcalUrl = rawHttpsUrl.replace("https://", "webcal://").replace("http://", "webcal://");
      
      setHttpsUrl(rawHttpsUrl);
      setWebcalUrl(rawWebcalUrl);
    } catch (err) {
      toast.error("Failed to generate subscription");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!webcalUrl) return;
    await navigator.clipboard.writeText(webcalUrl);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const outlookWebUrl = `https://outlook.office.com/calendar/0/addfromweb/?url=${encodeURIComponent(httpsUrl || "")}`;
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpsUrl || "")}`;

  return (
    <div className="flex flex-col items-end gap-2 pb-2">
      {!webcalUrl ? (
        <button 
          onClick={handleSubscribe} 
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <CalendarDays className="h-4 w-4" />
          {loading ? "Generating..." : "Subscribe to Team Calendar"}
        </button>
      ) : (
        <div className="flex flex-col items-end gap-2 w-full max-w-xs">
          {/* One-Click Provider Buttons */}
          <div className="grid grid-cols-3 gap-1.5 w-full">
            <a 
              href={webcalUrl} 
              className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Apple Calendar"
            >
              <Smartphone className="h-3.5 w-3.5" />
              Apple
            </a>
            
            <a 
              href={googleUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Google Calendar"
            >
              <Calendar className="h-3.5 w-3.5" />
              Google
            </a>

            <a 
              href={outlookWebUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Outlook Web"
            >
              <Mail className="h-3.5 w-3.5" />
              Outlook
            </a>
          </div>
          
          {/* Manual Copy Box (For Outlook Desktop / Other) */}
          <div className="flex items-center gap-1.5 w-full">
            <input 
              readOnly 
              value={webcalUrl} 
              className="flex-1 text-[10px] font-mono p-1.5 bg-muted rounded border border-border truncate text-muted-foreground" 
            />
            <button 
              onClick={handleCopy}
              className="shrink-0 h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-muted transition-colors"
              title="Copy link for Outlook Desktop / Other"
            >
              {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}