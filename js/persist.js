// small local cache + change tracking
const STORAGE_KEY = 'organizer-cache-v1';

export function saveCache(state) {
  try {
    const payload = { t: Date.now(), headers: state.headers, objects: state.objects };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

export function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function diffCounts(a, b) {
  if (!a || !b) return { added:0, removed:0 };
  const key = row => JSON.stringify(row);
  const setA = new Set(a.objects.map(key));
  const setB = new Set(b.objects.map(key));
  let added=0, removed=0;
  for (const k of setB) if (!setA.has(k)) added++;
  for (const k of setA) if (!setB.has(k)) removed++;
  return { added, removed };
}
