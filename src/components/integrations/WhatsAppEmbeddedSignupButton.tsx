import { useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { useWhatsAppEmbeddedSignup, EmbeddedSignupConnectedInfo } from '@/hooks/useWhatsAppEmbeddedSignup';

interface WhatsAppEmbeddedSignupButtonProps {
  tenantId: string;
  connectionType?: 'api' | 'coexistent';
  label?: string;
  className?: string;
  /** 'default' para tarjetas/paneles; 'compact' para filas de tabla angostas (Super Admin). */
  size?: 'default' | 'compact';
  /** Oculta el párrafo de detalle (número conectado / error) — útil cuando ese detalle ya se muestra en otro lado (p. ej. la columna de la tabla). */
  hideDetails?: boolean;
  onConnected?: (info: EmbeddedSignupConnectedInfo) => void;
}

/**
 * Botón reutilizable de Embedded Signup (Fase 3 del LOOP maestro). Envuelve
 * useWhatsAppEmbeddedSignup con una UI mínima y autocontenida (botón + estado
 * inline) para poder colocarse en cualquier punto de entrada futuro (Super
 * Admin por tenant, tarjeta de /integraciones, onboarding de landing — Fase 4)
 * sin reimplementar el flujo ni la lógica de estados.
 */
export const WhatsAppEmbeddedSignupButton = ({
  tenantId,
  connectionType = 'api',
  label = 'Conectar WhatsApp',
  className = '',
  size = 'default',
  hideDetails = false,
  onConnected,
}: WhatsAppEmbeddedSignupButtonProps) => {
  const { status, errorMessage, connectedInfo, start, reset } = useWhatsAppEmbeddedSignup(tenantId);
  const notifiedRef = useRef(false);

  const isRunning = status === 'loading-sdk' || status === 'waiting-popup' || status === 'saving';

  const handleClick = () => {
    if (status === 'success' || status === 'error') {
      notifiedRef.current = false;
      reset();
      return;
    }
    start(connectionType);
  };

  useEffect(() => {
    if (status === 'success' && connectedInfo && onConnected && !notifiedRef.current) {
      notifiedRef.current = true;
      onConnected(connectedInfo);
    }
  }, [status, connectedInfo, onConnected]);

  const buttonSizeClasses = size === 'compact' ? 'px-3 py-2 text-[9px] rounded-xl' : 'px-5 py-3 text-xs rounded-2xl';

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isRunning}
        className={`inline-flex items-center gap-1.5 bg-[#1877F2] text-white font-black uppercase tracking-widest shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:grayscale ${buttonSizeClasses}`}
      >
        {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {status === 'success' && <CheckCircle2 className="w-3.5 h-3.5" />}
        {status === 'error' && <AlertCircle className="w-3.5 h-3.5" />}
        {status === 'idle' && <Zap className="w-3.5 h-3.5" />}
        {status === 'idle' && label}
        {status === 'loading-sdk' && 'Cargando…'}
        {status === 'waiting-popup' && 'Esperando…'}
        {status === 'saving' && 'Guardando…'}
        {status === 'success' && 'Conectado'}
        {status === 'error' && 'Reintentar'}
      </button>
      {!hideDetails && status === 'success' && connectedInfo?.displayPhoneNumber && (
        <p className="text-xs font-medium text-emerald-600 mt-2">
          Número conectado: {connectedInfo.displayPhoneNumber}
          {connectedInfo.verifiedName ? ` (${connectedInfo.verifiedName})` : ''}
        </p>
      )}
      {!hideDetails && status === 'error' && errorMessage && (
        <p className="text-xs font-medium text-red-600 mt-2">{errorMessage}</p>
      )}
    </div>
  );
};
