import { Message } from '@/types';

export type WhatsappWindowStatus = 'active' | 'expiring' | 'expired';

export interface WhatsappWindowInfo {
  status: WhatsappWindowStatus;
  expiresAt: Date | null;
  timeRemaining: number | null; // ms
  lastInboundAt: Date | null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPIRING_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Calcula el estado de la ventana de 24h de WhatsApp
 * basado en el último mensaje ENTRANTE del cliente.
 */
export function getWhatsappWindowStatus(messages: Message[]): WhatsappWindowInfo {
  // Find the most recent inbound message from the lead
  const lastInbound = [...messages]
    .reverse()
    .find(m => m.sender === 'lead' || m.direction === 'inbound');

  if (!lastInbound || !lastInbound.timestamp) {
    return { status: 'expired', expiresAt: null, timeRemaining: null, lastInboundAt: null };
  }

  const lastInboundAt = new Date(lastInbound.timestamp);
  const expiresAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const timeRemaining = expiresAt.getTime() - Date.now();

  let status: WhatsappWindowStatus;
  if (timeRemaining <= 0) {
    status = 'expired';
  } else if (timeRemaining <= EXPIRING_THRESHOLD_MS) {
    status = 'expiring';
  } else {
    status = 'active';
  }

  return {
    status,
    expiresAt,
    timeRemaining: Math.max(0, timeRemaining),
    lastInboundAt,
  };
}

/**
 * Calcula el estado de la ventana de 24h a partir de
 * lastInboundDate (campo de nivel raíz de Conversation).
 * Más eficiente para badges en lista — no requiere cargar los mensajes.
 */
export function getWindowStatusFromDate(lastInboundDate?: string | null): WhatsappWindowInfo {
  if (!lastInboundDate) {
    return { status: 'expired', expiresAt: null, timeRemaining: null, lastInboundAt: null };
  }

  const lastInboundAt = new Date(lastInboundDate);
  const expiresAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const timeRemaining = expiresAt.getTime() - Date.now();

  let status: WhatsappWindowStatus;
  if (timeRemaining <= 0) {
    status = 'expired';
  } else if (timeRemaining <= EXPIRING_THRESHOLD_MS) {
    status = 'expiring';
  } else {
    status = 'active';
  }

  return {
    status,
    expiresAt,
    timeRemaining: Math.max(0, timeRemaining),
    lastInboundAt,
  };
}

/**
 * Formatea el tiempo restante de la ventana en formato "18h 25m" o "45m"
 */
export function formatWindowCountdown(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}
