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

// Fallback image (simple gray token SVG) for blocked or missing external images
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" rx="40" fill="%231d2125"/><circle cx="200" cy="150" r="90" fill="%23333"/><rect x="110" y="250" width="180" height="110" rx="55" fill="%23333"/><text x="200" y="230" font-size="120" text-anchor="middle" fill="%23555" font-family="Inter,Arial,sans-serif">?</text></svg>';

// Domains we never try to load (will auto-replace with placeholder to avoid console noise)
const BLOCKED_IMAGE_DOMAINS = ['placekitten.com'];
