import { useEffect, useRef, useState } from 'react';
import { Message } from '@/types';
import {
  WhatsappWindowInfo,
  WhatsappWindowStatus,
  formatWindowCountdown,
  getWhatsappWindowStatus,
  getWindowStatusFromDate,
} from '@/utils/whatsappWindow';

export interface UseWhatsappWindowResult extends WhatsappWindowInfo {
  countdown: string; // formatted "18h 25m"
}

/**
 * Hook reactivo que calcula el estado de la ventana de 24h de WhatsApp
 * a partir de los mensajes activos. Se refresca cada 60 segundos.
 */
export function useWhatsappWindow(messages: Message[]): UseWhatsappWindowResult {
  const [info, setInfo] = useState<WhatsappWindowInfo>(() => getWhatsappWindowStatus(messages));
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    // Recalculate immediately when messages change
    setInfo(getWhatsappWindowStatus(messagesRef.current));

    // Then refresh every 60 seconds to update the countdown
    const interval = setInterval(() => {
      setInfo(getWhatsappWindowStatus(messagesRef.current));
    }, 60_000);

    return () => clearInterval(interval);
  }, [messages]);

  const countdown = info.timeRemaining != null ? formatWindowCountdown(info.timeRemaining) : '';

  return { ...info, countdown };
}

/**
 * Versión ligera para badges en lista: usa lastInboundDate del documento Conversation.
 * Se refresca cada 60 segundos sin necesidad de cargar los mensajes.
 */
export function useWindowStatusFromDate(lastInboundDate?: string | null): UseWhatsappWindowResult & { statusLabel: string; badgeColor: string } {
  const [info, setInfo] = useState<WhatsappWindowInfo>(() => getWindowStatusFromDate(lastInboundDate));

  useEffect(() => {
    setInfo(getWindowStatusFromDate(lastInboundDate));
    const interval = setInterval(() => {
      setInfo(getWindowStatusFromDate(lastInboundDate));
    }, 60_000);
    return () => clearInterval(interval);
  }, [lastInboundDate]);

  const countdown = info.timeRemaining != null ? formatWindowCountdown(info.timeRemaining) : '';

  const statusLabel = getStatusLabel(info.status, countdown);
  const badgeColor = getBadgeColor(info.status);

  return { ...info, countdown, statusLabel, badgeColor };
}

function getStatusLabel(status: WhatsappWindowStatus, countdown: string): string {
  switch (status) {
    case 'active':    return countdown ? `24h activa · ${countdown}` : '24h activa';
    case 'expiring':  return countdown ? `vence pronto · ${countdown}` : 'vence pronto';
    case 'expired':   return 'vencida';
  }
}

function getBadgeColor(status: WhatsappWindowStatus): string {
  switch (status) {
    case 'active':   return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'expiring': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    case 'expired':  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  }
}
