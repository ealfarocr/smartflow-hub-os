# WhatsApp Embedded Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modal decorativo de conexión de WhatsApp por un flujo real de Meta Embedded Signup, de modo que un tenant pueda conectar su propia cuenta de WhatsApp Business (API estándar o Coexistente) desde la UI, sin que Eduardo tenga que crear el documento de Firestore a mano.

**Architecture:** El frontend carga el SDK de JavaScript de Facebook, abre el popup de Embedded Signup con el `config_id` ya creado en Meta, y captura el `code` de autorización más el `waba_id`/`phone_number_id` que Meta manda por `postMessage`. Ese `code` se manda a una nueva Cloud Function (`completeWhatsappEmbeddedSignup`) que lo intercambia por un token de acceso, suscribe la app a los webhooks de esa cuenta de WhatsApp, y escribe el documento en la colección `integrations` — el mismo esquema que ya consumen `whatsappWebhook`, `sendWhatsappMessage` y `getWhatsappNumbers` sin cambios.

**Tech Stack:** React 19 + Vite + TypeScript (frontend), Firebase Functions v2 (`onCall`) + Firestore + axios (backend), Facebook JS SDK (`connect.facebook.net`), Graph API v17.0.

## Global Constraints

- Graph API version en todo el código nuevo: `v17.0` (misma versión que usa el resto de `functions/src/index.ts`; no actualizar a una versión más reciente en este trabajo).
- App ID de Meta: `265699977219364152` (público, ya usado como `VITE_META_APP_ID`).
- Config ID de Embedded Signup: `2116583245566996` (público, config "ES Config" ya creada en el dashboard de Meta).
- El App Secret de Meta **nunca** se referencia desde código con prefijo `VITE_` (se bundlea al navegador). Server-side ya existe como `process.env.WHATSAPP_APP_SECRET` en `functions/.env` — no crear una fuente nueva.
- Esquema de `integrations`: `tenantId`, `provider` (`'whatsapp'`), `isActive`, `phoneNumberId`, `accessToken`, `appSecret` (opcional, con fallback ya implementado), más los campos nuevos de este plan: `wabaId`, `connectionType` (`'api' | 'coexistent'`), `connectedAt`.
- Patrón de autenticación en toda Cloud Function callable: `request.auth` requerido → `HttpsError('unauthenticated', ...)` si falta; luego `memberships/{uid}_{tenantId}` con `status === 'active'` → `HttpsError('permission-denied', ...)` si no existe o no está activa. Ver `sendWhatsappMessage` en `functions/src/index.ts:1464-1509` como referencia exacta.
- El proyecto no tiene framework de tests automatizados ni en `functions/` ni en `src/` (no hay ningún `*.test.ts` fuera de `node_modules`). La verificación de cada tarea es `tsc`/`npm run build` (chequeo de tipos) más, al final, una prueba manual end-to-end — no se introduce un framework de testing nuevo solo para esta feature.
- Alias de imports: `@/*` mapea a `./src/*` (ver `tsconfig.app.json`).

---

### Task 1: Variables de entorno — App ID, Config ID, y limpieza del App Secret

**Files:**
- Modify: `.env` (raíz del proyecto)
- Modify: `.env.development` (raíz del proyecto)

**Interfaces:**
- Produce: `import.meta.env.VITE_META_APP_ID` = `"265699977219364152"`, `import.meta.env.VITE_WHATSAPP_CONFIG_ID` = `"2116583245566996"` — usados por `src/utils/facebookSdk.ts` en la Tarea 2.

- [ ] **Step 1: Actualizar `.env`**

Reemplazar estas líneas (líneas 15-18 del archivo actual):

```
# Meta API (Instagram & Facebook)
VITE_META_APP_ID=YOUR_APP_ID
VITE_META_APP_SECRET=YOUR_APP_SECRET
VITE_META_WEBHOOK_VERIFY_TOKEN=smartflow_hub_verify_2026
```

