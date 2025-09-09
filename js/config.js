// Put the published CSV URL of your Google Sheet here OR leave placeholder and set it in-app.
// How: File -> Share -> Publish to web -> choose the sheet tab -> CSV -> Publish -> copy link.
const GOOGLE_SHEET_CSV_URL = "PUT_PUBLISHED_CSV_URL_HERE"; // fallback / initial

// Allow overriding via localStorage or URL hash like #sheet=<encodedURL>
window.getSheetUrl = function() {
	try {
		const hash = new URLSearchParams(location.hash.slice(1));
		if (hash.get('sheet')) { localStorage.setItem('sheetUrl', hash.get('sheet')); }
	} catch {}
	const ls = localStorage.getItem('sheetUrl');
	return (ls && ls.trim()) || GOOGLE_SHEET_CSV_URL;
};

// Column used for Kanban grouping (must match header exactly once loaded)
const KANBAN_GROUP_COLUMN = "Status"; // change if you want a different grouping

// Columns considered numeric for stats (auto-detected too, this is a fallback)
const NUMERIC_HINTS = ["Amount", "Value", "Count"];

// Auto-refresh interval (ms)
const AUTO_REFRESH_MS = 60_000;
