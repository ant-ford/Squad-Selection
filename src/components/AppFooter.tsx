import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Only iOS is detected, and only because it is the one platform where the
 * install option lives somewhere genuinely different - the Share menu rather
 * than the browser's own menu. Everywhere else the instructions are the same,
 * so there is nothing to branch on and no browser to name.
 */
function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/**
 * Discreet "Install app" entry point in the app footer.
 *
 * - Hidden entirely while the app runs as an installed PWA (standalone).
 * - Uses the native browser install prompt (beforeinstallprompt) when the
 *   browser offers one; otherwise shows a short, browser-neutral how-to.
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

  const iOS = isAppleTouchDevice();

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
              Install app
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
        <SheetContent side="bottom" className="max-w-md mx-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader onClose={() => setShowHelp(false)}>
            <SheetTitle>Install this app</SheetTitle>
          </SheetHeader>
          <p className="text-sm text-muted-foreground">
            Installing puts the app on your device, so it opens like any other app and
            keeps you signed in.
          </p>

          {/* Two paths only. iPhone and iPad genuinely differ - the option
              lives in the Share menu rather than the browser's own menu -
              and every other platform reaches it the same way. Naming
              specific browsers dated badly and excluded the ones people
              actually use, so the wording describes the menu, not the
              product, and says plainly that the label varies. */}
          <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground list-decimal list-outside pl-5">
            {iOS ? (
              <>
                <li>
                  Tap the <span className="font-medium text-foreground">Share</span> button
                  in your browser's toolbar.
                </li>
                <li>
                  Scroll down and choose{' '}
                  <span className="font-medium text-foreground">Add to Home Screen</span>.
                </li>
                <li>
                  Confirm with <span className="font-medium text-foreground">Add</span>.
                </li>
              </>
            ) : (
              <>
                <li>Open your browser's menu, or look for an install icon in the address bar.</li>
                <li>
                  Choose <span className="font-medium text-foreground">Install</span> or{' '}
                  <span className="font-medium text-foreground">Add to Home screen</span>.
                  The exact wording varies between browsers.
                </li>
                <li>Confirm when prompted.</li>
              </>
            )}
          </ol>

          <p className="mt-3 text-xs text-muted-foreground">
            Not every browser can install apps. If you cannot find the option, the app
            works normally in the browser and you can bookmark this page instead.
          </p>
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
