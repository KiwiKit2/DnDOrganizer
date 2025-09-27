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

---

## 7. Firebase Cloud Sync (Accounts, Characters, Images)

The app can optionally use Firebase for:
- Auth (Email/Password + Google)
- Firestore (user document + characters subcollection)
- Storage (character images)

### 7.1 Enable Services
In Firebase Console:
1. Create / select project.
2. Add a Web App (</> icon) – copy the config.
3. Enable: Authentication → Sign-in method → Email/Password + Google.
4. Firestore Database → Create (Production mode recommended).
5. Storage → Enable (optional but used for images).

### 7.2 Add Config File
Create `js/firebase-config.js` (already done in this repo example) with:
```js
window.FIREBASE_WEB_CONFIG = { /* your project config */ };
```
Do not remove `firebase-config.sample.js`; it’s a reference. The real file overwrites the global.

### 7.3 Data Model
```
users/{uid}
	displayName, email, createdAt, lastLogin, version
	characters (subcollection)
		{characterId}
			name, stats..., lastModified, img (URL or base64 fallback)
```

### 7.4 Character Sync Logic
- First sign-in: if Firestore has no characters but local storage does, prompts to migrate.
- Real-time listener keeps local list updated (timestamp conflict resolution: newest `lastModified` wins).
- Per-character save pushes immediately (or queues offline).
- Manual buttons: “Sync to Cloud” (push diff), “Sync from Cloud” (pull & merge).

### 7.5 Offline Behavior
- Edits while offline are queued in localStorage (`pendingCloudOps`).
- On reconnect/auth ready, queue flushes with batched writes.
- Status badge shows: `live`, `synced`, `queued n`, or `offline`.

### 7.6 Image Handling
- If authenticated & online: uploads portrait to Firebase Storage under `users/{uid}/characters/{charId}/` and stores download URL.
- If offline or not signed in: stores base64 in local character data (sync later keeps existing base64 until replaced).

### 7.7 Security Rules (Starter)
Firestore (`Rules` tab):
```rules
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{uid}/{document=**} {
			allow read, write: if request.auth != null && request.auth.uid == uid;
		}
	}
}
```

Storage (`Rules` tab):
```rules
rules_version = '2';
service firebase.storage {
	match /b/{bucket}/o {
		match /users/{uid}/{allPaths=**} {
			allow read, write: if request.auth != null && request.auth.uid == uid;
		}
	}
}
```

### 7.8 Environment / Privacy Notes
- Web keys are public; do not embed admin SDK secrets here.
- Optionally restrict API key HTTP referrers once deployed.

### 7.9 Migration Edge Cases
- If you decline the initial migration, you can still push later using “Sync to Cloud”.
- Local characters with same ID vs cloud: newer `lastModified` replaces older.

### 7.10 Troubleshooting
| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `auth/api-key-not-valid` | Missing / placeholder config file | Create `js/firebase-config.js` with real config |
| Images not uploading | Storage not enabled or rules deny | Enable Storage & apply rules |
| Characters not appearing on 2nd device | Not signed in / realtime listener not attached | Sign in on both and wait a moment |
| Queue never flushes | Still offline or auth not established | Confirm network + check console for `[OfflineQueue]` logs |

---

## 8. Testing Scenarios

1. New User (No Local Data)
	 - Clear localStorage, sign in → user doc created, no migration shown.
2. Migration
	 - Create characters locally, sign in first time → accept migration → characters appear in Firestore.
3. Real-Time Update
	 - Open two tabs, edit a character (change name) → second tab updates within seconds.
4. Conflict Resolution
	 - In tab A change name, don’t save yet. In tab B load same character, change something else, save. Then save in tab A. The one with later timestamp (last save) wins.
5. Offline Queue
	 - Go offline, modify/save character multiple times → badge shows `queued n`. Go online → flush toast appears.
6. Image Upload Fallback
	 - Sign out, upload image (base64). Sign in, edit and upload a new image (URL now stored).

---

## 9. Roadmap Ideas
- Character version history
- Collaborative editing with presence
- Image optimization & deletion of orphaned Storage files
- Role-based sharing / party grouping

---

## 10. Maintenance Tips
- Rotate API key only if leaked (update `firebase-config.js`).
- Periodically prune unused Storage images (compare referenced URLs in Firestore vs Storage list).
- Backup Firestore via scheduled export if critical.

---
Cloud sync + offline-first is now active. You can continue to use the app with or without Firebase; it degrades gracefully.
