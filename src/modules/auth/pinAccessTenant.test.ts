import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Membership } from '@/types';
import type { VendorIdentity } from '@/utils/deviceTrust';

// authStore real, con Firebase/servicios simulados: se ejecuta de verdad la
// resolución de negocio activo que corre al cambiar la sesión.
let authListener: ((u: { uid: string } | null) => Promise<void>) | null = null;
let profile: Record<string, unknown> = {};
let memberships: Membership[] = [];

vi.mock('@/lib/firebase', () => ({
  auth: { onAuthStateChanged: (cb: (u: { uid: string } | null) => Promise<void>) => { authListener = cb; } },
  db: {},
}));
vi.mock('@/services/AuthService', () => ({
  AuthService: {
    linkPendingMembership: async () => {},
    getUserProfile: async () => profile,
    getUserMemberships: async () => memberships.map((m) => ({ ...m })),
  },
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ subscribe: () => {} }) } }));
vi.mock('@/stores/conversationStore', () => ({ useConversationStore: { getState: () => ({ reset: () => {} }) } }));
vi.mock('@/stores/leadStore', () => ({ useLeadStore: { getState: () => ({ reset: () => {} }) } }));
vi.mock('@/stores/userStore', () => ({ useUserStore: { getState: () => ({ reset: () => {} }) } }));

import { useAuthStore } from '@/stores/authStore';
import {
  ACTIVE_TENANT_KEY, resolveAccessIdentity, isSameIdentity, persistValidatedTenant, ensureActiveTenant,
} from './pinAccessTenant';

