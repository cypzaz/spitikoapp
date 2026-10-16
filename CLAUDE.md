# Spitiko — the merged apartment app

Bilingual (English/Greek) PWA for Marios and his wife, Cyprus. One app covering
groceries (ported from Laiki), home upkeep (ported from the standalone Spitiko app),
and a general to-do/reminders list — kept in sync between their two phones via a
household code. This repo (`APPARMENT` on disk) supersedes both `../Claude` (Laiki)
and `../Spitiko` as the one actively developed app going forward; those two stay live
and untouched but aren't developed further.

## Repo layout

```
index.html                    -- app shell: all HTML/CSS/JS, no build step
catalog.json                  -- the grocery catalogue, copied unchanged from Laiki
tasks.json                    -- the home-upkeep seed catalogue, copied unchanged from Spitiko
manifest.json                 -- PWA manifest ("Spitiko")
sw.js                         -- service worker (network-first shell, cache-first assets)
firebase-messaging-sw.js      -- separate service worker, background push display only
firestore.rules               -- household-code access rules
netlify.toml                  -- build config; see "Known gaps" for the no-`publish`-key reasoning
netlify/functions/weekly-digest.js -- Friday-evening push digest (Admin SDK + FCM)
package.json                  -- backend-only deps (firebase-admin) for the function above
icons/                        -- PWA icons (reused from the standalone Spitiko app)
CLAUDE.md, SETUP.md
```

## How this came together

Built by merging two already-working apps rather than writing from scratch:
`index.html` started as a literal copy of Laiki's (to avoid any risk of
transcription errors in ~1700 lines of working code), then had Spitiko's
home-upkeep logic and screens ported in alongside it, plus a new navigation
shell and a real sync layer that neither original app actually had (both only
had sharing *documented*, never built). See "Navigation", "Data model" and
"Real two-person sync" below for what actually changed.

## Navigation

A header mode switcher — 🛒 Shopping / 🏠 Home — plus two always-visible header
icons (To-do, Settings), rather than cramming everything into one bottom nav
(Laiki alone was already at 5 tabs, the practical ceiling):

- **Shopping mode** bottom nav (4, ported from Laiki as-is): Aisles · Shopping
  list · Lists · History.
- **Home mode** bottom nav (2): **This weekend** (the dashboard — has a "+"
  FAB to quick-add a one-off maintenance item right there) · **Schedule**
  (the full editable maintenance catalogue — add/hide/delete/change-frequency).
- **To-do** (header icon, either mode): this is literally Laiki's original
  `todos`/"Other things" feature (`viewTodo()`, was `todoBlock()` embedded at
  the bottom of the shopping list — now its own screen instead), unchanged
  data shape (`text`, optional `where`, `done`). Covers non-grocery errands,
  gifts to buy, bills to pay — anything that isn't groceries or a scheduled
  chore. Deliberately **not** merged with home-upkeep one-off tasks (see Data
  model) — same feature-shape, different purpose, kept as separate state so
  "buy a gift" and "fix the sofa leg" don't end up in the same bucket.
- **Settings** (header icon, either mode): Laiki's original sections
  (Appearance/Language/Features) plus new ones (Weekend time budget,
  Notifications, Sharing, and two migration-import boxes) — see `viewSet()`.

## Data model — one `S` blob, namespaced to avoid collisions

Laiki-origin fields keep their original names (first-mover domain, unprefixed).
Spitiko-origin fields get a `home` prefix — `custom`/`rename` exist on both
sides for unrelated things (grocery item edits vs. maintenance task edits) and
would silently collide otherwise:

| Laiki (unchanged) | Spitiko (renamed on merge) |
|---|---|
| `list, custom, lists, counts, route, open, lastDone, hidden, hideCats, temp, newCats, catNames, rename, recat, cycles, defUnit, defNote, receipts, prices, stores, todos` | `tasks` → `homeTasks`, `custom` → `homeCustom`, `rename` → `homeRename`, `oneoff` → `homeOneoff` |

`set` merges directly (no collisions): Laiki's `dark, lang, dual, notes, units,
cycles, route, showPrices, voice` + Spitiko's `weekendBudget, notifications` —
all local-only, never synced (same rule both apps already had — dark mode and
language are per-person, not per-household). `syncCode` became
`S.householdCode`. Storage key: `KEY="spitiko-v2"`.

T-string collisions were handled the same way: `due`→`hDue`, and anything that
meant the same thing in both apps (save/cancel/close/del/add/settings/
appearance/language/dark/darkD/etc.) just reuses Laiki's original key rather
than duplicating it — see the `t()` lookups in the home-upkeep screens for
examples.

Home-upkeep logic/render functions are suffixed/named distinctly from Laiki's
(`dueOfHome`, `homeTaskState`, `allHomeTasks`, `viewWeekend`, `viewSchedule`,
`homeTaskRow`, etc.) — Laiki's own screens use a `viewX()` naming convention
with no overlap, so no renaming was needed there, only on the data side.

CSS was *not* duplicated wholesale from the standalone Spitiko app — most of
its classes were already near-identical copies of Laiki's own (`.lrow`,
`.grp`, `.stat`, `.sechead`, `.seg`, `.bar`, `#sheet`, etc.), reused as-is.
Only genuinely new concepts got new classes: `.statusbadge` (renamed from
Spitiko's `.badge` — that name was already taken by Laiki's nav-count
bubble), `.chip`/`.chipsrow` (Schedule's filter chips), `.budgetbar` (scoped
`.bar`/`.bar i` overrides, doesn't touch Laiki's own progress bar), `.fab`.

