import { useState } from "react";
import { apiGet } from "@/lib/apiClient";
import { toast } from "sonner";
import { Copy, Check, Calendar, Mail, Smartphone, ChevronDown, ChevronUp, X } from "lucide-react";

interface CalendarSheetProps {
  /** Fetches the signed link params from the appropriate endpoint. */
  fetchLink: () => Promise<{ url: string }>;
  /** Title shown in the header. */
  title?: string;
  /** Subtitle / description text. */
  description?: string;
  /** Label for the generate button. */
  generateLabel?: string;
  /** If provided, renders as an inline card instead of a bottom sheet. */
  inline?: boolean;
  /** For bottom-sheet mode. */
  onClose?: () => void;
}

/**
 * Unified calendar subscription UI.
 *
 * - Bottom-sheet mode (default): overlay + drawer, used by PlayerDashboard.
 * - Inline mode: renders as a card, used by FixtureList (CoachCalendarExport).
 *
 * Both modes share the same provider buttons, copy-to-clipboard, and
 * advanced fallback — eliminating the drift between the old
 * CalendarSyncSheet and CoachCalendarExport.
 */
export default function CalendarSheet({
  fetchLink,
  title = "Sync to Calendar",
  description = "Get automatic updates for your fixtures, selection, and availability status.",
  generateLabel = "Generate Calendar Link",
  inline = false,
  onClose,
}: CalendarSheetProps) {
  const [httpsUrl, setHttpsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { url } = await fetchLink();
      setHttpsUrl(url);
    } catch {
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

  const linkContent = (
    <>
      {!httpsUrl ? (
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full px-4 py-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Generating..." : generateLabel}
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
                  Copy the link below, open your calendar app, and look for{" "}
                  <strong>"Subscribe from URL"</strong> or <strong>"Add Internet Calendar"</strong>.
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
    </>
  );

  // ── Inline card mode (FixtureList) ──
  if (inline) {
    return (
      <div className="flex flex-col items-end gap-2 pb-2">
        {!httpsUrl ? (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            <Calendar className="h-4 w-4" />
            {loading ? "Generating..." : generateLabel}
          </button>
        ) : (
          <div className="flex flex-col items-end gap-3 w-full max-w-sm bg-card border border-border rounded-lg p-3 shadow-sm">
            {linkContent}
          </div>
        )}
      </div>
    );
  }

  // ── Bottom-sheet mode (PlayerDashboard) ──
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">{description}</p>
          {linkContent}
        </div>
      </div>
    </>
  );
}