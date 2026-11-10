// Sends a welcome post and one review from the feed, to check Telegram alerts work: npm run test-telegram
import { readFileSync } from "node:fs";
import { announce } from "./telegram.ts";

process.loadEnvFile();
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.");

const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text:
      "👋 Bad Bites is live. New bad Google reviews of restaurants that opened in Abu Dhabi " +
      "since July 2025 will be posted here as they come in. Here's a recent one:",
  }),
});
const body = await res.json();
if (!body.ok) throw new Error(`Telegram refused the message: ${body.description}`);

const items = JSON.parse(readFileSync("docs/feed.json", "utf8")).items;
if (items[0]) {
  await announce(items[0]);
  console.log(`Sent the welcome post and "${items[0].headline}" (${items[0].restaurant}).`);
} else {
  console.log("Sent the welcome post; the feed has no reviews yet.");
}
