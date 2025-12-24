// js/auth.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Inicializa Firebase (singleton)
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistencia local: mantiene sesión al recargar
setPersistence(auth, browserLocalPersistence).catch(() => {
  // si falla por algún motivo, igual funcionará con la persistencia por defecto
});

export async function registerUser(email, pass) {
  const e = (email || "").trim();
  return await createUserWithEmailAndPassword(auth, e, pass);
}

export async function loginUser(email, pass) {
  const e = (email || "").trim();
  return await signInWithEmailAndPassword(auth, e, pass);
}

export async function logoutUser() {
  return await signOut(auth);
}

export function onUserChanged(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return await user.getIdToken(false);
}
