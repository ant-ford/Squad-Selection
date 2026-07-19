import { useState } from "react";
import { apiGet } from "@/lib/apiClient";
import { toast } from "sonner";
import { useAuth } from "@/lib/useAuth";
import { Copy, Check, Calendar, Mail, Smartphone, ChevronDown, ChevronUp, X } from "lucide-react";

export default function CalendarSyncSheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const email = user?.email;

  const fetchCalendarLink = async () => {
    if (!email) return;
    setLoading(true);
    try {
      const link = await apiGet<{ id: string; sig: string }>(
        `/api/calendar/link`, { email }
      );
      const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const baseUrl = apiUrl.startsWith('http') ? apiUrl : `http://${apiUrl}`;
      const rawHttpsUrl = `${baseUrl}/api/calendar/feed.ics?id=${link.id}&sig=${link.sig}`;
      setHttpsUrl(rawHttpsUrl);
    } catch (err) {
      toast.error("Failed to generate calendar link");
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

  const webcalUrl = httpsUrl?.replace("https://", "webcal://").replace("http://", "webcal://");
  const outlookWebUrl = `https://outlook.office.com/calendar/0/addfromweb/?url=${encodeURIComponent(httpsUrl || "")}`;
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpsUrl || "")}`;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Drawer panel */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Sync to Calendar</h2>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>

          <p className="text-xs text-muted-foreground mb-4">
            Get automatic updates for your fixtures, selection, and availability status.
          </p>

          {!httpsUrl ? (
            <button
              onClick={fetchCalendarLink}
              disabled={loading}
              className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? "Generating..." : "Generate Calendar Link"}
            </button>
          ) : (
            <div className="space-y-4">
              {/* One-Click Provider Buttons */}
              <div className="grid grid-cols-3 gap-2 w-full">
                <a
                  href={webcalUrl}
                  className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  title="Opens Apple Calendar directly"
                >
                  <Smartphone className="h-5 w-5" />
                  Apple
                </a>
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  title="Opens Google Calendar web"
                >
                  <Calendar className="h-5 w-5" />
                  Google
                </a>
                <a
                  href={outlookWebUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                  title="Opens Outlook Web"
                >
                  <Mail className="h-5 w-5" />
                  Outlook
                </a>
              </div>

              {/* Advanced / Manual Fallback */}
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>Using Outlook Desktop or another app?</span>
                  {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>

                {showAdvanced && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Copy the link below, open your calendar app, and look for <strong>"Subscribe from URL"</strong> or <strong>"Add Internet Calendar"</strong>.
                    </p>
                    <div className="flex items-center gap-1.5 w-full">
                      <input
                        readOnly
                        value={httpsUrl}
                        className="flex-1 text-[10px] font-mono p-2 bg-muted rounded border border-border truncate text-muted-foreground"
                      />
                      <button
                        onClick={handleCopy}
                        className="shrink-0 h-8 w-8 flex items-center justify-center rounded border border-border hover:bg-muted transition-colors"
                        title="Copy link"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-muted-foreground">
                <strong>Note:</strong> Updates usually appear within minutes. Google Calendar can take up to 24 hours to reflect changes.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}