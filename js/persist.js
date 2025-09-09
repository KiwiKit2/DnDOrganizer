// small local cache + change tracking (global namespace Persist)
const STORAGE_KEY = 'organizer-cache-v1';
function saveCache(state) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ t: Date.now(), headers: state.headers, objects: state.objects })); } catch {} }
function loadCache() { try { const raw = localStorage.getItem(STORAGE_KEY); return raw? JSON.parse(raw): null; } catch { return null; } }
function diffCounts(a,b){ if(!a||!b) return {added:0,removed:0}; const key=r=>JSON.stringify(r); const setA=new Set(a.objects.map(key)); const setB=new Set(b.objects.map(key)); let added=0,removed=0; for(const k of setB) if(!setA.has(k)) added++; for(const k of setA) if(!setB.has(k)) removed++; return {added,removed}; }
window.Persist = { saveCache, loadCache, diffCounts };