por:

```
# Meta API (Instagram & Facebook) — App "SmartFlow Hub Connect"
VITE_META_APP_ID=265699977219364152
VITE_WHATSAPP_CONFIG_ID=2116583245566996
VITE_META_WEBHOOK_VERIFY_TOKEN=smartflow_hub_verify_2026
# El App Secret NUNCA va aquí (prefijo VITE_ = se bundlea al navegador).
# Vive server-side en functions/.env como WHATSAPP_APP_SECRET.
```

- [ ] **Step 2: Aplicar el mismo cambio en `.env.development`**

Reemplazar (líneas 9-12 del archivo actual):

```
# Meta API (Instagram & Facebook)
VITE_META_APP_ID=YOUR_APP_ID
VITE_META_APP_SECRET=YOUR_APP_SECRET
VITE_META_WEBHOOK_VERIFY_TOKEN=smartflow_hub_verify_2026
```

por:

```
# Meta API (Instagram & Facebook) — App "SmartFlow Hub Connect"
VITE_META_APP_ID=265699977219364152
VITE_WHATSAPP_CONFIG_ID=2116583245566996
VITE_META_WEBHOOK_VERIFY_TOKEN=smartflow_hub_verify_2026
# El App Secret NUNCA va aquí (prefijo VITE_ = se bundlea al navegador).
# Vive server-side en functions/.env como WHATSAPP_APP_SECRET.
```

- [ ] **Step 3: Verificación manual (no automatizable) — confirmar el App Secret del servidor**

`functions/.env` ya tiene una entrada `WHATSAPP_APP_SECRET`. Antes de continuar, entrá al dashboard
de Meta → tu app "SmartFlow Hub Connect" → **Configuración de la aplicación → Básica** → copiá el
valor de "Clave secreta de la aplicación" y confirmá (o actualizá) que coincide con el valor
actual de `WHATSAPP_APP_SECRET` en `functions/.env`. No se puede automatizar este paso porque
requiere leer un secreto desde el dashboard de Meta.

- [ ] **Step 4: Commit**

```bash
git add .env .env.development
git commit -m "config: apuntar VITE_META_APP_ID/CONFIG_ID a SmartFlow Hub Connect, retirar App Secret del cliente"
```

---

### Task 2: Utilidad de SDK de Facebook + lanzador de Embedded Signup

**Files:**
- Create: `src/utils/facebookSdk.ts`

**Interfaces:**
- Consumes: `import.meta.env.VITE_META_APP_ID`, `import.meta.env.VITE_WHATSAPP_CONFIG_ID` (Task 1).
- Produces: `loadFacebookSdk(): Promise<void>` y `launchWhatsappEmbeddedSignup(connectionType: 'api' | 'coexistent'): Promise<{ code: string; wabaId: string; phoneNumberId: string }>` — usados por `WhatsappConnectionModal.tsx` en la Tarea 5.

- [ ] **Step 1: Crear el archivo**

