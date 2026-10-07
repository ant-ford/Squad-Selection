/**
 * WhatsApp "click to chat" links. A wa.me link opens WhatsApp on the
 * person's own device with the message typed in; they press send. The
 * message is percent-encoded, so newlines and emoji survive.
 */

/** A link to one recipient. `number` must already be digits-only international ("85291234567"). */
export function whatsAppLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/** A link with no recipient: WhatsApp asks who (or which group) to send it to. */
export function whatsAppShareLink(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
