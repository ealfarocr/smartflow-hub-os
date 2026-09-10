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
import { getStorage, connectStorageEmulator } from 'firebase/storage';

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

// Use emulator if explicitly set in env. Los puertos se pueden cambiar por env
// (el QA local del puesto del vendedor usa los de firebase.e2e.json) y Storage
// también va al emulador: sin eso, un adjunto de prueba subía a producción.
if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  const port = (name: string, fallback: number) => Number(import.meta.env[name]) || fallback;
  // disableWarnings: el aviso del emulador es una barra FIJA abajo que tapa la
  // barra de mensajes del chat (el QA local la detectó como CLIP_COVERED_BY).
  // El aviso sigue saliendo en consola.
  connectAuthEmulator(auth, `http://127.0.0.1:${port('VITE_EMULATOR_AUTH_PORT', 9099)}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', port('VITE_EMULATOR_FIRESTORE_PORT', 8080));
  connectFunctionsEmulator(functions, '127.0.0.1', port('VITE_EMULATOR_FUNCTIONS_PORT', 5001));
  connectStorageEmulator(storage, '127.0.0.1', port('VITE_EMULATOR_STORAGE_PORT', 9199));
}

// Solo en el build de QA local (--mode qalocal): el script de QA entra como
// Owner con un token del emulador de Auth. En producción esta rama no existe.
if (import.meta.env.MODE === 'qalocal' && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  import('firebase/auth').then(({ signInWithCustomToken }) => {
    (window as unknown as { __sfQaAuth?: unknown }).__sfQaAuth = {
      currentUser: () => !!auth.currentUser,
      signInWithCustomToken: (t: string) => signInWithCustomToken(auth, t),
    };
  });
}