```ts
// src/utils/facebookSdk.ts

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

/**
 * Carga el SDK de JavaScript de Facebook una sola vez y lo inicializa con el
 * App ID de SmartFlow Hub Connect. Llamadas repetidas devuelven la misma promesa.
 */
export function loadFacebookSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('loadFacebookSdk solo puede ejecutarse en el navegador'));
      return;
    }

    if (window.FB) {
      resolve();
      return;
    }

    window.fbAsyncInit = () => {
      window.FB!.init({
        appId: import.meta.env.VITE_META_APP_ID,
        version: 'v17.0',
        xfbml: false,
      });
      resolve();
    };

    if (document.getElementById('facebook-jssdk')) return;

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/es_LA/sdk.js';
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('No se pudo cargar el SDK de Facebook'));
    document.body.appendChild(script);
  });

  return sdkPromise;
}

export interface EmbeddedSignupResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

/**
 * Abre el popup de Embedded Signup de Meta y resuelve con el código de
 * autorización más la cuenta de WhatsApp (waba_id) y el número (phone_number_id)
 * que Meta manda por postMessage mientras el popup sigue abierto.
 */
export function launchWhatsappEmbeddedSignup(
  connectionType: 'api' | 'coexistent'
): Promise<EmbeddedSignupResult> {
  return new Promise((resolve, reject) => {
    let sessionData: { wabaId: string; phoneNumberId: string } | null = null;

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          sessionData = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch {
        // Meta también manda mensajes que no son JSON válido; se ignoran.
      }
    };

    window.addEventListener('message', handleMessage);

    if (!window.FB) {
      window.removeEventListener('message', handleMessage);
      reject(new Error('El SDK de Facebook no está cargado. Llamá a loadFacebookSdk() primero.'));
      return;
    }

    window.FB.login(
      (response: any) => {
        window.removeEventListener('message', handleMessage);

        const code = response?.authResponse?.code;
        if (!code) {
          reject(new Error('Cancelaste la conexión o Meta no devolvió un código de autorización'));
          return;
        }
        if (!sessionData?.wabaId || !sessionData?.phoneNumberId) {
          reject(new Error('Meta no devolvió la cuenta de WhatsApp o el número seleccionado'));
          return;
        }
        resolve({ code, wabaId: sessionData.wabaId, phoneNumberId: sessionData.phoneNumberId });
      },
      {
        config_id: import.meta.env.VITE_WHATSAPP_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          featureType: connectionType === 'coexistent' ? 'coexistence' : '',
          sessionInfoVersion: '3',
        },
      }
    );
  });
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores relacionados a `src/utils/facebookSdk.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/facebookSdk.ts
git commit -m "feat: agregar loader del SDK de Facebook y lanzador de Embedded Signup de WhatsApp"
```

---

### Task 3: Servicio tipado para la Cloud Function `completeWhatsappEmbeddedSignup`

**Files:**
- Create: `src/services/firebase/WhatsappIntegrationService.ts`

**Interfaces:**
- Consumes: Cloud Function `completeWhatsappEmbeddedSignup` (definida en Task 4 — el servicio se escribe primero porque su contrato de tipos es lo que consume la Tarea 5; la función backend implementa exactamente este contrato).
- Produces: `WhatsappIntegrationService.completeEmbeddedSignup(payload): Promise<CompleteEmbeddedSignupResponse>` — usado por `WhatsappConnectionModal.tsx` en la Tarea 5.

- [ ] **Step 1: Crear el archivo**

```ts
// src/services/firebase/WhatsappIntegrationService.ts
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface CompleteEmbeddedSignupRequest {
  code: string;
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  connectionType: 'api' | 'coexistent';
}

