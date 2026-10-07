/**
 * Web Push on this device: personal alerts from Eddy (worker/src/push.ts).
 * Loaded with the Notifications sheet and on Log out, not with the app.
 *
 * iPhone and iPad show web push only from the Home Screen app (iOS 16.4
 * and later), so in a Safari tab the sheet asks for that first.
 */
import { apiPost } from './apiClient';

export type PushSupport = 'supported' | 'needs-install' | 'unsupported';

function isIos(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Whether this browser can take Eddy's alerts now, after installing, or not at all. */
export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIos() && !isInstalled()) return 'needs-install';
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unsupported';
}

/** The service worker, or null when there is none (dev, or not yet installed). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return x.every((v, i) => v === b[i]);
}

/** Whether this device is getting Eddy's alerts. */
export async function pushIsOn(): Promise<boolean> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return false;
  const reg = await registration();
  return !!(reg && (await reg.pushManager.getSubscription()));
}

/**
 * Turns alerts on. Call straight from the tap: Safari allows the permission
 * question only in direct answer to one. 'denied' when the person (or an
 * earlier answer) said no.
 */
export async function enablePush(publicKey: string): Promise<'on' | 'denied'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  if (!reg) throw new Error('Notifications need the installed app. Reload and try again.');
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Made with another key (the key was replaced): start again.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await apiPost('/api/push/subscribe', sub.toJSON());
  return 'on';
}

/** Turns alerts off on this device, and tells Eddy. */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe();
  await apiPost('/api/push/unsubscribe', { endpoint }).catch(() => undefined);
}

/**
 * Log out: this device stops getting the person's alerts. Best effort and
 * capped at a few seconds, so it never holds up logging out.
 */
export async function forgetThisDevice(): Promise<void> {
  if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return;
  const cap = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  await Promise.race([disablePush().catch(() => undefined), cap]);
}
