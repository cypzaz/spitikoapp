// Separate from sw.js on purpose: sw.js stays caching-only (network-first shell,
// cache-first assets); this file only handles background push display, the
// standard Firebase Cloud Messaging web pattern. Registered alongside sw.js in
// index.html's init block, but only once FIREBASE_CONFIG is filled in (see
// SETUP.md) — until then this file loads but never does anything, since
// messaging().getToken() is never called without a config.
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// Mirrors FIREBASE_CONFIG in index.html — service workers can't import the
// page's module scope, so this constant is kept in sync by hand. Not a
// secret either way (see CLAUDE.md "Backend").
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCc1lwf0UDMZedFBFoPXu773vRDJSfZots",
  authDomain: "spitikoapp.firebaseapp.com",
  projectId: "spitikoapp",
  storageBucket: "spitikoapp.firebasestorage.app",
  messagingSenderId: "223832242447",
  appId: "1:223832242447:web:380092909a54c29f6a667a"
};

if (FIREBASE_CONFIG) {
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || "Spitiko";
    const body = payload.notification?.body || "";
    self.registration.showNotification(title, {
      body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png"
    });
  });
}