export interface CompleteEmbeddedSignupResponse {
  success: boolean;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

const functions = getFunctions();

export const WhatsappIntegrationService = {
  /**
   * Envía el código de autorización del Embedded Signup de Meta al backend,
   * que lo intercambia por un access_token y crea/actualiza la integración
   * de WhatsApp del tenant en Firestore.
   */
  completeEmbeddedSignup: async (
    payload: CompleteEmbeddedSignupRequest
  ): Promise<CompleteEmbeddedSignupResponse> => {
    const fn = httpsCallable<CompleteEmbeddedSignupRequest, CompleteEmbeddedSignupResponse>(
      functions,
      'completeWhatsappEmbeddedSignup'
    );
    const res = await fn(payload);
    return res.data;
  },
};
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores relacionados a `src/services/firebase/WhatsappIntegrationService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/firebase/WhatsappIntegrationService.ts
git commit -m "feat: agregar servicio tipado para completar el Embedded Signup de WhatsApp"
```

---

### Task 4: Cloud Function `completeWhatsappEmbeddedSignup`

**Files:**
- Modify: `functions/src/index.ts` (agregar la función nueva inmediatamente después de `sendWhatsappMessage`, que termina alrededor de la línea 1690 — buscar el cierre de esa función y pegar el código antes de la siguiente función exportada, `acceptTenantInvite`)

**Interfaces:**
- Consumes: `db` (Firestore, ya definido en la línea 13), `admin`, `axios`, `onCall`/`HttpsError` (ya importados en las líneas 1-9), `process.env.WHATSAPP_APP_SECRET` (ya cargado por Firebase Functions desde `functions/.env`).
- Produces: Cloud Function callable `completeWhatsappEmbeddedSignup`, contrato exacto: recibe `{ code: string; tenantId: string; wabaId: string; phoneNumberId: string; connectionType: 'api' | 'coexistent' }`, devuelve `{ success: boolean; displayPhoneNumber: string | null; verifiedName: string | null }` (mismo contrato que `CompleteEmbeddedSignupRequest`/`CompleteEmbeddedSignupResponse` de la Tarea 3).

- [ ] **Step 1: Agregar la función**

Pegar este bloque en `functions/src/index.ts`, después del cierre de `sendWhatsappMessage`:

```ts
/**
 * completeWhatsappEmbeddedSignup — recibe el código de autorización que
 * devuelve el popup de Embedded Signup de Meta, lo intercambia por un token
 * de acceso, suscribe la app a los webhooks de la WABA del cliente, y
 * crea/actualiza el documento de integración en Firestore.
 */
export const completeWhatsappEmbeddedSignup = onCall({
  maxInstances: 10,
  timeoutSeconds: 60,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { code, tenantId, wabaId, phoneNumberId, connectionType } = request.data;
  const uid = request.auth.uid;

  if (!code || !tenantId || !wabaId || !phoneNumberId) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios (code, tenantId, wabaId, phoneNumberId)');
  }

  const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
  const membershipDoc = await membershipRef.get();
  if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
  }

  const metaAppId = '265699977219364152'; // Meta App ID de SmartFlow Hub Connect (público)
  const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();

  if (!appSecret) {
    throw new HttpsError('failed-precondition', 'Falta configurar WHATSAPP_APP_SECRET en functions/.env');
  }

  let accessToken: string;
  try {
    const tokenRes = await axios.get('https://graph.facebook.com/v17.0/oauth/access_token', {
      params: { client_id: metaAppId, client_secret: appSecret, code },
      timeout: 10000,
    });
    accessToken = tokenRes.data?.access_token;
    if (!accessToken) throw new Error('Meta no devolvió access_token');
  } catch (err: any) {
    const metaMessage = err?.response?.data?.error?.message || err.message;
    throw new HttpsError('failed-precondition', `No se pudo intercambiar el código con Meta: ${metaMessage}`);
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v17.0/${wabaId}/subscribed_apps`,
      {},
      { params: { access_token: accessToken }, timeout: 10000 }
    );
  } catch (err: any) {
    const metaMessage = err?.response?.data?.error?.message || err.message;
    throw new HttpsError('failed-precondition', `No se pudo suscribir la app a la cuenta de WhatsApp: ${metaMessage}`);
  }

  let displayPhoneNumber: string | null = null;
  let verifiedName: string | null = null;
  try {
    const phoneRes = await axios.get(`https://graph.facebook.com/v17.0/${phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name', access_token: accessToken },
      timeout: 10000,
    });
    displayPhoneNumber = phoneRes.data?.display_phone_number || null;
    verifiedName = phoneRes.data?.verified_name || null;
  } catch (err: any) {
    console.warn('[completeWhatsappEmbeddedSignup] No se pudo leer info del número:', err?.response?.data || err.message);
  }

  const existingSnapshot = await db.collection('integrations')
    .where('tenantId', '==', tenantId)
    .where('provider', '==', 'whatsapp')
    .limit(1)
    .get();

  const integrationData = {
    tenantId,
    provider: 'whatsapp',
    isActive: true,
    phoneNumberId,
    wabaId,
    accessToken,
    connectionType: connectionType === 'coexistent' ? 'coexistent' : 'api',
    displayPhoneNumber,
    verifiedName,
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (existingSnapshot.empty) {
    await db.collection('integrations').add(integrationData);
  } else {
    await existingSnapshot.docs[0].ref.set(integrationData, { merge: true });
  }

  return { success: true, displayPhoneNumber, verifiedName };
});
```

- [ ] **Step 2: Verificar que compila**

Run: `cd functions && npm run build`
Expected: `tsc` termina sin errores (genera `functions/lib/index.js` actualizado).

- [ ] **Step 3: Commit**

```bash
git add functions/src/index.ts
git commit -m "feat: agregar Cloud Function completeWhatsappEmbeddedSignup"
```

---

### Task 5: Reescribir `WhatsappConnectionModal.tsx` con el flujo real

**Files:**
- Modify: `src/modules/conversations/WhatsappConnectionModal.tsx` (reescritura completa del archivo)

**Interfaces:**
- Consumes: `loadFacebookSdk`, `launchWhatsappEmbeddedSignup` (Task 2), `WhatsappIntegrationService.completeEmbeddedSignup` (Task 3).
- Produces: prop nueva `tenantId: string` en `WhatsappConnectionModal` — la Tarea 6 debe pasarla desde `ConversationsPageView.tsx`.

- [ ] **Step 1: Reemplazar todo el contenido del archivo**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { X, Smartphone, Globe, CheckCircle2, Zap, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadFacebookSdk, launchWhatsappEmbeddedSignup } from '@/utils/facebookSdk';
import { WhatsappIntegrationService } from '@/services/firebase/WhatsappIntegrationService';

interface ConnectionType {
  id: 'api' | 'coexistent';
  title: string;
  subtitle: string;
  desc: string;
  icon: any;
  color: string;
  isRecommended?: boolean;
}

const types: ConnectionType[] = [
  {
    id: 'api',
    title: 'WhatsApp Business API',
    subtitle: 'Oficial / Corporativo',
    desc: 'Conexión multi-agente masiva, plantillas verificadas y soporte oficial de Meta. Requiere verificación de negocio.',
    icon: Globe,
    color: 'blue',
    isRecommended: true
  },
  {
    id: 'coexistent',
    title: 'WhatsApp Business App',
    subtitle: 'Coexistente / QR',
    desc: 'Usa tu aplicación de WhatsApp Business actual. No requiere verificación compleja. Ideal para equipos pequeños.',
    icon: Smartphone,
    color: 'emerald'
  }
];

type FlowStatus = 'idle' | 'loading-sdk' | 'waiting-popup' | 'saving' | 'success' | 'error';

export const WhatsappConnectionModal = ({ onClose, tenantId }: { onClose: () => void; tenantId: string }) => {
  const [selected, setSelected] = useState<'api' | 'coexistent' | null>(null);
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<FlowStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [connectedInfo, setConnectedInfo] = useState<{ displayPhoneNumber: string | null; verifiedName: string | null } | null>(null);

  const runEmbeddedSignup = useCallback(async (connectionType: 'api' | 'coexistent') => {
    setStatus('loading-sdk');
    setErrorMessage('');
    try {
      await loadFacebookSdk();
      setStatus('waiting-popup');
      const result = await launchWhatsappEmbeddedSignup(connectionType);
      setStatus('saving');
      const response = await WhatsappIntegrationService.completeEmbeddedSignup({
        code: result.code,
        tenantId,
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
        connectionType,
      });
      setConnectedInfo({ displayPhoneNumber: response.displayPhoneNumber, verifiedName: response.verifiedName });
      setStatus('success');
    } catch (err: any) {
      setErrorMessage(err?.message || 'No se pudo completar la conexión con WhatsApp');
      setStatus('error');
    }
  }, [tenantId]);

  useEffect(() => {
    if (step === 2 && selected) {
      runEmbeddedSignup(selected);
    }
  }, [step, selected, runEmbeddedSignup]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/20 animate-in fade-in duration-300">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-8 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-emerald-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 dark:text-white text-xl">Conectar WhatsApp</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configuración de Canal</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-4 rounded-2xl flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
                    Selecciona el tipo de conexión que deseas utilizar. Si ya tienes mensajes en tu celular, la opción <b>Coexistente</b> te permite mantenerlos.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelected(t.id)}
                      className={`relative p-6 rounded-[2rem] border-2 transition-all duration-300 text-left group ${
                        selected === t.id
                          ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
                          : 'bg-white border-slate-100 dark:bg-slate-900 dark:border-slate-700 hover:border-emerald-500/30'
                      }`}
                    >
                      {t.isRecommended && (
                        <span className="absolute -top-3 right-6 bg-emerald-500 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">
                          Recomendado
                        </span>
                      )}
                      <div className={`p-3 rounded-2xl mb-4 w-fit transition-colors ${
                        selected === t.id ? 'bg-white/10 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:text-emerald-500'
                      }`}>
                        <t.icon className="w-6 h-6" />
                      </div>
                      <h4 className="font-black text-base mb-1">{t.title}</h4>
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${selected === t.id ? 'opacity-60' : 'text-slate-400'}`}>
                        {t.subtitle}
                      </p>
                      <p className={`text-xs leading-relaxed ${selected === t.id ? 'opacity-80' : 'text-slate-500'}`}>
                        {t.desc}
                      </p>
                    </button>
                  ))}
                </div>

                <button
                  disabled={!selected}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#1877F2] text-white py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-600/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  Continuar con {selected === 'api' ? 'API Oficial' : 'App Business'}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="text-center space-y-8 py-4"
              >
                <div className="flex justify-center">
                  {status === 'success' ? (
                    <CheckCircle2 className="w-20 h-20 text-emerald-500" />
                  ) : status === 'error' ? (
                    <AlertCircle className="w-20 h-20 text-red-500" />
                  ) : (
                    <div className="relative">
                      <div className="w-32 h-32 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-xl font-black text-slate-900 dark:text-white">
                    {status === 'loading-sdk' && 'Cargando conexión con Meta'}
                    {status === 'waiting-popup' && 'Esperando autorización'}
                    {status === 'saving' && 'Guardando tu conexión'}
                    {status === 'success' && '¡WhatsApp conectado!'}
                    {status === 'error' && 'No se pudo conectar'}
                  </h4>
                  <p className="text-sm font-medium text-slate-500 max-w-sm mx-auto leading-relaxed">
                    {status === 'loading-sdk' && 'Preparando el inicio de sesión seguro de Meta.'}
                    {status === 'waiting-popup' && 'Completa el proceso en la ventana emergente de Facebook. No la cierres.'}
                    {status === 'saving' && 'Estamos vinculando tu número con tu Hub.'}
                    {status === 'success' && connectedInfo?.displayPhoneNumber && `Número conectado: ${connectedInfo.displayPhoneNumber}${connectedInfo.verifiedName ? ` (${connectedInfo.verifiedName})` : ''}`}
                    {status === 'error' && errorMessage}
                  </p>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      setStep(1);
                      setStatus('idle');
                      setErrorMessage('');
                    }}
                    className="flex-1 py-4 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >
                    {status === 'error' ? 'Reintentar' : 'Volver'}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={status === 'loading-sdk' || status === 'waiting-popup' || status === 'saving'}
                    className="flex-1 bg-slate-900 dark:bg-white dark:text-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:scale-[1.02] transition-transform disabled:opacity-40"
                  >
                    Cerrar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
```

- [ ] **Step 2: Verificar que compila**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: error esperado en `src/modules/conversations/ConversationsPageView.tsx` (falta pasar `tenantId`) — se resuelve en la Tarea 6. Ningún otro error nuevo.

- [ ] **Step 3: Commit**

```bash
git add src/modules/conversations/WhatsappConnectionModal.tsx
git commit -m "feat: reemplazar el modal decorativo de WhatsApp por el flujo real de Embedded Signup"
```

---

### Task 6: Pasar `tenantId` desde `ConversationsPageView.tsx`

**Files:**
- Modify: `src/modules/conversations/ConversationsPageView.tsx:795`

**Interfaces:**
- Consumes: `activeMembership` de `useAuthStore()` (ya usado en la línea 36 de este archivo), prop `tenantId` de `WhatsappConnectionModal` (Task 5).

- [ ] **Step 1: Editar la línea del render del modal**

Reemplazar:

```tsx
      {showConnectionModal && <WhatsappConnectionModal onClose={() => setShowConnectionModal(false)} />}
```

por:

```tsx
      {showConnectionModal && activeMembership?.tenantId && (
        <WhatsappConnectionModal
          onClose={() => setShowConnectionModal(false)}
          tenantId={activeMembership.tenantId}
        />
      )}
```

- [ ] **Step 2: Verificar que compila sin errores**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores en todo el proyecto (el error de la Tarea 5 debe haber desaparecido).

- [ ] **Step 3: Commit**

```bash
git add src/modules/conversations/ConversationsPageView.tsx
git commit -m "fix: pasar tenantId al modal de conexión de WhatsApp"
```

---

### Task 7: Build completo, deploy, y prueba manual end-to-end

**Files:** ninguno (tarea de verificación y despliegue)

- [ ] **Step 1: Build completo del frontend**

Run: `npm run build`
Expected: termina sin errores (genera `dist/`).

- [ ] **Step 2: Build completo de functions**

Run: `cd functions && npm run build`
Expected: termina sin errores (genera `functions/lib/index.js` con `completeWhatsappEmbeddedSignup` incluida).

- [ ] **Step 3: Deploy**

Run: `firebase deploy --only functions:completeWhatsappEmbeddedSignup,hosting`
Expected: deploy exitoso, sin errores de la CLI de Firebase.

- [ ] **Step 4: Prueba manual — flujo "WhatsApp Business API"**

1. Entrar a SmartFlow Hub OS con un tenant de prueba que hoy no tenga WhatsApp conectado (p. ej. "abc123").
2. Ir a Conversaciones → Conectar WhatsApp → elegir "WhatsApp Business API" → Continuar.
3. Completar el popup de Meta (elegir o crear una WABA y un número de prueba).
4. Confirmar en la UI que aparece "¡WhatsApp conectado!" con el número mostrado.
5. En Firestore Console, confirmar que existe un documento nuevo en `integrations` con `tenantId` del tenant de prueba, `provider: 'whatsapp'`, `isActive: true`, `phoneNumberId`, `wabaId`, `accessToken`.
6. Desde la vista de Conversaciones de ese tenant, mandar un mensaje de prueba y confirmar que `sendWhatsappMessage` lo envía sin ningún error (esa función no se tocó).
7. Mandar un WhatsApp real al número recién conectado y confirmar que `whatsappWebhook` lo recibe y aparece en el inbox del tenant correcto.

- [ ] **Step 5: Prueba manual — flujo "WhatsApp Business App / Coexistente"**

Repetir los pasos 1-6 de arriba eligiendo "WhatsApp Business App" con un número que ya tenga
instalada la app normal de WhatsApp Business. Si Meta pide un paso adicional no cubierto por
este plan (ver "Riesgo abierto: Coexistencia" en el spec), documentar exactamente qué paso
falta antes de considerar esta opción completa.

- [ ] **Step 6: Commit final (si hubo ajustes durante la prueba manual)**

```bash
git add -A
git commit -m "fix: ajustes post-prueba manual del Embedded Signup de WhatsApp"
```
