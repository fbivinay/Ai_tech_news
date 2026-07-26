# Explore — Google Sheet setup (courses)

The Explore page's **Courses** tab is populated from a public Google Sheet,
refetched every refresh cycle. Edit a row → it's live on the site within
~1 minute. No API key, no redeploy.

## One-time setup

1. Create a Google Sheet with **one tab** named exactly `courses`.
2. **Share** it: *Anyone with the link → Viewer*.
3. Copy the spreadsheet id from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`
4. Set it as an env var:
   - Local: `EXPLORE_SHEET_ID=<id>` in your shell / `.env`.
   - Vercel: Project → Settings → Environment Variables → `EXPLORE_SHEET_ID`.

If `EXPLORE_SHEET_ID` is unset, Courses is simply empty — every other tab
(Papers, Jobs, Hackathons) still works.

## Column headers

Header row is case-insensitive; extra columns are ignored; only `title` + `link`
are required.

**`courses` tab:** `title`, `link`, `provider`, `level` (Beginner/…),
`cert` (yes/no), `blurb`, `image`.
