import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function detectPlatform() {
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return { iOS, android: /Android/.test(ua) };
}

/**
 * Discreet "Add to Home Screen" entry point in the app footer.
 *
 * - Hidden entirely while the app runs as an installed PWA (standalone).
 * - Uses the native browser install prompt (beforeinstallprompt) when the
 *   browser offers one; otherwise shows a small platform-aware how-to sheet.
 * - Pure frontend: no backend calls, no storage.
 */
export default function AppFooter() {
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const check = () =>
      setIsStandalone(mq.matches || (navigator as any).standalone === true);
    check();
    mq.addEventListener('change', check);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the browser's auto-infobar; we surface our own link
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      check();
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      mq.removeEventListener('change', check);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstallTap = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return;
    }
    setShowHelp(true);
  };

  const { iOS, android } = detectPlatform();

  return (
    <footer className="border-t border-border bg-background py-1 mt-auto">
      <div className="container mx-auto px-1 flex flex-col md:flex-row justify-between items-center gap-2">
        <p className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span>Powered by Eddy • HKFC Men's Hockey Squad Management</span>
          {!isStandalone && (
            <button
              onClick={handleInstallTap}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              title="Install this app on your device"
            >
              <Smartphone className="h-3 w-3" />
              Add to Home Screen
            </button>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          Questions? Contact us at{' '}
          <a
            href="mailto:info@eddy.global"
            className="text-primary hover:underline"
          >
            info@eddy.global
          </a>
        </p>
      </div>

      <Sheet open={showHelp} onOpenChange={setShowHelp}>
        <SheetContent side="bottom" className="max-w-md mx-auto p-4 pb-6">
          <SheetHeader onClose={() => setShowHelp(false)}>
            <SheetTitle>Add to Home Screen</SheetTitle>
          </SheetHeader>
          {iOS ? (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Open this page in <span className="font-medium text-foreground">Safari</span></li>
              <li>Tap the <span className="font-medium text-foreground">Share</span> button (bottom toolbar)</li>
              <li>Tap <span className="font-medium text-foreground">Add to Home Screen</span>, then <span className="font-medium text-foreground">Add</span></li>
            </ol>
          ) : android ? (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>Open this page in <span className="font-medium text-foreground">Chrome</span></li>
              <li>Tap the <span className="font-medium text-foreground">⋮</span> menu (top right)</li>
              <li>Tap <span className="font-medium text-foreground">Add to Home screen</span> or <span className="font-medium text-foreground">Install app</span></li>
            </ol>
          ) : (
            <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
              <li>In <span className="font-medium text-foreground">Chrome</span>: click the install icon in the address bar, or <span className="font-medium text-foreground">⋮</span> → <span className="font-medium text-foreground">Install page as app</span></li>
              <li>In <span className="font-medium text-foreground">Edge</span>: <span className="font-medium text-foreground">⋮</span> → <span className="font-medium text-foreground">Apps</span> → <span className="font-medium text-foreground">Install this site as an app</span></li>
            </ol>
          )}
          <button
            onClick={() => setShowHelp(false)}
            className="mt-4 w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Got it
          </button>
        </SheetContent>
      </Sheet>
    </footer>
  );
}