// Fuente leída con import.meta.glob (sin tipos de Node), como otras pruebas del repo.
const fuentes = import.meta.glob('/src/modules/conversations/ConversationsPageView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const UID = 'nqjpQTo7teOOsJNoog5EsLQXfKt1';
const A = 't-1788554584458'; // USADITOS original
const B = 't-1791700036682'; // USADITOS CR

const mem = (tenantId: string): Membership => ({
  id: `${UID}_${tenantId}`, userId: UID, tenantId, role: 'Asesor Comercial', status: 'active',
} as Membership);

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

let local: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;

// Simula "login por código": tras validar, el flujo persiste el negocio del
// servidor y recién entonces cambia la sesión de Firebase.
async function signIn() {
  await authListener!({ uid: UID });
}

beforeEach(() => {
  local = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  profile = { id: UID, name: 'eduardo pruebas', email: 'x@y.z' };
  memberships = [mem(A), mem(B)]; // Firestore devuelve A primero (orden por id)
  useAuthStore.setState({ user: null, memberships: [], activeMembership: null, isAuthenticated: false, impersonatedName: null });
  useAuthStore.getState().initializeAuthListener();
});

describe('resolveAccessIdentity — el enlace explícito gana', () => {
  const remA: VendorIdentity = { tenantId: A, loginHandle: 'eduardopruebas', displayName: 'eduardo pruebas' };
  const link = { h: 'eduardopruebas', t: B, n: 'eduardo%20pruebas' };

  it('identidad recordada de A + enlace a B => usa B', () => {
    expect(resolveAccessIdentity(link, remA)).toEqual({ tenantId: B, loginHandle: 'eduardopruebas', displayName: 'eduardo pruebas' });
  });
  it('recordada del mismo negocio y persona => se reutiliza', () => {
    const remB = { ...remA, tenantId: B };
    expect(resolveAccessIdentity(link, remB)).toBe(remB);
  });
  it('recordada del mismo negocio pero otra persona => gana el enlace', () => {
    expect(resolveAccessIdentity(link, { ...remA, tenantId: B, loginHandle: 'otra' })?.loginHandle).toBe('eduardopruebas');
  });
  it('sin enlace => la recordada; sin nada => null', () => {
    expect(resolveAccessIdentity({ h: null, t: null, n: null }, remA)).toBe(remA);
    expect(resolveAccessIdentity({ h: null, t: null, n: null }, null)).toBeNull();
  });
  it('enlace incompleto no pisa la recordada', () => {
    expect(resolveAccessIdentity({ h: 'x', t: B, n: null }, remA)).toBe(remA);
  });
  it('enlace sin identidad recordada (incógnito) => la del enlace', () => {
    expect(resolveAccessIdentity(link, null)?.tenantId).toBe(B);
  });
  it('entrada rápida solo con la misma identidad', () => {
    expect(isSameIdentity(remA, { ...remA })).toBe(true);
    expect(isSameIdentity(remA, { ...remA, tenantId: B })).toBe(false);
    expect(isSameIdentity(remA, null)).toBe(false);
  });
});

describe('persistValidatedTenant', () => {
  it('guarda el negocio y limpia sessionStorage viejo', () => {
    session.setItem(ACTIVE_TENANT_KEY, A);
    persistValidatedTenant(B, local, session);
    expect(local.getItem(ACTIVE_TENANT_KEY)).toBe(B);
    expect(session.getItem(ACTIVE_TENANT_KEY)).toBeNull();
  });
});

describe('authStore real + negocio validado por el servidor', () => {
  it('1. una sola membership: comportamiento intacto', async () => {
    memberships = [mem(A)];
    persistValidatedTenant(A);
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
  });

  it('1b. una sola membership sin nada guardado: entra a ella', async () => {
    memberships = [mem(A)];
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
    expect(local.getItem(ACTIVE_TENANT_KEY)).toBe(A);
  });

  it('SIN el fix (sin persistir) cae en la primera membership: el bug original', async () => {
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
  });

  it('2/5. A y B, incógnito sin negocio guardado, enlace a B => B', async () => {
    persistValidatedTenant(B);
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(B);
  });

  it('3. localStorage contiene A, enlace a B => B', async () => {
    local.setItem(ACTIVE_TENANT_KEY, A);
    persistValidatedTenant(B);
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(B);
  });

  it('sessionStorage viejo con A no pisa a B', async () => {
    session.setItem(ACTIVE_TENANT_KEY, A);
    persistValidatedTenant(B);
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(B);
  });

  it('7. enlace a A sigue entrando a A', async () => {
    local.setItem(ACTIVE_TENANT_KEY, B);
    persistValidatedTenant(A);
    await signIn();
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
  });

  it('9. recarga después del login en B permanece en B', async () => {
    persistValidatedTenant(B);
    await signIn();
    useAuthStore.setState({ activeMembership: null, isAuthenticated: false });
    await signIn(); // recarga: mismo storage, sin volver a persistir
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(B);
  });

  it('10. el activeMembership de B es el que usa la vista de conversaciones', async () => {
    persistValidatedTenant(B);
    await signIn();
    const active = useAuthStore.getState().activeMembership;
    expect(active?.tenantId).toBe(B);
    // ConversationsPageView suscribe el inbox con activeMembership.tenantId:
    // ConversationService no necesita cambios.
    const src = fuentes['/src/modules/conversations/ConversationsPageView.tsx'];
    expect(src).toContain('subscribeInbox(activeMembership.tenantId)');
  });
});

describe('ensureActiveTenant — sesión previa del mismo uid / no autorizado', () => {
  it('6. quickEnter de B con sesión viva en A => cambia a B', async () => {
    await signIn(); // sin persistir: queda en A
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
    persistValidatedTenant(B);
    expect(await ensureActiveTenant(B, useAuthStore)).toBe(true);
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(B);
  });

  it('ya en el negocio correcto => no hace nada', async () => {
    persistValidatedTenant(B);
    await signIn();
    const spy = vi.spyOn(useAuthStore.getState(), 'setActiveTenant');
    expect(await ensureActiveTenant(B, useAuthStore)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('8. negocio inexistente o sin membership => falso y no cambia de negocio', async () => {
    await signIn();
    expect(await ensureActiveTenant('t-inexistente', useAuthStore)).toBe(false);
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
  });

  it('8b. usuario con membership solo en A no puede quedar en B', async () => {
    memberships = [mem(A)];
    await signIn();
    expect(await ensureActiveTenant(B, useAuthStore)).toBe(false);
    expect(useAuthStore.getState().activeMembership?.tenantId).toBe(A);
  });
});
