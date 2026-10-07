import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, Calendar, Mail, Smartphone, ChevronDown, ChevronUp } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface CalendarSheetProps {
  /** Fetches the signed link params from the appropriate endpoint. */
  fetchLink: () => Promise<{ url: string }>;
  /** Title shown in the header. */
  title?: string;
  /** Subtitle / description text. */
  description?: string;
  /** Label for the generate button. */
  generateLabel?: string;
  /** Called when the sheet is dismissed. */
  onClose?: () => void;
}

/**
 * Unified calendar subscription UI.
 *
 * A bottom sheet (overlay + drawer) used by PlayerDashboard and by the
 * coach's team calendar (CoachCalendarExport), so both share the same
 * provider buttons, copy-to-clipboard and advanced fallback.
 */
export default function CalendarSheet({
  fetchLink,
  title = "Sync to calendar",
  description = "Get automatic updates for your fixtures, selection, and availability status.",
  generateLabel = "Get calendar link",
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
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
              title="Opens Apple Calendar directly"
            >
              <Smartphone className="h-5 w-5" />
              Apple
            </a>
            <a
              href={googleUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
              title="Opens Google Calendar web"
            >
              <Calendar className="h-5 w-5" />
              Google
            </a>
            <a
              href={outlookWebUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors"
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
              className="flex items-center justify-between w-full min-h-10 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>Using Outlook Desktop or another app?</span>
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Copy the link below, open your calendar app, and look for{" "}
                  <strong>"Subscribe from URL"</strong> or <strong>"Add Internet Calendar"</strong>.
                </p>
                <div className="flex items-center gap-1.5 w-full">
                  <input
                    readOnly
                    value={httpsUrl}
                    className="flex-1 text-xs font-mono p-2 bg-muted rounded border border-border truncate text-muted-foreground"
                  />
                  <button
                    onClick={handleCopy}
                    className="shrink-0 h-10 w-10 flex items-center justify-center rounded border border-border hover:bg-muted transition-colors"
                    title="Copy link"
                    aria-label="Copy link"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-success-soft-foreground" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Note:</strong> Updates usually appear within minutes. Google Calendar can take up to 24 hours to reflect changes.
          </p>
        </div>
      )}
    </>
  );

  // A bottom sheet: PlayerDashboard and the coach's team calendar (CoachCalendarExport).
  return (
    <Sheet open onOpenChange={(next) => !next && onClose?.()}>
      <SheetContent side="bottom" className="p-4">
        <SheetHeader onClose={onClose}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <p className="text-xs text-muted-foreground mb-4">{description}</p>
        {linkContent}
      </SheetContent>
    </Sheet>
  );
}