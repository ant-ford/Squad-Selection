import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { disablePush, enablePush, pushIsOn, pushSupport } from '@/lib/push';

/** Profile menu → Notifications: Eddy's personal alerts on this device, on or off. */
export default function NotificationsSheet({ publicKey, onClose }: { publicKey: string; onClose: () => void }) {
  const support = pushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(() => support === 'supported' && Notification.permission === 'denied');

  useEffect(() => {
    if (support !== 'supported') return;
    let live = true;
    void pushIsOn().then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, [support]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else if ((await enablePush(publicKey)) === 'on') {
        setOn(true);
      } else {
        setBlocked(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change notifications.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0">
        <SheetHeader onClose={onClose}>
          <SheetTitle>Notifications</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {support === 'supported' ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-foreground">On this device</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!on}
                  aria-label="Notifications on this device"
                  disabled={busy || on === null || (blocked && !on)}
                  onClick={() => void toggle()}
                  className={`relative shrink-0 h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                >
                  <span
                    className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
                  />
                </button>
              </div>
              {blocked && !on && <p className="text-xs text-muted-foreground mt-2">Blocked in this browser's settings.</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {support === 'needs-install' ? 'On iPhone, add Eddy to your Home Screen first.' : "This browser can't show notifications."}
            </p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
