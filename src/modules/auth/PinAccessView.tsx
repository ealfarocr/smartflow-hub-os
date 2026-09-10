import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { AuthService } from '@/services/AuthService';
import {
  getOrCreateDeviceId,
  getRememberedVendorIdentity,
  rememberVendorIdentity,
  forgetDeviceAndIdentity,
  type VendorIdentity,
} from '@/utils/deviceTrust';
import { Loader2, Delete, ArrowLeft, UserRound } from 'lucide-react';

// Acceso del equipo — PIN corto en lugar de email/contraseña, NUNCA a Firebase
// Auth directo (ver LOOP Fase 1-4/13). Dos modos:
//
//  - Dispositivo reconocido: la identidad ("quién sos") quedó recordada en
//    ESTE navegador tras el primer acceso. Solo se pide el PIN.
//  - Dispositivo nuevo: se pide usuario + PIN. Antes esta pantalla solo
//    funcionaba con el enlace de alta (?h=&t=&n=) y sin él mostraba "Este
//    enlace no es válido" — o sea que un vendedor que cerraba sesión y perdía
//    el mensaje de WhatsApp se quedaba sin forma de volver a entrar. El
//    enlace sigue sirviendo para el alta y para compartir el acceso, pero ya
//    no es la única puerta.
//
// El PIN es obligatorio en cada visita: el dispositivo reconocido evita
// reescribir quién sos, no evita autenticarse. Y nunca se le pide al vendedor
// un tenantId ni ningún otro dato técnico: cuando no se conoce el negocio, el
// backend lo resuelve internamente desde el usuario (ver loginWithPin).
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

  const handleDigit = (d: string) => {
    if (pin.length >= 6) return;
    setError('');
    setPin(pin + d);
  };
  const handleBackspace = () => setPin(pin.slice(0, -1));

  const switchUser = () => {
    // Borra identidad Y deviceId: si solo se borrara la identidad, el próximo
    // enrolamiento reusaría el mismo deviceId y la persona nueva heredaría la
    // "confianza" de la anterior (ver Fase 11).
    forgetDeviceAndIdentity();
    setIdentity(null);
    setHandleInput('');
    setPin('');
    setError('');
  };

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
      // tenantId solo se manda cuando ya se conoce (enlace de alta o
      // dispositivo reconocido). Sin él, el backend resuelve el negocio a
      // partir del usuario; el vendedor nunca tiene que saberlo.
      const result = await loginWithPin({
        ...(identity?.tenantId ? { tenantId: identity.tenantId } : {}),
        loginHandle,
        pin,
      });

      await signInWithCustomToken(auth, result.data.customToken);
      await AuthService.linkPendingMembership();

      const confirmed: VendorIdentity = {
        tenantId: result.data.tenantId,
        loginHandle: result.data.loginHandle,
        displayName: identity?.displayName || result.data.displayName,
      };

      // El registro del dispositivo NO decide si la persona entra: ya está
      // autenticada. Si su equipo fue revocado por un Admin (o el id quedó
      // tomado por otra persona), se pide una vinculación nueva de forma
      // transparente — un deviceId nuevo — en vez de dejarla afuera.
      const registerDevice = httpsCallable(functions, 'registerDevice');
      const registerWithCurrentDevice = () => registerDevice({
        deviceId: getOrCreateDeviceId(),
        tenantId: confirmed.tenantId,
        label: `Teléfono de ${confirmed.displayName}`,
      });
      try {
        await registerWithCurrentDevice();
      } catch {
        forgetDeviceAndIdentity();
        try {
          await registerWithCurrentDevice();
        } catch {
          // Sin dispositivo de confianza se sigue operando igual; es
          // telemetría/confianza, no la puerta de acceso.
        }
      }

      rememberVendorIdentity(confirmed);
      navigate('/mi-turno', { replace: true });
    } catch (err: unknown) {
      setPin('');
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      if (code === 'functions/resource-exhausted') {
        setError('Demasiados intentos. Probá de nuevo en unos minutos.');
      } else if (code === 'functions/permission-denied') {
        // Mismo texto exacto para "usuario no existe" y "PIN incorrecto" —
        // checkpoint de seguridad: nunca revelar cuál de las dos pasó.
        setError('Usuario o PIN incorrecto.');
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

  useEffect(() => {
    if (isAuthenticated && user && memberships.length > 0) navigate('/mi-turno', { replace: true });
  }, [isAuthenticated, user, memberships.length, navigate]);

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
          <h1 className="text-white text-2xl font-black mb-2 text-center">Entrar con PIN</h1>
          <p className="text-slate-400 text-sm mb-8 text-center max-w-xs">
            Escribí tu usuario y tu PIN. Te los dio tu jefe o encargado.
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

      {pinDots}

      {error && <p className="text-red-400 text-sm font-bold mb-6 text-center max-w-xs">{error}</p>}
      {isProcessing && <Loader2 className="w-6 h-6 text-white animate-spin mb-6" />}

      {keypad}

      <div className="mt-10 flex flex-col items-center gap-4">
        {identity ? (
          <button
            type="button"
            onClick={switchUser}
            disabled={isProcessing}
            className="text-slate-400 hover:text-white text-sm font-bold transition-colors disabled:opacity-40"
          >
            Cambiar de usuario
          </button>
        ) : null}
        <Link to="/login" className="text-slate-500 hover:text-slate-300 text-sm font-bold inline-flex items-center gap-1.5 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Link>
      </div>
    </div>
  );
};
