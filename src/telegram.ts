import type { FeedItem } from "./scan.ts";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Post one feed item to the Telegram channel. Does nothing if Telegram isn't configured. */
export async function announce(item: FeedItem): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const quote = item.text.length > 500 ? item.text.slice(0, 500) + "…" : item.text;
  const message = [
    `${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}  <b>${escape(item.restaurant)}</b> · ${escape(item.area)}, ${escape(item.city)}`,
    `<b>${escape(item.headline)}</b>`,
    `“${escape(quote)}”`,
    `— ${escape(item.author)} · <a href="${escape(item.link)}">See on Google</a>`,
  ].join("\n\n");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
