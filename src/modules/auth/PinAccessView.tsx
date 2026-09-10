import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { auth } from '@/lib/firebase';
import { useAuthStore, waitForSessionReady } from '@/stores/authStore';
import { AuthService } from '@/services/AuthService';
import {
  getOrCreateDeviceId,
  getRememberedVendorIdentity,
  rememberVendorIdentity,
  forgetDeviceAndIdentity,
  getDeviceSecret,
  rememberDeviceSecret,
  forgetDeviceSecret,
  type VendorIdentity,
} from '@/utils/deviceTrust';
import { playAccessFeedback } from '@/utils/accessSound';
import { HoldToEnterButton } from './HoldToEnterButton';
import { Loader2, Delete, ArrowLeft, UserRound } from 'lucide-react';

// Acceso del equipo. Tres situaciones, de la más cómoda a la más exigente:
//
//  1. ENTRADA RÁPIDA — la sesión sigue viva en este equipo y la persona ya
//     entró antes: "Hola <nombre>" y mantener presionado el botón medio segundo.
//     El gesto NO autentica: la credencial real es el refresh token de Firebase
//     que ya tiene este navegador. Antes de dejar pasar se revalida contra el
//     servidor (verifyDeviceSession) que la persona siga activa y que el equipo
//     siga reconocido y no revocado.
//  2. CÓDIGO DE ACCESO en equipo reconocido — no hay sesión viva: se pide solo
//     el código, sin volver a preguntar quién es.
//  3. EQUIPO NUEVO — usuario + código.
//
// El deviceId NUNCA cuenta como factor de autenticación: lo genera el propio
// cliente y vive en localStorage, así que no es un secreto. Y el código nunca
// se guarda: solo existe mientras se tipea.
const KEYPAD_LOCK_MS = 800;
const lockKeypad = (until: { current: number }) => { until.current = Date.now() + KEYPAD_LOCK_MS; };
const isKeypadLocked = (until: { current: number }) => Date.now() < until.current;

