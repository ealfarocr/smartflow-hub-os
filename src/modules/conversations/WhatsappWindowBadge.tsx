import { useWindowStatusFromDate } from '@/hooks/useWhatsappWindow';
import { MessageSquare, AlertTriangle, XCircle } from 'lucide-react';

interface WhatsappWindowBadgeProps {
  lastInboundDate?: string | null;
  compact?: boolean; // When true, just shows a colored dot
}

/**
 * Badge de estado de ventana WhatsApp 24h para la lista de conversaciones.
 * Usa lastInboundDate para calcular el estado sin cargar todos los mensajes.
 */
export const WhatsappWindowBadge = ({ lastInboundDate, compact = false }: WhatsappWindowBadgeProps) => {
  const { status, statusLabel, badgeColor } = useWindowStatusFromDate(lastInboundDate);

  if (compact) {
    const dotColor =
      status === 'active'   ? 'bg-emerald-500' :
      status === 'expiring' ? 'bg-amber-500 animate-pulse' :
                              'bg-red-500';
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${dotColor} shrink-0`}
        title={statusLabel}
      />
    );
  }

  const isExpiring = status === 'expiring';

  return (
    <span
      className={`
        inline-flex items-center text-[10px] font-black px-2 py-1 rounded-lg
        ${badgeColor}
        ${isExpiring ? 'animate-pulse' : ''}
        whitespace-nowrap uppercase tracking-tighter transition-all duration-300
      `}
    >
      {status === 'active'   && <MessageSquare className="w-3 h-3 mr-1.5 fill-current" />}
      {status === 'expiring' && <AlertTriangle className="w-3 h-3 mr-1.5 fill-current" />}
      {status === 'expired'  && <XCircle className="w-3 h-3 mr-1.5 fill-current" />}
      {statusLabel}
    </span>
  );
};
