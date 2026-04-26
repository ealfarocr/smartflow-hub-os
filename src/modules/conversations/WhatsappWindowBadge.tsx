import { useWindowStatusFromDate } from '@/hooks/useWhatsappWindow';

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
        inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full
        ${badgeColor}
        ${isExpiring ? 'animate-pulse' : ''}
        whitespace-nowrap
      `}
    >
      {status === 'active'   && <span className="mr-1">●</span>}
      {status === 'expiring' && <span className="mr-1">⚠</span>}
      {status === 'expired'  && <span className="mr-1">✕</span>}
      {statusLabel}
    </span>
  );
};
