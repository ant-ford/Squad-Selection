import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Cloudflare Turnstile in front of the sign-in email.
 *
 * Supabase sends a sign-in code to any address (registering to join needs
 * that), and those codes share Resend's 100 emails a day with Eddy's own
 * mail, so a scripted flood could stop everyone signing in for a day. With
 * CAPTCHA protection on in Supabase Auth, signInWithOtp needs a Turnstile
 * token, which a script can't get.
 *
 * Off until VITE_TURNSTILE_SITE_KEY is set: then no script loads and
 * sign-in works exactly as before. Supabase must only be switched to
 * require CAPTCHA after a build with the site key is live.
 *
 * "interaction-only": most people never see it; a challenge appears only
 * when Cloudflare is unsure.
 */
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoad: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoad ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')));
    script.onerror = () => {
      scriptLoad = null; // let a later mount try again
      reject(new Error('Turnstile did not load'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

export interface TurnstileHandle {
  /** A token is single-use: get a fresh one after each send. */
  reset(): void;
}

/** Calls onToken with a token, or null when it expires, fails or is spent. */
export const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string | null) => void }>(
  function Turnstile({ onToken }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const widget = useRef<string | null>(null);
    const latest = useRef(onToken);
    latest.current = onToken;

    useImperativeHandle(ref, () => ({
      reset() {
        latest.current(null);
        if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
      },
    }));

    useEffect(() => {
      if (!TURNSTILE_SITE_KEY) return;
      let cancelled = false;
      loadTurnstile()
        .then((api) => {
          if (cancelled || !box.current) return;
          widget.current = api.render(box.current, {
            sitekey: TURNSTILE_SITE_KEY,
            appearance: 'interaction-only',
            callback: (token: string) => latest.current(token),
            'expired-callback': () => latest.current(null),
            'error-callback': () => latest.current(null),
          });
        })
        .catch(() => latest.current(null));
      return () => {
        cancelled = true;
        if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
        widget.current = null;
      };
    }, []);

    if (!TURNSTILE_SITE_KEY) return null;
    return <div ref={box} className="flex justify-center" />;
  },
);
