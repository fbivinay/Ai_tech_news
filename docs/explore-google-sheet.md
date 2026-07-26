# Explore — Google Sheet setup (events & courses)

The Explore page's **Events** and **Courses** tabs are populated from a public
Google Sheet, refetched every refresh cycle. Edit a row → it's live on the site
within ~1 minute. No API key, no redeploy.

## One-time setup

1. Create a Google Sheet with **two tabs** named exactly `events` and `courses`.
2. **Share** it: *Anyone with the link → Viewer*.
3. Copy the spreadsheet id from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`
4. Set it as an env var:
   - Local: `EXPLORE_SHEET_ID=<id>` in your shell / `.env`.
   - Vercel: Project → Settings → Environment Variables → `EXPLORE_SHEET_ID`.

If `EXPLORE_SHEET_ID` is unset, Events and Courses are simply empty — every
other tab (Papers, Jobs, Hackathons) still works.

## Column headers

Header row is case-insensitive; extra columns are ignored; only `title` + `link`
are required.

**`events` tab:** `title`, `link`, `type` (conference | workshop | session),
`date` (YYYY-MM-DD — past-dated rows are auto-hidden), `mode` (online |
in-person), `city`, `free` (yes/no), `source`, `blurb`, `image`.

**`courses` tab:** `title`, `link`, `provider`, `level` (Beginner/…),
`cert` (yes/no), `blurb`, `image`.
