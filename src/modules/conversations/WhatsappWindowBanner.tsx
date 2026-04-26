import { Clock, AlertTriangle, XCircle, Info } from 'lucide-react';
import { UseWhatsappWindowResult } from '@/hooks/useWhatsappWindow';

interface WhatsappWindowBannerProps {
  windowInfo: UseWhatsappWindowResult;
}

/**
 * Banner en el header del chat activo que muestra el estado de la ventana 24h
 * con color semántico y countdown en tiempo real.
 */
export const WhatsappWindowBanner = ({ windowInfo }: WhatsappWindowBannerProps) => {
  const { status, countdown } = windowInfo;

  if (status === 'active') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40">
        <Clock className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
          Ventana WhatsApp activa · quedan <strong>{countdown}</strong>
        </span>
      </div>
    );
  }

  if (status === 'expiring') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700/40 animate-pulse">
        <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
          Atención: quedan <strong>{countdown}</strong>
        </span>
      </div>
    );
  }

  // expired
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40">
      <XCircle className="w-3 h-3 text-red-600 dark:text-red-400 shrink-0" />
      <span className="text-[11px] font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        Ventana vencida · usar plantilla aprobada
      </span>
    </div>
  );
};

/**
 * Helper contextual debajo del input cuando la ventana está activa.
 */
export const WhatsappWindowHint = ({ status }: { status: 'active' | 'expiring' | 'expired' }) => {
  if (status === 'expired') return null;

  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Info className="w-3 h-3 text-slate-400 shrink-0" />
      <p className="text-[11px] text-slate-400">
        {status === 'active'
          ? 'Puedes responder con mensaje libre dentro de la ventana de 24 horas.'
          : 'La ventana vence pronto. Responde ahora o prepara una plantilla.'}
      </p>
    </div>
  );
};
