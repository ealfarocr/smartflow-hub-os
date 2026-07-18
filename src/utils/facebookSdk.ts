declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

/**
 * Valida que el origen del postMessage sea realmente de Facebook.
 * Previene ataques por dominios que terminen con 'facebook.com'.
 */
const isValidFacebookOrigin = (origin: string): boolean => {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'facebook.com' || hostname.endsWith('.facebook.com');
  } catch {
    return false;
  }
};

/**
 * Carga el SDK de JavaScript de Facebook una sola vez y lo inicializa con el
 * App ID de SmartFlow Hub Connect. Llamadas repetidas devuelven la misma promesa.
 */
export function loadFacebookSdk(): Promise<void> {
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      sdkPromise = null;
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
        version: 'v21.0', // v17.0 está deprecada por Meta (causaba "Identificador de aplicación no válido"); v25.0 es la última al momento de escribir esto
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
    script.onerror = () => {
      script.remove();
      sdkPromise = null;
      reject(new Error('No se pudo cargar el SDK de Facebook'));
    };
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
      if (!isValidFacebookOrigin(event.origin)) return;
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === 'WA_EMBEDDED_SIGNUP' &&
          data.data?.waba_id &&
          data.data?.phone_number_id
        ) {
          sessionData = {
            wabaId: data.data.waba_id,
            phoneNumberId: data.data.phone_number_id,
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
