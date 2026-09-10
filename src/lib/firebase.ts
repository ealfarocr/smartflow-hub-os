import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  getAuth,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const app = initializeApp(firebaseConfig);
// PERSISTENCIA DE SESIoN EXPLiCITA. Antes era getAuth(app) a secas: el SDK
// elige el default y, si IndexedDB no esta disponible (navegadores moviles con
// almacenamiento restringido, modo ahorro, ciertos ajustes de privacidad), cae
// a persistencia EN MEMORIA sin avisar — y la sesion muere al cerrar la app.
// Eso obligaba al vendedor a escribir su codigo de acceso en cada apertura.
// Ahora se declara la cadena de intentos: IndexedDB primero y localStorage
// como respaldo; el SDK usa el primero que funcione.
//
// browserPopupRedirectResolver va explicito porque initializeAuth NO lo incluye
// solo (a diferencia de getAuth): sin el, signInWithPopup — el login con Google
// — dejaria de funcionar.
function createAuth() {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    // initializeAuth lanza si ya se inicializo este app (pasa con el recambio
    // en caliente del dev server). En ese caso la instancia existente ya tiene
    // la configuracion de arriba, asi que alcanza con recuperarla.
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Use emulator if explicitly set in env
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
