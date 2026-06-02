import { useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLeadStore } from '@/stores/leadStore';
import { useQuoteStore } from '@/stores/quoteStore';
import { useConversationStore } from '@/stores/conversationStore';
import { serverTimestamp } from 'firebase/firestore';

export interface OnboardingStep {
  id: string;
  title: string;
  message: string;
  buttonLabel: string;
  route: string;
  trigger: string;
}

export function useOnboarding() {
  const { activeMembership } = useAuthStore();
  const settings = useSettingsStore();
  const { leads } = useLeadStore();
  const { quotes } = useQuoteStore();
  const { conversations } = useConversationStore();

  const currentStep = useMemo(() => {
    if (!settings.onboarding || !settings.onboarding.registeredAt) return null;

    // Convert Firestore Timestamp to Date
    const regTimestamp = settings.onboarding.registeredAt;
    const registeredAt = regTimestamp.seconds 
      ? new Date(regTimestamp.seconds * 1000) 
      : new Date(regTimestamp);
    
    const daysSinceReg = Math.floor((Date.now() - registeredAt.getTime()) / (1000 * 60 * 60 * 24));
    
    const lastNotifTimestamp = settings.onboarding.lastNotificationDate;
    const lastNotif = lastNotifTimestamp 
      ? (lastNotifTimestamp.seconds ? new Date(lastNotifTimestamp.seconds * 1000) : new Date(lastNotifTimestamp))
      : null;
    
    const isSameDay = lastNotif && lastNotif.toDateString() === new Date().toDateString();
    
    // Regla de no invasión: Máximo 1 notificación por día
    if (isSameDay) return null;

    const dismissed = settings.onboarding.dismissedNotificationIds || [];

    // --- D1: Registro completado (Solo si tiene el módulo de WhatsApp activo pero no configurado) ---
    if (daysSinceReg >= 0 && settings.features?.hasMultiAgent && !settings.features?.hasIntegrations && !dismissed.includes('step-1')) {
      return {
        id: 'step-1',
        title: 'Tu CRM está listo',
        message: 'El siguiente paso es conectar tu WhatsApp para empezar a recibir leads aquí.',
        buttonLabel: 'Conectar WhatsApp',
        route: '/integraciones',
        trigger: 'primer login'
      };
    }

    // --- D2: Si no conectó WhatsApp (Solo si tiene el módulo activo) ---
    if (daysSinceReg >= 1 && settings.features?.hasMultiAgent && !settings.features?.hasIntegrations && !dismissed.includes('step-2')) {
      return {
        id: 'step-2',
        title: '¿Sabías que?',
        message: 'Los leads que llegan a tu WhatsApp se pierden si no los capturas. Centralízalos en tu CRM.',
        buttonLabel: 'Ver cómo funciona',
        route: '/integraciones',
        trigger: 'segundo login sin WA'
      };
    }

    // --- D3: Si activó WhatsApp: sugiere Agente IA ---
    const hasUnanswered = conversations.some(c => {
      if (c.lastMessageSender !== 'lead') return false;
      const lastDate = new Date(c.lastMessageDate).getTime();
      return (Date.now() - lastDate) > 2 * 60 * 60 * 1000;
    });

    if (daysSinceReg >= 2 && settings.features?.hasIntegrations && !settings.features?.hasAiAgent && hasUnanswered && !dismissed.includes('step-3')) {
      return {
        id: 'step-3',
        title: 'Tienes mensajes sin responder',
        message: 'El Agente IA los atiende automáticamente cuando no estás.',
        buttonLabel: 'Activar Agente IA',
        route: '/tienda',
        trigger: 'conversaciones sin respuesta'
      };
    }

    // --- D5: Sugiere Cotizaciones + Links de Pago ---
    const advancedLeadsWithoutQuote = leads.filter(l => 
      (l.stage === 'Seguimiento' || l.stage === 'Visita Técnica') && 
      !quotes.some(q => q.leadId === l.id)
    );

    if (daysSinceReg >= 4 && advancedLeadsWithoutQuote.length > 0 && (!settings.features?.hasQuotes || !settings.features?.hasPaymentLinks) && !dismissed.includes('step-5')) {
      return {
        id: 'step-5',
        title: 'Impulsa tus ventas',
        message: 'Este cliente está listo para una propuesta. Manda una cotización PDF y un link de pago directo al chat.',
        buttonLabel: 'Ir al Marketplace',
        route: '/tienda',
        trigger: 'lead avanzado sin cotización'
      };
    }

    // --- D7: Resumen semanal ---
    const recentConversations = conversations.filter(c => {
      const updatedDate = new Date(c.updatedAt).getTime();
      return (Date.now() - updatedDate) < 7 * 24 * 60 * 60 * 1000;
    });

    if (daysSinceReg >= 6 && recentConversations.length >= 5 && !settings.features?.hasQualityAuditor && !dismissed.includes('step-7')) {
      return {
        id: 'step-7',
        title: 'Resumen Semanal',
        message: `Esta semana has tenido ${recentConversations.length} conversaciones. ¿Quieres ver cómo tu equipo está cerrando?`,
        buttonLabel: 'Ver Auditor de Vendedores',
        route: '/tienda',
        trigger: 'resumen semanal'
      };
    }

    return null;
  }, [settings.onboarding, settings.features, leads, quotes, conversations]);

  const dismissStep = async (stepId: string) => {
    if (!activeMembership?.tenantId || !settings.onboarding) return;

    const newDismissed = [...(settings.onboarding.dismissedNotificationIds || []), stepId];
    await settings.updateSettings(activeMembership.tenantId, {
      onboarding: {
        ...settings.onboarding,
        dismissedNotificationIds: newDismissed,
        lastNotificationDate: serverTimestamp()
      }
    });
  };

  return { currentStep, dismissStep };
}
