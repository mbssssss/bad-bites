// Outscraper's Google Maps Reviews API: https://docs.outscraper.com/endpoints/google-maps-reviews/
// Unlike Google's own Places API, it can return only the reviews posted since a given time.

export interface Restaurant {
  name: string;
  area: string;
  city: string;
  opened: string;
  source: string;
  check?: string;
  /** Skip this restaurant, e.g. until it has its own Google Maps listing. */
  paused?: boolean;
  /** Custom Google Maps search, for restaurants whose default search finds their hotel or mall instead. */
  query?: string;
  /** Google place id, filled in after the first scan matches the restaurant on Google Maps. */
  placeId?: string;
}

export interface GoogleReview {
  id: string;
  rating: number;
  text: string;
  author: string;
  postedAt: string; // ISO date
  link: string;
}

export interface PlaceResult {
  placeId?: string;
  matchedName?: string;
  matchedAddress?: string;
  reviews: GoogleReview[];
}

const BATCH_SIZE = 5;

export function searchText(r: Restaurant): string {
  return r.placeId ?? r.query ?? `${r.name}, ${r.area}, ${r.city}, United Arab Emirates`;
}

const allWords = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const words = (s: string) => allWords(s).filter((w) => w.length >= 3 || /\d/.test(w));

/**
 * Whether the Google Maps place looks like the restaurant rather than the hotel or mall it is in.
 * Requires a shared word, ignoring accents, so "Rosa's Thai - Galleria Mall" matches "Rosa's Thai"
 * but "The Galleria Al Maryah Island" does not match "Hanbok".
 */
export function looksLikeMatch(restaurantName: string, placeName: string): boolean {
  const place = new Set(allWords(placeName));
  const joined = allWords(placeName).join("");
  // Short names like "Yù & Mì" have no 3-letter words, so fall back to all of their words.
  const mine = words(restaurantName).length ? words(restaurantName) : allWords(restaurantName);
  // Words one letter apart also count, for spelling variants like "Sienna" and "Siena"
  // (but not "Palais" and "Palace", which would match a hotel).
  return mine.some(
    (w) => place.has(w) || joined.includes(w) || (w.length >= 4 && [...place].some((p) => oneEditApart(w, p))),
  );
}

/** True if a and b differ by at most one inserted, deleted or changed letter. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * New Google reviews (with text) posted after `since` for each restaurant, in the same order.
 * Outscraper bills per review returned, so `perPlace` caps how many one restaurant can cost.
 */
export async function fetchNewReviews(restaurants: Restaurant[], since: Date, perPlace: number): Promise<PlaceResult[]> {
  const results: PlaceResult[] = [];
  for (let i = 0; i < restaurants.length; i += BATCH_SIZE) {
    results.push(...(await fetchBatch(restaurants.slice(i, i + BATCH_SIZE), since, perPlace)));
  }
  return results;
}

async function fetchBatch(batch: Restaurant[], since: Date, perPlace: number): Promise<PlaceResult[]> {
  const params = new URLSearchParams({
    reviewsLimit: String(perPlace),
    limit: "1",
    cutoff: String(Math.floor(since.getTime() / 1000)),
    ignoreEmpty: "true",
    language: "en",
    region: "AE",
    async: "false",
  });
  for (const r of batch) params.append("query", searchText(r));

  const res = await fetch(`https://api.outscraper.com/google-maps-reviews?${params}`, {
    headers: { "X-API-KEY": requireEnv("OUTSCRAPER_API_KEY") },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Outscraper ${res.status}: ${body.slice(0, 300)}`);
  const data: any[] = JSON.parse(body).data ?? [];

  // One entry per query, in query order. Some entries come back wrapped in an array.
  return batch.map((_, i) => {
    const place = Array.isArray(data[i]) ? data[i][0] : data[i];
    if (!place) return { reviews: [] };
    return {
      placeId: place.place_id,
      matchedName: place.name,
      matchedAddress: place.full_address,
      reviews: (place.reviews_data ?? []).map((r: any) => ({
        // The documented reviews_id is shared by all reviews of a place, so build our own id.
        id: r.review_id ?? `${place.place_id}:${r.author_id}:${r.review_timestamp}`,
        rating: r.review_rating,
        text: cleanText(r.review_text ?? ""),
        author: r.author_title ?? "A Google user",
        postedAt: new Date(r.review_timestamp * 1000).toISOString(),
        link: r.review_link ?? place.reviews_link ?? "",
      })),
    };
  });
}

/** Outscraper sends line breaks as <br> tags; turn them back into plain text. */
export function cleanText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}
