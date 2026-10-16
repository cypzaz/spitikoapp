// Scheduled Netlify Function (see netlify.toml) — runs every Friday evening.
// Computes the same "due/overdue, fits the weekend time budget" home-upkeep
// list the in-app dashboard shows, plus any repeat-cycle grocery items that
// have come due, then sends one push per registered device via FCM — in
// that device's own language.
//
// Needs one Netlify environment variable (set once, see SETUP.md — never
// committed to the repo):
//   FIREBASE_SERVICE_ACCOUNT — the Firebase project's service-account JSON,
//                              as a single-line string
//
// With no FIREBASE_SERVICE_ACCOUNT set, or no household with a registered
// device, this function does nothing and exits quietly — nothing breaks for
// the fully-local/offline usage path.

const admin = require("firebase-admin");
const TASKS = require("../../tasks.json");
const CATALOG = require("../../catalog.json");

function slug(cat, en) {
  return (cat + "|" + en).toLowerCase().replace(/[^a-z0-9|]+/g, "-");
}

/* ---- home-upkeep due-date math — mirrors index.html, keep both in sync ---- */
function hashFrac(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
function nextActiveDue(due, activeMonths) {
  if (!activeMonths || !activeMonths.length) return due;
  const d = new Date(due);
  for (let i = 0; i < 12; i++) {
    if (activeMonths.includes(d.getMonth() + 1)) return d.getTime();
    d.setMonth(d.getMonth() + 1, 1);
    d.setHours(0, 0, 0, 0);
  }
  return due;
}
function dueOf(task, state, now) {
  const st = state[task.id] || {};
  if (st.lastDone == null) {
    const freqMs = task.freqDays * 86400000;
    const due = now + freqMs * hashFrac(task.id);
    return nextActiveDue(due, task.activeMonths);
  }
  const freq = st.customFreqDays || task.freqDays;
  let due = st.lastDone + freq * 86400000;
  if (st.snoozeUntil && st.snoozeUntil > due) due = st.snoozeUntil;
  return nextActiveDue(due, task.activeMonths);
}
function oneoffDueMs(n) {
  return new Date(n.due + "T00:00:00").getTime();
}
function dueCandidates(tasks, state, oneoff, now) {
  const taskItems = tasks
    .filter((ta) => !(state[ta.id] || {}).hidden)
    .map((ta) => ({ kind: "task", ta, due: dueOf(ta, state, now) }));
  const noteItems = (oneoff || [])
    .filter((n) => !n.done && n.due)
    .map((n) => ({ kind: "note", n, due: oneoffDueMs(n) }));
  return taskItems.concat(noteItems);
}
function itemMinutes(x) {
  return x.kind === "task" ? x.ta.estMinutes : x.n.estMinutes || 20;
}
function itemName(x, lang) {
  if (x.kind === "task") return lang === "gr" ? x.ta.gr || x.ta.en : x.ta.en;
  return x.n.title;
}
function weekendPicks(tasks, state, oneoff, budgetMinutes, now) {
  const due = dueCandidates(tasks, state, oneoff, now)
    .filter((x) => x.due <= now + 14 * 86400000)
    .sort((a, b) => a.due - b.due);
  let used = 0;
  const picked = [];
  for (const x of due) {
    if (used > 0 && used >= budgetMinutes) break;
    picked.push(x);
    used += itemMinutes(x);
  }
  return picked;
}

/* ---- grocery repeat-cycle due math — mirrors index.html's dueItems() ---- */
const CYCLE_DAYS = { wk: 7, fn: 14, mo: 30 };
function shoppingDue(catalog, listState, cyclesState, lastDoneState, now) {
  const items = {};
  catalog.forEach(([cat, , arr]) => arr.forEach(([en, gr]) => { items[slug(cat, en)] = { en, gr }; }));
  const out = [];
  Object.keys(lastDoneState || {}).forEach((id) => {
    if ((listState || {})[id]) return; // already back in the cart
    const cyc = (cyclesState || {})[id];
    if (!cyc || !CYCLE_DAYS[cyc]) return;
    if (now - lastDoneState[id] >= CYCLE_DAYS[cyc] * 86400000) {
      const it = items[id];
      if (it) out.push(it);
    }
  });
  return out;
}

function digestText(picked, dueGroceries, lang) {
  const overdue = picked.filter((x) => x.due < Date.now()).length;
  const homeNames = picked.slice(0, 3).map((x) => itemName(x, lang)).join(", ");
  const groceryNames = dueGroceries.slice(0, 3).map((it) => (lang === "gr" ? it.gr || it.en : it.en)).join(", ");
  const parts = [];
  if (picked.length) {
    const label = lang === "gr" ? picked.length + " εργασίες σπιτιού" : picked.length + " home tasks";
    parts.push(label + (homeNames ? ": " + homeNames + (picked.length > 3 ? "…" : "") : ""));
  }
  if (dueGroceries.length) {
    const label = lang === "gr" ? dueGroceries.length + " ψώνια" : dueGroceries.length + " groceries due";
    parts.push(label + (groceryNames ? ": " + groceryNames + (dueGroceries.length > 3 ? "…" : "") : ""));
  }
  const title = lang === "gr" ? "Spitiko — υπενθύμιση Σαββατοκύριακου" : "Spitiko — weekend reminder";
  const prefix = overdue ? (lang === "gr" ? overdue + " εκπρόθεσμες. " : overdue + " overdue. ") : "";
  return { title, body: prefix + parts.join(" · ") };
}

exports.handler = async () => {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) return { statusCode: 200, body: "no service account configured, skipping" };

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saJson)) });
  }
  const db = admin.firestore();
  const now = Date.now();

  const householdsSnap = await db.collection("households").get();
  let sent = 0;

  for (const hh of householdsSnap.docs) {
    const root = hh.data();
    const tokens = root.fcmTokens || []; // [{token, lang}] — one entry per opted-in device
    if (!tokens.length) continue;

    const [listSnap, homeTasksSnap, homeOneoffSnap, metaHomeSnap, metaShopSnap] = await Promise.all([
      hh.ref.collection("list").get(),
      hh.ref.collection("homeTasks").get(),
      hh.ref.collection("homeOneoff").get(),
      hh.ref.collection("meta").doc("home").get(),
      hh.ref.collection("meta").doc("shopping").get(),
    ]);

    const listState = {};
    listSnap.forEach((d) => { listState[d.id] = d.data(); });
    const homeTaskState = {};
    homeTasksSnap.forEach((d) => { homeTaskState[d.id] = d.data(); });
    const oneoff = [];
    homeOneoffSnap.forEach((d) => oneoff.push({ id: d.id, ...d.data() }));

    const metaHome = metaHomeSnap.exists ? metaHomeSnap.data() : {};
    const homeCustom = (metaHome.homeCustom || []).map((c) => ({ ...c, custom: true }));
    const homeRename = metaHome.homeRename || {};
    const tasks = TASKS.concat(homeCustom).map((ta) => {
      const r = homeRename[ta.id];
      return r ? { ...ta, en: r.en || ta.en, gr: r.gr || ta.gr } : ta;
    });
    const picked = weekendPicks(tasks, homeTaskState, oneoff, 120, now);

    const metaShop = metaShopSnap.exists ? metaShopSnap.data() : {};
    const dueGroceries = shoppingDue(CATALOG, listState, metaShop.cycles, metaShop.lastDone, now);

    if (!picked.length && !dueGroceries.length) continue;

    for (const tok of tokens) {
      const lang = tok.lang === "gr" ? "gr" : "en";
      const { title, body } = digestText(picked, dueGroceries, lang);
      try {
        await admin.messaging().send({ token: tok.token, notification: { title, body } });
        sent++;
      } catch (e) {
        // one device's bad/expired token shouldn't stop the rest
      }
    }
  }

  return { statusCode: 200, body: "sent " + sent + " notifications" };
};
