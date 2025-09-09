# Organizer Dashboard

Sleek dark dashboard that reads a published Google Sheet (CSV) and gives you:
- Live table (search, sort, filters)
- Kanban board (drag cards, local only)
- Stats (chart + summary of first numeric column)
- Export JSON / CSV
- Auto-refresh + local cache

## 1. Prepare Google Sheet
1. Upload / open your Excel in Google Sheets.
2. Clean headers (unique, short).
3. File → Share → Publish to web → Select the tab you want → Format: CSV → Publish.
4. Copy the provided CSV URL (ends with `output=csv`).
5. Edit `js/config.js` and set `GOOGLE_SHEET_CSV_URL`.

## 2. Run locally
Install dependencies (only for the tiny dev server + optional deploy helper):
```bash
npm install
npm run start
```
Go to: http://localhost:5173/

(You can also run `python -m http.server 5173` if you prefer and skip npm; modules just need HTTP, nothing else.)

## 3. Deploy to GitHub Pages
Create a repo and push these files. In GitHub repo settings:
- Settings → Pages → Source: `gh-pages` (after publishing) or main branch root if you don't want a build.

Simplest: No build step required. Enable Pages on the default branch.

If using the `gh-pages` branch tool:
```bash
npm run deploy
```
That publishes the current directory to a `gh-pages` branch (make sure `.gitignore` does not exclude needed files).

## 4. Customization
- Change Kanban grouping: `KANBAN_GROUP_COLUMN` in `js/config.js`.
- Adjust auto-refresh: `AUTO_REFRESH_MS`.
- Add numeric detection hints: `NUMERIC_HINTS`.

## 5. Privacy
All processing stays in the browser. Only the published CSV is fetched.

## 6. Notes
Dragging cards only updates local memory (and cache). To sync changes back you’d need an Apps Script or API endpoint (not included).

---
Enjoy.
