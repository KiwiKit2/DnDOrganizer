// Put the published CSV URL of your Google Sheet here.
// How: File -> Share -> Publish to web -> choose the sheet tab -> CSV -> Publish -> copy link.
const GOOGLE_SHEET_CSV_URL = "PUT_PUBLISHED_CSV_URL_HERE";

// Column used for Kanban grouping (must match header exactly once loaded)
const KANBAN_GROUP_COLUMN = "Status"; // change if you want a different grouping

// Columns considered numeric for stats (auto-detected too, this is a fallback)
const NUMERIC_HINTS = ["Amount", "Value", "Count"];

// Auto-refresh interval (ms)
const AUTO_REFRESH_MS = 60_000;
