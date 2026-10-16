# Setup — one-time account steps

Same split as Laiki's and Spitiko's SETUP.md: a few things only you (and now your
wife, for her own phone) can do, everything else I handle by writing code and
pushing it.

## 1. GitHub repo (do first)

1. Create a new **empty** repository on GitHub (no README/.gitignore/license —
   this folder already has its own).
2. Keep it private unless you want it public.
3. Send me the repo's remote URL and I'll wire it up and push.

## 2. Netlify site (right after step 1)

1. Sign in to [netlify.com](https://netlify.com) with your GitHub account.
2. **Add new site → Import an existing project → Deploy with GitHub** → pick
   this repo.
3. Build settings: leave the build command **empty**, publish directory
   **blank** (don't type anything — `netlify.toml` deliberately has no
   `publish` key; typing `.` there is what broke Spitiko's first deploy, see
   its CLAUDE.md).
4. Deploy. You and your wife should each **Add to Home Screen** on your own
   phones once — every future deploy auto-updates both icons, no reinstall.

The app is fully usable at this point on both phones — groceries, the home
schedule, to-dos, backup/restore — each phone entirely local/independent. The
only thing missing until step 3 below is actually syncing between your two
phones.

## 3. Firebase project (this time it's not optional — it's what makes syncing between your two phones work at all)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** (the free Spark plan is enough for a household).
2. Add a **Web app** (the `</>` icon). Copy the `firebaseConfig` object and
   send it to me — this is **not a secret**, safe to commit (access is
   controlled by Firestore rules, not by hiding this). I'll paste it into
   `FIREBASE_CONFIG` in `index.html` and `firebase-messaging-sw.js`.
3. Enable **Firestore Database** (production mode, a region close to Cyprus,
   e.g. `europe-west1` or `europe-west3`).
4. Enable **Anonymous** sign-in: Authentication → Sign-in method → Anonymous.
5. I'll give you the contents of `firestore.rules` (already written in this
   repo) to paste into Firestore → Rules → publish.
6. Enable **Cloud Messaging**: Project settings → Cloud Messaging → generate
   a **Web Push certificate (VAPID key pair)**. Send me that key — goes into
   `VAPID_KEY` in `index.html`.
7. Once 2 and 6 are deployed: open the app, go to **Settings → Sharing**, tap
   **"Create a code"** on your phone. Send the 8-character code to your wife
   — she opens the app on hers, Settings → Sharing → **"I have a code"**,
   types it in. From then on, the cart, to-dos, and the maintenance schedule
   stay in sync between your two phones while both have the app open, and a
   few seconds apart otherwise.
8. For push notifications specifically (the weekly Friday digest), there's
   one more step: generate a **service account key** (Project settings →
   Service accounts → Generate new private key). **Don't send me the
   downloaded JSON file, don't commit it.** Open it, copy its contents, paste
   as a new environment variable in **Netlify → Site settings → Environment
   variables**, named `FIREBASE_SERVICE_ACCOUNT`. Then tell me — I'll move
   `weekly-digest.js` and its `package.json` back from `backend-pending/`
   into the deployed paths and push (see CLAUDE.md "Known gaps" for exactly
   what that involves).

Until step 3 is complete, Settings → Sharing still works (you can create/view
a code), it just won't actually sync anything between phones yet — same
honest "local-only until configured" behavior both older apps had.