export const PinAccessView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, user, memberships } = useAuthStore();

  // Lazy initializer (no useEffect): la identidad recordada o el enlace de
  // alta (?h=&t=&n=) son datos disponibles de entrada, no algo que llegue de
  // forma asíncrona — no hace falta sincronizar nada externo acá.
  const [identity, setIdentity] = useState<VendorIdentity | null>(() => {
    const remembered = getRememberedVendorIdentity();
    if (remembered) return remembered;
    const h = searchParams.get('h');
    const t = searchParams.get('t');
    const n = searchParams.get('n');
    if (h && t && n) return { loginHandle: h, tenantId: t, displayName: decodeURIComponent(n) };
    return null;
  });
  const [handleInput, setHandleInput] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // El usuario puede pedir el código a mano aunque tenga entrada rápida
  // disponible, y algunos rechazos lo fuerzan (equipo revocado, por ejemplo).
  const [forceCode, setForceCode] = useState(false);

  const hasLiveSession = isAuthenticated && !!user && memberships.length > 0;
  // Entrada rapida disponible si hay a quien saludar y una forma de entrar sin
  // codigo: la sesion viva de Firebase, o la credencial de dispositivo que el
  // servidor emitio al vincularse (lo que permite volver despues de cerrar sesion).
  const [hasDeviceSecret] = useState(() => !!getDeviceSecret());
  const quickEntryAvailable = !!identity && !forceCode && (hasLiveSession || hasDeviceSecret);

  // Si la entrada rápida falla, el teclado aparece justo debajo del dedo que
  // mantenía el botón: al soltar, ese toque caía en un dígito, lo escribía solo
  // y borraba el mensaje que explicaba qué pasó (reproducido en el QA local).
  // Durante un instante después del cambio de pantalla el teclado no escucha.
  const keypadLockedUntil = useRef(0);
  const showCodeAfterQuickEntry = (message: string) => {
    lockKeypad(keypadLockedUntil);
    setError(message);
    setForceCode(true);
  };

  const handleDigit = (d: string) => {
    if (isKeypadLocked(keypadLockedUntil)) return;
    if (pin.length >= 6) return;
    setError('');
    setPin(pin + d);
  };
  const handleBackspace = () => setPin(pin.slice(0, -1));

  const switchUser = async () => {
    // Borra identidad Y deviceId: si solo borrara la identidad, el próximo
    // enrolamiento reusaría el mismo deviceId y la persona siguiente heredaría
    // la "confianza" del equipo anterior (ver Fase 11). Y se cierra la sesión
    // abierta: nadie debe heredar la sesión de quien usaba antes el teléfono.
    forgetDeviceAndIdentity();
    if (hasLiveSession) { try { await signOut(auth); } catch { /* igual seguimos */ } }
    setIdentity(null);
    setForceCode(false);
    setHandleInput('');
    setPin('');
    setError('');
  };

  // ENTRADA RÁPIDA: la sesión ya está abierta, así que acá no se autentica
  // nada nuevo — se revalida en el servidor y se entra.
  const quickEnter = useCallback(async () => {
    if (!identity || isProcessing) return;
    setIsProcessing(true);
    setError('');
    try {
      if (!hasLiveSession) {
        // REENTRADA SIN CODIGO: la sesion de Firebase se cerro, pero este equipo
        // tiene la credencial que emitio el servidor al vincularse. El servidor
        // revalida todo (equipo no revocado, credencial vigente, persona activa).
        const secret = getDeviceSecret();
        if (!secret) { setForceCode(true); return; }
        const loginWithDevice = httpsCallable<
          { deviceId: string; deviceSecret: string; tenantId: string },
          { customToken: string; displayName: string }
        >(getFunctions(), 'loginWithDevice');
        const res = await loginWithDevice({ deviceId: getOrCreateDeviceId(), deviceSecret: secret, tenantId: identity.tenantId });
        const cred = await signInWithCustomToken(auth, res.data.customToken);
        await AuthService.linkPendingMembership();
        playAccessFeedback();
        await waitForSessionReady(cred.user.uid);
        navigate('/', { replace: true });
        return;
      }

      const verifyDeviceSession = httpsCallable<
        { tenantId: string; deviceId: string },
        { allowed: boolean; reason?: string; fallback?: 'require-code' | 'sign-out'; displayName?: string }
      >(getFunctions(), 'verifyDeviceSession');
      const res = await verifyDeviceSession({ tenantId: identity.tenantId, deviceId: getOrCreateDeviceId() });

      if (!res.data.allowed) {
        if (res.data.fallback === 'sign-out') {
          // Ya no está habilitada en el negocio: no alcanza con pedirle el
          // código, hay que cerrarle la sesión.
          try { await signOut(auth); } catch { /* igual seguimos */ }
          showCodeAfterQuickEntry('Tu acceso fue desactivado. Hablá con tu jefe o encargado.');
        } else {
          showCodeAfterQuickEntry('Este equipo ya no está reconocido. Entrá con tu código de acceso.');
        }
        return;
      }

      playAccessFeedback();
      navigate('/', { replace: true });
    } catch {
      // Equipo revocado, codigo regenerado o persona desactivada: la credencial
      // ya no sirve. Se descarta (asi no se reintenta en cada apertura) y se pide
      // el codigo, que es exactamente para lo que existe: la recuperacion.
      if (!hasLiveSession) forgetDeviceSecret();
      showCodeAfterQuickEntry('No se pudo entrar con este equipo. Usá tu código de acceso.');
    } finally {
      setIsProcessing(false);
    }
  }, [identity, isProcessing, navigate, hasLiveSession]);

  const submit = useCallback(async () => {
    const loginHandle = identity?.loginHandle ?? handleInput.trim();
    if (!loginHandle || pin.length !== 6 || isProcessing) return;
    setIsProcessing(true);
    setError('');

    try {
      const functions = getFunctions();
      const loginWithPin = httpsCallable<
        { tenantId?: string; loginHandle: string; pin: string },
        { customToken: string; tenantId: string; loginHandle: string; displayName: string }
      >(functions, 'loginWithPin');
      // tenantId solo se manda cuando ya se conoce (enlace de alta o equipo
      // reconocido). Sin él, el backend resuelve el negocio a partir del
      // usuario; el vendedor nunca tiene que saberlo.
      const result = await loginWithPin({
        ...(identity?.tenantId ? { tenantId: identity.tenantId } : {}),
        loginHandle,
        pin,
      });

      const cred = await signInWithCustomToken(auth, result.data.customToken);
      await AuthService.linkPendingMembership();

      const confirmed: VendorIdentity = {
        tenantId: result.data.tenantId,
        loginHandle: result.data.loginHandle,
        displayName: identity?.displayName || result.data.displayName,
      };

      // El registro del equipo NO decide si la persona entra: ya está
      // autenticada. Si su equipo fue revocado por un Admin (o el id quedó
      // tomado por otra persona), se pide una vinculación nueva de forma
      // transparente — un deviceId nuevo — en vez de dejarla afuera.
      const registerDevice = httpsCallable<
        { deviceId: string; tenantId: string; label: string },
        { deviceId: string; status: string; deviceSecret?: string }
      >(functions, 'registerDevice');
      const registerWithCurrentDevice = async () => {
        const r = await registerDevice({
          deviceId: getOrCreateDeviceId(),
          tenantId: confirmed.tenantId,
          label: `Teléfono de ${confirmed.displayName}`,
        });
        // La credencial de dispositivo llega UNA sola vez, en este momento: es lo
        // que va a permitir volver a entrar sin el codigo despues de cerrar sesion.
        if (r.data.deviceSecret) rememberDeviceSecret(r.data.deviceSecret);
      };
      try {
        await registerWithCurrentDevice();
      } catch {
        forgetDeviceAndIdentity();
        try {
          await registerWithCurrentDevice();
        } catch {
          // Sin equipo de confianza se sigue operando igual; es
          // telemetría/confianza, no la puerta de acceso.
        }
      }

      rememberVendorIdentity(confirmed);
      playAccessFeedback();
      await waitForSessionReady(cred.user.uid);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setPin('');
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      if (code === 'functions/resource-exhausted') {
        setError('Demasiados intentos. Probá de nuevo en unos minutos.');
      } else if (code === 'functions/permission-denied') {
        // Mismo texto exacto para "usuario no existe" y "código incorrecto" —
        // checkpoint de seguridad: nunca revelar cuál de las dos pasó.
        setError('Usuario o código incorrecto.');
      } else {
        setError('No se pudo iniciar sesión. Intentá de nuevo.');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [identity, handleInput, pin, isProcessing, navigate]);

  useEffect(() => {
    if (pin.length === 6) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // Con sesión viva pero SIN identidad recordada no hay a quién saludar (es el
  // caso de alguien corporativo que llegó acá de rebote): se lo manda adentro.
  useEffect(() => {
    if (hasLiveSession && !identity) navigate('/', { replace: true });
  }, [hasLiveSession, identity, navigate]);

  const keypadDisabled = isProcessing || (!identity && !handleInput.trim());

  const keypad = (
    <div className="grid grid-cols-3 gap-4 max-w-xs w-full">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button
          key={d}
          type="button"
          disabled={keypadDisabled}
          onClick={() => handleDigit(d)}
          className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white text-2xl font-black transition-all disabled:opacity-40"
        >
          {d}
        </button>
      ))}
      <div />
      <button
        type="button"
        disabled={keypadDisabled}
        onClick={() => handleDigit('0')}
        className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white text-2xl font-black transition-all disabled:opacity-40"
      >
        0
      </button>
      <button
        type="button"
        disabled={keypadDisabled}
        onClick={handleBackspace}
        className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white flex items-center justify-center transition-all disabled:opacity-40"
      >
        <Delete className="w-6 h-6" />
      </button>
    </div>
  );

  const pinDots = (
    <div className="flex gap-3 mb-8">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`w-10 h-12 rounded-xl border-2 flex items-center justify-center text-2xl font-black text-white transition-colors ${
            i < pin.length ? 'bg-slate-800 border-[#1877F2]' : 'bg-slate-900 border-slate-800'
          }`}
        >
          {i < pin.length ? '•' : ''}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      {identity ? (
        <>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-1">Hola</p>
          <h1 className="text-white text-3xl font-black mb-10 text-center">{identity.displayName}</h1>
        </>
      ) : (
        <>
          <h1 className="text-white text-2xl font-black mb-2 text-center">Entrar con código</h1>
          <p className="text-slate-400 text-sm mb-8 text-center max-w-xs">
            Escribí tu usuario y tu código de acceso. Te los dio tu jefe o encargado.
          </p>
          <div className="w-full max-w-xs mb-8">
            <label htmlFor="loginHandle" className="block text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">
              Usuario
            </label>
            <div className="relative">
              <UserRound className="w-5 h-5 text-slate-500 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                id="loginHandle"
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                value={handleInput}
                onChange={(e) => { setHandleInput(e.target.value); setError(''); }}
                placeholder="tunombre"
                disabled={isProcessing}
                className="w-full h-14 pl-12 pr-4 rounded-2xl bg-slate-900 border-2 border-slate-800 focus:border-[#1877F2] outline-none text-white text-lg font-bold placeholder:text-slate-600 transition-colors disabled:opacity-40"
              />
            </div>
          </div>
        </>
      )}

      {quickEntryAvailable ? (
        <HoldToEnterButton onComplete={quickEnter} busy={isProcessing} />
      ) : (
        <>
          {pinDots}
          {isProcessing && <Loader2 className="w-6 h-6 text-white animate-spin mb-6" />}
          {keypad}
        </>
      )}

      {error && <p className="text-red-400 text-sm font-bold mt-6 text-center max-w-xs">{error}</p>}

      <div className="mt-10 flex flex-col items-center gap-4">
        {quickEntryAvailable && (
          <button
            type="button"
            onClick={() => { setForceCode(true); setError(''); }}
            className="text-slate-400 hover:text-white text-sm font-bold transition-colors"
          >
            Usar código de acceso
          </button>
        )}
        {identity && (
          <button
            type="button"
            onClick={switchUser}
            disabled={isProcessing}
            className="text-slate-400 hover:text-white text-sm font-bold transition-colors disabled:opacity-40"
          >
            Cambiar de usuario
          </button>
        )}
        <Link to="/login" className="text-slate-500 hover:text-slate-300 text-sm font-bold inline-flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Link>
      </div>
    </div>
  );
};
