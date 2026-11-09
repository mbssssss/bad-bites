// Asks for each key (input hidden) and writes .env, so nobody has to edit the file by hand.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const KEYS = [
  { name: "OUTSCRAPER_API_KEY", label: "Outscraper API key", required: true },
  { name: "ANTHROPIC_API_KEY", label: "Anthropic API key (optional, for AI headlines)" },
  { name: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token (optional)" },
  { name: "TELEGRAM_CHAT_ID", label: "Telegram channel, e.g. @badbitesuae (optional)", visible: true },
];

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const writeToOutput = (rl as any)._writeToOutput.bind(rl);
// While muted, print nothing for typed characters, so a pasted key never shows on screen.
(rl as any)._writeToOutput = (s: string) => {
  if (!muted) writeToOutput(s);
};

// Queue lines as they arrive, so pasted or piped input is never lost between questions.
const lines: string[] = [];
let waiting: ((line: string) => void) | undefined;
let closed = false;
rl.on("line", (line) => (waiting ? (waiting(line), (waiting = undefined)) : lines.push(line)));
rl.on("close", () => {
  closed = true;
  waiting?.("");
});

async function ask(question: string, hidden: boolean): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const answer = lines.length || closed ? (lines.shift() ?? "") : await new Promise<string>((r) => (waiting = r));
  muted = false;
  if (hidden) process.stdout.write("\n");
  return answer.trim();
}

const template = await readFile(".env.example", "utf8");
let current = "";
try {
  current = await readFile(".env", "utf8");
} catch {}
const existing = Object.fromEntries(
  [...current.matchAll(/^([A-Z_]+)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]),
);

console.log("Paste each key and press Enter. Press Enter alone to keep what's there or skip.\n");
const values: Record<string, string> = { ...existing };
for (const key of KEYS) {
  const has = existing[key.name] ? " [already set]" : "";
  for (;;) {
    const answer = await ask(`${key.label}${has}: `, !key.visible);
    if (answer) values[key.name] = answer;
    if (!key.required || values[key.name]) break;
    if (closed) {
      console.log("\nStopped before the Outscraper key was entered; nothing was saved.");
      process.exit(1);
    }
    console.log("  This one is needed. Copy it from your Outscraper profile page and paste it here.");
  }
}

rl.close();
const env = template.replace(/^([A-Z_]+)=.*$/gm, (_, name) => `${name}=${values[name] ?? ""}`);
await writeFile(".env", env, { mode: 0o600 });
const set = KEYS.filter((k) => values[k.name]).map((k) => k.name);
console.log(`\nSaved .env with: ${set.join(", ")}. You can close this tab.`);
