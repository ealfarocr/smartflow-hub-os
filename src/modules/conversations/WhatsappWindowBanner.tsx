import { AlertTriangle, XCircle, Info, MessageSquare } from 'lucide-react';
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
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-500/20 shadow-sm animate-in fade-in duration-500">
        <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 fill-current" />
        <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap uppercase tracking-wider">
          Chat Libre · <span className="font-bold">{countdown}</span>
        </span>
      </div>
    );
  }

  if (status === 'expiring') {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400/20 animate-pulse shadow-sm">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 fill-current" />
        <span className="text-[11px] font-black text-amber-700 dark:text-amber-400 whitespace-nowrap uppercase tracking-wider">
          Cierra en: <span className="font-bold">{countdown}</span>
        </span>
      </div>
    );
  }

  // expired
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-red-50 dark:bg-red-900/20 border-2 border-red-500/20 shadow-sm">
      <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 fill-current" />
      <span className="text-[11px] font-black text-red-700 dark:text-red-400 whitespace-nowrap uppercase tracking-wider">
        Ventana Vencida · Reactivar Chat
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
    <div className="flex items-center gap-1.5 mb-2 px-2">
      <Info className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {status === 'active'
          ? 'La ventana está abierta. Puedes enviar mensajes, imágenes y archivos sin restricciones.'
          : '¡Atención! La ventana de conversación vence pronto. Responde ahora para mantener el chat activo.'}
      </p>
    </div>
  );
};