## Real two-person sync (the new build)

Firebase Firestore + Anonymous Auth — finally implementing what Laiki's old
CLAUDE.md only ever described; the standalone Spitiko app's `syncCode` was a
single-user placeholder that was never wired to real Firestore either.
Structure: `households/{code}/...`:

- Per-item collections, each doc stamped `updatedAt` for last-write-wins
  merging (so two phones editing *different* items never clobber each
  other): `list/{itemId}`, `todos/{id}`, `homeTasks/{taskId}`,
  `homeOneoff/{id}`. **Prices are deliberately not synced** — lower-stakes,
  more of a personal price-history feature than a "we're shopping together
  right now" one; easy to add later the same way if wanted.
- Two low-churn docs, `meta/shopping` and `meta/home`, holding everything
  else (`hidden`, `catNames`, `route`, `rename`, `custom`, `cycles`,
  `lastDone`, `lists`, etc. / `homeCustom`, `homeRename`). Rather than
  hunting down every single mutation call site that touches one of these many
  fields, `save()` itself re-pushes both meta docs wholesale on every
  (already-debounced, 300ms) save — cheap for a small blob, and far less
  error-prone than remembering a `syncPatchMeta()` call at every edit site.
  Per-item collections above still get a *targeted* `syncSetItem()`/
  `syncDeleteItem()` call right where that specific item changes, since a
  whole-blob push is exactly what per-item docs exist to avoid.
- Root `households/{code}` doc holds `fcmTokens: [{token, lang}]` — one entry
  per opted-in device, in that device's own language (push notifications
  need to know this despite `lang` itself being local-only/unsynced; this is
  metadata for pushing *to* that device, not a general settings sync).

Receiving: `attachSync()` opens one `onSnapshot` per per-item collection
(merges via `mergeMapDoc()`/`mergeArrayDoc()`, comparing `updatedAt`) and per
meta doc (just overwrites the relevant local fields — Firestore's field-path
writes are already the merge authority there, no per-field timestamp needed
client-side). Sending: `syncSetItem()`/`syncDeleteItem()`/`syncPatchMeta()`,
all no-ops without both `S.householdCode` and `FIREBASE_CONFIG` set — see
`fbReady()`. The snapshot handler never calls the sync-push helpers itself,
only user-initiated mutations do, so there's no feedback loop.

Onboarding lives in Settings → Sharing: "Create a code" (`genCode()`, 8
random characters, client-side) or "I have a code" (just types in the
partner's). No code = 100% local/offline, exactly like both original apps.

## Deploying

GitHub repo → Netlify, auto-deploy on push. I run `git commit`/`git push`
myself once the repo and Netlify site are linked — see SETUP.md for the
one-time account steps.

**Bump `CACHE_VERSION` in `sw.js` on every deploy that changes any cached
file** (including `catalog.json`/`tasks.json`) — forces the old cache to
drop and the new one to populate on an already-installed phone.

## Style

Identical palette/fonts/dark-mode mechanism to Laiki (this file *is* Laiki's
file, extended) — warm paper-and-olive, Bricolage Grotesque/Inter/JetBrains
Mono, `body.dark` class toggle.

## Known gaps / status

- **Firebase is live.** `FIREBASE_CONFIG` and `VAPID_KEY` are wired into
  `index.html`/`firebase-messaging-sw.js`, Firestore + Anonymous Auth are
  enabled, `firestore.rules` is published and verified end-to-end (anonymous
  sign-in, authenticated get/write, denied unauthenticated write, denied
  `list` on the `households` collection — all tested directly against the
  REST API during setup). `weekly-digest.js` has been moved back from
  `backend-pending/` into `netlify/functions/`, its `package.json` back to
  the repo root, and `netlify.toml` now has the `functions` directory and
  the Friday-schedule block. `FIREBASE_SERVICE_ACCOUNT` is set in Netlify's
  environment variables. Combines home-upkeep weekend-picks *and* grocery
  repeat-cycle-due items into one digest, sent per-device in that device's
  own language.
- **`netlify.toml`'s `[build]` section has no `publish` key.** The
  standalone Spitiko app's first deploy failed with "Deploy directory
  '.toml' does not exist" from `publish = "."` — looked more like a stray
  Netlify dashboard Build-settings override than a real toml bug. Leaving
  `publish` unset (defaults to repo root) sidestepped it entirely. If
  `publish` is ever set explicitly, use `"/"`, never `"."`, and check the
  dashboard's own Publish-directory field isn't set to something stray.
- **Receipt photos from the old Laiki app don't migrate** — they live in
  Laiki's IndexedDB, not its Backup-copy JSON text, so the Import-from-Laiki
  flow brings over receipt *records* (store/date/total) but not the photos
  themselves. Accepted trade-off, confirmed with Marios.
- **Price sync** — not synced between phones, see "Real two-person sync"
  above. Local/personal per device for now.
