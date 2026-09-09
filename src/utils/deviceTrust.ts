// Identidad de dispositivo + vendedor recordado en ESTE navegador — nunca
// sustituye al token de Firebase Auth (que sigue siendo lo único que
// autentica de verdad), solo sirve para reconocer el equipo y saltarse la
// pantalla de "quién sos" en visitas siguientes. Ver LOOP Fase 3/4.
const DEVICE_ID_KEY = 'smartflow_device_id';
const VENDOR_IDENTITY_KEY = 'smartflow_vendor_identity';

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// Checkpoint de seguridad: identidad pública SOLO por tenantId + loginHandle
// (el "usuario" visible, ej. "michelle") — nunca un membershipId. El backend
// (loginWithPin) resuelve el membership real a partir de estos dos datos.
export interface VendorIdentity {
  tenantId: string;
  loginHandle: string;
  displayName: string;
}

export function getRememberedVendorIdentity(): VendorIdentity | null {
  const raw = localStorage.getItem(VENDOR_IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.tenantId && parsed?.loginHandle && parsed?.displayName) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function rememberVendorIdentity(identity: VendorIdentity) {
  localStorage.setItem(VENDOR_IDENTITY_KEY, JSON.stringify(identity));
}

// Borra AMBOS — identidad recordada y deviceId. Si solo se borrara la
// identidad, el próximo enrolamiento reusaría el mismo deviceId y el nuevo
// usuario del teléfono heredaría "confianza" del anterior (ver Fase 11).
export function forgetDeviceAndIdentity() {
  localStorage.removeItem(VENDOR_IDENTITY_KEY);
  localStorage.removeItem(DEVICE_ID_KEY);
}
