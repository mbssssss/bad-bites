# Bad Bites Abu Dhabi

A news feed of new negative Google reviews for restaurants that opened in Abu Dhabi since
July 2025. Every 30 minutes a scan:

1. asks Outscraper for each restaurant's Google reviews posted since the last scan,
2. keeps 1-2 star reviews (and, if an Anthropic key is set, has Claude pick out complaining 3-star reviews and write a news-style headline for each),
3. otherwise uses the opening words of each review as its headline,
4. adds them to the feed page (`docs/`) and posts them to a Telegram channel.

## Files

| File | What it is |
|---|---|
| `restaurants.json` | The restaurants being watched. Edit this to add or remove one. |
| `docs/index.html` | The feed page your peers open. |
| `docs/feed.json` | The feed itself, updated by each scan. |
| `data/state.json` | What the scanner remembers: last scan time, reviews already seen, and which Google Maps place each restaurant was matched to. |
| `.github/workflows/scan.yml` | Runs the scan every 30 minutes on GitHub. |

## Keys

Put these in `.env` to run locally, and in the GitHub repository's **Settings → Secrets and variables → Actions** to run on GitHub:
`OUTSCRAPER_API_KEY`, and optionally `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `MONTHLY_REVIEW_BUDGET`.

## Run locally

```bash
npm install
npm run scan    # one scan
npm start       # feed page at http://localhost:3017
```

The first scan fills the feed with the past 2 days and does not post to Telegram. After that,
every new bad review is posted. Check `data/state.json` after the first scan to make sure each
restaurant was matched to the right place on Google Maps.

## Cost

Outscraper charges per review returned (about $3 per 1,000, first 500 free) and only new reviews
are fetched, so cost grows with how many reviews the restaurants get, not how often you check.
The scanner counts reviews per calendar month and pauses once `MONTHLY_REVIEW_BUDGET` (default
3,800, about $10) is reached, resuming on the 1st. Claude, if enabled, only reads new reviews of
3 stars or less, costing roughly $1-3 a month.
