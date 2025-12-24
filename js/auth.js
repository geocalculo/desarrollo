// js/auth.js
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Estado global simple
window.GeoIPTAuth = window.GeoIPTAuth || {
  user: null,
  ready: false
};

function emitAuthChanged() {
  window.dispatchEvent(
    new CustomEvent("geoipt-auth-changed", {
      detail: { user: window.GeoIPTAuth.user, ready: window.GeoIPTAuth.ready }
    })
  );
}

onAuthStateChanged(auth, (user) => {
  window.GeoIPTAuth.user = user || null;
  window.GeoIPTAuth.ready = true;
  emitAuthChanged();
});

export async function register(email, pass) {
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

export async function login(email, pass) {
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken(false);
}

export function getUser() {
  return window.GeoIPTAuth.user;
}

export function onAuthReady(cb) {
  // Si ya está listo, corre altiro
  if (window.GeoIPTAuth.ready) cb(window.GeoIPTAuth.user);

  // y además se engancha a cambios
  window.addEventListener("geoipt-auth-changed", (e) => cb(e.detail.user));
}
