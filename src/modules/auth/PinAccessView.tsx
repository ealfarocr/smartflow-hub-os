import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { auth } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { AuthService } from '@/services/AuthService';
import {
  getOrCreateDeviceId,
  getRememberedVendorIdentity,
  rememberVendorIdentity,
  type VendorIdentity,
} from '@/utils/deviceTrust';
import { Loader2, Delete } from 'lucide-react';

// Acceso simple para vendedores en dispositivo reconocido — reemplaza el
// paso de usuario/contraseña con un PIN corto, NUNCA a Firebase Auth (ver
// LOOP Fase 1-4/13). La identidad ("quién sos") se recuerda en este
// navegador tras el primer acceso exitoso (link de enrolamiento con
// ?h=&t=&n= generado por el Owner/Admin — h=loginHandle público, ej.
// "michelle", NUNCA un membershipId); el PIN sigue siendo obligatorio en
// cada visita — el dispositivo reconocido evita reescribir email/clave, no
// evita autenticarse de nuevo.
export const PinAccessView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, user, memberships } = useAuthStore();

  // Lazy initializer (no useEffect): la identidad recordada o el link de
  // enrolamiento (?h=&t=&n=) son datos disponibles de entrada, no algo que
  // llegue de forma asíncrona — no hace falta sincronizar nada externo acá.
  const [identity] = useState<VendorIdentity | null>(() => {
    const remembered = getRememberedVendorIdentity();
    if (remembered) return remembered;
    const h = searchParams.get('h');
    const t = searchParams.get('t');
    const n = searchParams.get('n');
    if (h && t && n) return { loginHandle: h, tenantId: t, displayName: decodeURIComponent(n) };
    return null;
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length >= 6) return;
    setError('');
    setPin(pin + d);
  };
  const handleBackspace = () => setPin(pin.slice(0, -1));

  const handleSubmit = async () => {
    if (!identity || pin.length !== 6 || isProcessing) return;
    setIsProcessing(true);
    setError('');

    try {
      const functions = getFunctions();
      const loginWithPin = httpsCallable<{ tenantId: string; loginHandle: string; pin: string }, { customToken: string }>(functions, 'loginWithPin');
      const result = await loginWithPin({ tenantId: identity.tenantId, loginHandle: identity.loginHandle, pin });

      await signInWithCustomToken(auth, result.data.customToken);
      await AuthService.linkPendingMembership();

      const registerDevice = httpsCallable(functions, 'registerDevice');
      await registerDevice({
        deviceId: getOrCreateDeviceId(),
        tenantId: identity.tenantId,
        label: `Teléfono de ${identity.displayName}`,
      });

      rememberVendorIdentity(identity);
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
  };

  useEffect(() => {
    if (pin.length === 6) handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  if (isAuthenticated && user && memberships.length > 0) {
    return <Navigate to="/mi-turno" replace />;
  }

  if (!identity) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-white font-black text-lg mb-2">Este enlace no es válido</p>
          <p className="text-slate-400 text-sm">Pedile a tu administrador que te comparta tu link de acceso.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6">
      <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mb-1">Hola</p>
      <h1 className="text-white text-3xl font-black mb-10">{identity.displayName}</h1>

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

      {error && <p className="text-red-400 text-sm font-bold mb-6 text-center max-w-xs">{error}</p>}
      {isProcessing && <Loader2 className="w-6 h-6 text-white animate-spin mb-6" />}

      <div className="grid grid-cols-3 gap-4 max-w-xs w-full">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            disabled={isProcessing}
            onClick={() => handleDigit(d)}
            className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white text-2xl font-black transition-all disabled:opacity-40"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleDigit('0')}
          className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white text-2xl font-black transition-all disabled:opacity-40"
        >
          0
        </button>
        <button
          type="button"
          disabled={isProcessing}
          onClick={handleBackspace}
          className="h-16 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white flex items-center justify-center transition-all disabled:opacity-40"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
