/** Free share links that open an app with the message filled in; the person picks the chat and sends it. */

/**
 * A link that opens Telegram's "share to a chat" picker with the message.
 * Telegram's share link needs its `url` parameter, so the message goes there
 * (Telegram shares any text given as the url).
 */
export function telegramShareUrl(text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(text)}`
}

/** WhatsApp's free click-to-chat link: opens WhatsApp with the text, you pick the chat. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Opens the phone's messages app with the text (the `?&` form works on iOS and Android). */
export function smsShareUrl(text: string): string {
  return `sms:?&body=${encodeURIComponent(text)}`
}
