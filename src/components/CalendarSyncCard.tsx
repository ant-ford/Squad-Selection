import { useState } from "react";
import { apiGet } from "@/lib/apiClient";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";
import { Copy, Check, CalendarDays, Calendar, Mail, Smartphone } from "lucide-react";

export function CalendarSyncCard() {
  const { user } = useAuth();
  const [webcalUrl, setWebcalUrl] = useState<string | null>(null);
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchCalendarLink = async () => {
    if (!user?.email) return;
    setLoading(true);
    try {
      const link = await apiGet<{ id: string; sig: string }>(
        `/api/calendar/link`, { email: user.email }
      );
      
      const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const baseUrl = apiUrl.startsWith('http') ? apiUrl : `http://${apiUrl}`;
      
      const rawHttpsUrl = `${baseUrl}/api/calendar/feed.ics?id=${link.id}&sig=${link.sig}`;
      const rawWebcalUrl = rawHttpsUrl.replace("https://", "webcal://").replace("http://", "webcal://");
      
      setHttpsUrl(rawHttpsUrl);
      setWebcalUrl(rawWebcalUrl);
      
    } catch (err) {
      toast.error("Failed to generate calendar link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy");
    }
  };

  const outlookWebUrl = `https://outlook.office.com/calendar/0/addfromweb/?url=${encodeURIComponent(httpsUrl || "")}`;
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpsUrl || "")}`;

  return (
    <div className="bg-card border border-border rounded-xl p-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <CalendarDays className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Sync to Calendar</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Get automatic updates for your fixtures, selection, and availability status.
      </p>
      
      {!webcalUrl ? (
        // Native button to avoid custom Button component padding quirks
        <button 
          onClick={fetchCalendarLink} 
          disabled={loading}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Generating..." : "Generate Calendar Link"}
        </button>
      ) : (
        <div className="mt-2 space-y-4">
          
          {/* One-Click Provider Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <a 
              href={webcalUrl} 
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              <Smartphone className="h-4 w-4" />
              Apple / iCal
            </a>
            
            <a 
              href={googleUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              <Calendar className="h-4 w-4" />
              Google Calendar
            </a>

            <a 
              href={outlookWebUrl} 
              target="_blank" 
              rel="noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors"
            >
              <Mail className="h-4 w-4" />
              Outlook Web
            </a>
          </div>

          {/* Manual Copy/Paste Box (For Outlook Desktop / Other) */}
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Manual Link (For Outlook Desktop / Other Apps)
            </label>
            <div className="flex items-center gap-2 mt-1">
              <input 
                readOnly 
                value={webcalUrl} 
                className="flex-1 text-xs font-mono p-2 bg-muted rounded border border-border truncate" 
              />
              
              {/* FIX: Native button with flexbox to guarantee perfect centering */}
              <button 
                onClick={() => handleCopy(webcalUrl || "")}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded border border-border hover:bg-muted transition-colors"
                title="Copy to clipboard"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
              <strong>Outlook Desktop:</strong> Right-click "My Calendars" → Add Calendar → From Internet → Paste link.<br/>
              <strong>Note:</strong> Google Calendar can take up to 24 hours to reflect updates. Apple & Outlook are usually faster.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}