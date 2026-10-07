/**
 * WhatsApp "click to chat" links. A link opens WhatsApp on the person's own
 * device with the message typed in; they press send. The message is
 * percent-encoded, so newlines and emoji survive.
 *
 * The links go to api.whatsapp.com/send, not the wa.me short link: wa.me's
 * redirect turns every emoji into U+FFFD ("%E2%9C%85" comes back as
 * "%EF%BF%BD", checked 8 Oct 2026), so "✅George" arrived garbled.
 * api.whatsapp.com is where wa.me redirects anyway, and keeps them.
 */
const SEND = "https://api.whatsapp.com/send";

/** A link to one recipient. `number` must already be digits-only international ("85291234567"). */
export function whatsAppLink(number: string, message: string): string {
  return `${SEND}?${number ? `phone=${number}&` : ""}text=${encodeURIComponent(message)}`;
}

/** A link with no recipient: WhatsApp asks who (or which group) to send it to. */
export function whatsAppShareLink(message: string): string {
  return whatsAppLink("", message);
}
