import { useState } from "react";
import { CalendarDays, Copy, Check, Calendar, Mail, Smartphone, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { apiGet } from "@/lib/apiClient";
import { toast } from "sonner";

export function CoachCalendarExport({ activeTab }: { activeTab: string }) {
  const { user } = useAuth();
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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
      setHttpsUrl(rawHttpsUrl);
    } catch (err) {
      toast.error("Failed to generate subscription");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!httpsUrl) return;
    await navigator.clipboard.writeText(httpsUrl);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Generate webcal ONLY for the Apple button
  const webcalUrl = httpsUrl?.replace("https://", "webcal://").replace("http://", "webcal://");
  const outlookWebUrl = `https://outlook.office.com/calendar/0/addfromweb/?url=${encodeURIComponent(httpsUrl || "")}`;
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpsUrl || "")}`;

  return (
    <div className="flex flex-col items-end gap-2 pb-2">
      {!httpsUrl ? (
        <button 
          onClick={handleSubscribe} 
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          <CalendarDays className="h-4 w-4" />
          {loading ? "Generating..." : "Subscribe to Team Calendar"}
        </button>
      ) : (
        <div className="flex flex-col items-end gap-3 w-full max-w-sm bg-card border border-border rounded-lg p-3 shadow-sm">
          
          {/* Primary: One-Click Provider Buttons */}
          <div className="grid grid-cols-3 gap-2 w-full">
            <a 
              href={webcalUrl} 
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Opens Apple Calendar directly"
            >
              <Smartphone className="h-4 w-4" />
              Apple
            </a>
            
            <a 
              href={googleUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Opens Google Calendar web"
            >
              <Calendar className="h-4 w-4" />
              Google
            </a>

            <a 
              href={outlookWebUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Opens Outlook Web"
            >
              <Mail className="h-4 w-4" />
              Outlook
            </a>
          </div>

          {/* Secondary: Advanced / Manual Fallback */}
          <div className="w-full border-t border-border pt-2">
            <button 
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Using Outlook Desktop or another app?</span>
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {showAdvanced && (
              <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Copy the link below, open your calendar app, and look for <strong>"Subscribe from URL"</strong> or <strong>"Add Internet Calendar"</strong>.
                </p>
                <div className="flex items-center gap-1.5 w-full">
                  <input 
                    readOnly 
                    value={httpsUrl} 
                    className="flex-1 text-[10px] font-mono p-1.5 bg-muted rounded border border-border truncate text-muted-foreground" 
                  />
                  <button 
                    onClick={handleCopy}
                    className="shrink-0 h-7 w-7 flex items-center justify-center rounded border border-border hover:bg-muted transition-colors"
                    title="Copy link"
                  >
                    {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}