import { useCallback, useEffect, useRef, useState } from 'react';
import { Power, Loader2 } from 'lucide-react';

export const HOLD_DURATION_MS = 1000;

interface HoldToEnterButtonProps {
  onComplete: () => void;
  disabled?: boolean;
  busy?: boolean;
}

/**
 * Botón de encendido: hay que MANTENERLO presionado 1 segundo para entrar.
 * El anillo de progreso muestra cuánto falta y se cancela si se suelta antes,
 * si el dedo se va del botón o si la pestaña pasa a segundo plano.
 *
 * El gesto no autentica nada por sí solo — es una confirmación de intención
 * sobre una sesión que YA está abierta (ver verifyDeviceSession en Functions,
 * que revalida contra el servidor antes de dejar entrar). Se eligió mantener
 * presionado en vez de un toque simple justamente para que no se dispare solo
 * con un roce al sacar el teléfono del bolsillo.
 */
export const HoldToEnterButton = ({ onComplete, disabled, busy }: HoldToEnterButtonProps) => {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const completedRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setHolding(false);
    if (!completedRef.current) setProgress(0);
  }, []);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const pct = Math.min(1, elapsed / HOLD_DURATION_MS);
    setProgress(pct);
    if (pct >= 1) {
      completedRef.current = true;
      stop();
      onComplete();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onComplete, stop]);

  const start = useCallback(() => {
    if (disabled || busy || completedRef.current) return;
    startRef.current = Date.now();
    setHolding(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, busy, tick]);

  // Si la pestaña se va a segundo plano, requestAnimationFrame se congela: sin
  // esto, el progreso quedaría "pausado" y podría completarse al volver sin que
  // nadie estuviera manteniendo el botón.
  useEffect(() => {
    const onHidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [stop]);

  const RADIUS = 74;
  const CIRC = 2 * Math.PI * RADIUS;

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div className="relative w-44 h-44">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 176 176" aria-hidden="true">
          <circle cx="88" cy="88" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-800" />
          <circle
            cx="88" cy="88" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
            className="text-[#1877F2]"
            style={{
              strokeDasharray: CIRC,
              strokeDashoffset: CIRC * (1 - progress),
              transition: holding ? 'none' : 'stroke-dashoffset 200ms ease-out',
            }}
          />
        </svg>
        <button
          type="button"
          disabled={disabled || busy}
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onPointerCancel={stop}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Mantené presionado para entrar"
          className={`absolute inset-4 rounded-full flex items-center justify-center transition-all disabled:opacity-40 touch-none ${
            holding ? 'bg-[#1877F2] scale-95' : 'bg-slate-900 hover:bg-slate-800 active:bg-slate-800'
          }`}
        >
          {busy
            ? <Loader2 className="w-14 h-14 text-white animate-spin" />
            : <Power className={`w-14 h-14 transition-colors ${holding ? 'text-white' : 'text-[#1877F2]'}`} />}
        </button>
      </div>
      <p className="text-slate-400 text-sm font-bold">
        {busy ? 'Entrando…' : holding ? 'Seguí presionando…' : 'Mantené presionado para entrar'}
      </p>
    </div>
  );
};
