import { readFile, writeFile } from "node:fs/promises";
import { judge, type Candidate } from "./judge.ts";
import { fetchNewReviews, looksLikeMatch, type Restaurant } from "./outscraper.ts";
import { announce } from "./telegram.ts";

try {
  process.loadEnvFile();
} catch {
  // No .env file (e.g. on GitHub Actions); keys come from the environment.
}

export interface FeedItem {
  id: string;
  restaurant: string;
  area: string;
  city: string;
  rating: number;
  headline: string;
  topic: string;
  text: string;
  author: string;
  postedAt: string;
  link: string;
  foundAt: string;
}

interface State {
  lastScan?: string;
  /** Reviews Outscraper has returned (and billed) this calendar month, e.g. { month: "2026-11", reviews: 812 }. */
  usage?: { month: string; reviews: number };
  /** How each restaurant was matched on Google Maps, so you can check the match is right. */
  places: Record<string, { placeId: string; matchedName: string; matchedAddress: string }>;
  seen: string[];
}

const FIRST_SCAN_LOOKBACK_DAYS = 2;
// About $10/month: 500 free reviews plus ~3,300 at $3 per 1,000. Change with MONTHLY_REVIEW_BUDGET.
const MONTHLY_REVIEW_BUDGET = Number(process.env.MONTHLY_REVIEW_BUDGET || 3800);
const MAX_REVIEWS_PER_RESTAURANT = 50;
const OVERLAP_MINUTES = 10; // re-read a little of the last window so nothing slips between scans
const MAX_FEED_ITEMS = 500;
const MAX_SEEN_IDS = 5000;

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n");

// Paused restaurants (e.g. ones without their own Google Maps listing yet) are not checked.
const restaurants = (await readJson<Restaurant[]>("restaurants.json", [])).filter((r) => !r.paused);
const state: State = await readJson("data/state.json", { places: {}, seen: [] });
const feed: { updatedAt?: string; paused?: string; items: FeedItem[] } = await readJson("docs/feed.json", { items: [] });

const now = new Date();
const firstScan = !state.lastScan;
const since = firstScan
  ? new Date(now.getTime() - FIRST_SCAN_LOOKBACK_DAYS * 86_400_000)
  : new Date(new Date(state.lastScan!).getTime() - OVERLAP_MINUTES * 60_000);

const month = now.toISOString().slice(0, 7);
if (state.usage?.month !== month) state.usage = { month, reviews: 0 };
const perPlace = Math.min(
  MAX_REVIEWS_PER_RESTAURANT,
  Math.floor((MONTHLY_REVIEW_BUDGET - state.usage.reviews) / restaurants.length),
);
if (perPlace < 1) {
  console.log(`Monthly budget of ${MONTHLY_REVIEW_BUDGET} reviews used up; skipping until next month.`);
  feed.paused = "This month's review budget is used up. Checking resumes on the 1st.";
  feed.updatedAt = now.toISOString();
  await writeJson("docs/feed.json", feed);
  await writeJson("data/state.json", state);
  process.exit(0);
}
delete feed.paused;

// A place id set by hand in restaurants.json wins over the one remembered from an earlier match.
const knownPlace = new Set(restaurants.filter((r) => r.placeId || state.places[r.name]).map((r) => r.name));
for (const r of restaurants) r.placeId ??= state.places[r.name]?.placeId;
console.log(`Checking ${restaurants.length} restaurants for reviews since ${since.toISOString()}`);
const results = await fetchNewReviews(restaurants, since, perPlace);

const seen = new Set(state.seen);
const candidates: (Omit<Candidate, "restaurant"> & { place: Restaurant; review: (typeof results)[number]["reviews"][number] })[] = [];
const unmatched: string[] = [];
let fetched = 0;

results.forEach((result, i) => {
  const r = restaurants[i];
  fetched += result.reviews.length; // billed even if we end up discarding them
  if (!result.placeId) return unmatched.push(r.name);
  // A first-time search can land on the hotel or mall instead of the restaurant; don't trust those.
  if (!knownPlace.has(r.name) && !looksLikeMatch(r.name, result.matchedName ?? "")) {
    return unmatched.push(`${r.name} (search found "${result.matchedName}")`);
  }
  if (!state.places[r.name]) {
    state.places[r.name] = {
      placeId: result.placeId,
      matchedName: result.matchedName ?? "",
      matchedAddress: result.matchedAddress ?? "",
    };
  }
  for (const review of result.reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    if (review.rating <= 3) {
      candidates.push({ id: review.id, place: r, rating: review.rating, text: review.text, review });
    }
  }
});

state.usage.reviews += fetched;
console.log(`${fetched} reviews fetched (${state.usage.reviews}/${MONTHLY_REVIEW_BUDGET} this month), ${candidates.length} new ones at 3 stars or below`);
if (unmatched.length) console.log(`Not matched on Google Maps (add a "query" or "placeId" in restaurants.json): ${unmatched.join(", ")}`);

const verdicts = new Map(
  (await judge(candidates.map((c) => ({ id: c.id, restaurant: c.place.name, rating: c.rating, text: c.text })))).map(
    (v) => [v.id, v],
  ),
);

const newItems: FeedItem[] = [];
for (const c of candidates) {
  const v = verdicts.get(c.id);
  if (!(v?.negative ?? c.rating <= 2)) continue;
  newItems.push({
    id: c.id,
    restaurant: c.place.name,
    area: c.place.area,
    city: c.place.city,
    rating: c.rating,
    headline: v?.headline ?? `${c.rating}-star review`,
    topic: v?.topic ?? "other",
    text: c.review.text,
    author: c.review.author,
    postedAt: c.review.postedAt,
    link: c.review.link,
    foundAt: now.toISOString(),
  });
}
newItems.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
console.log(`${newItems.length} new negative reviews`);

// The first scan only fills the feed with the past week, so Telegram isn't flooded.
if (!firstScan) for (const item of newItems) await announce(item);

const newIds = new Set(newItems.map((i) => i.id));
feed.items = [...newItems.reverse(), ...feed.items.filter((i) => !newIds.has(i.id))].slice(0, MAX_FEED_ITEMS);
feed.updatedAt = now.toISOString();
state.lastScan = now.toISOString();
state.seen = [...seen].slice(-MAX_SEEN_IDS);

await writeJson("docs/feed.json", feed);
await writeJson("data/state.json", state);
