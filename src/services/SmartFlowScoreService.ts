import { Lead, Conversation } from '@/types';

export interface ScoreBreakdown {
  total: number;
  speedScore: number;
  conversionScore: number;
  activityScore: number;
  paymentScore: number;
  suggestions: string[];
}

export const SmartFlowScoreService = {
  calculateScore(leads: Lead[], conversations: Conversation[]): ScoreBreakdown {
    // 1. VELOCIDAD DE RESPUESTA (40%)
    // Simulamos basado en unreadCount y tiempos de respuesta
    const totalConvs = conversations.length || 1;
    const unreadWeight = conversations.reduce((acc, c) => acc + (c.unreadCount > 0 ? 1 : 0), 0);
    const speedScore = Math.max(0, 100 - (unreadWeight / totalConvs) * 100);

    // 2. CONVERSIÓN/IMPULSO (30%)
    // Leads que no están en 'Nuevo'
    const totalLeads = leads.length || 1;
    const movedLeads = leads.filter(l => l.stage !== 'Nuevo').length;
    const conversionScore = (movedLeads / totalLeads) * 100;

    // 3. ACTIVIDAD (20%)
    // Leads con actividad en las últimas 24h
    const now = new Date().getTime();
    const activeLeads = leads.filter(l => {
      const lastAct = new Date(l.lastActivity).getTime();
      return (now - lastAct) < (24 * 60 * 60 * 1000);
    }).length;
    const activityScore = (activeLeads / totalLeads) * 100;

    // 4. PAGOS (10%)
    // Simulación: si hay leads en cierre sin links de pago (dummy logic for now)
    const paymentScore = 85; // Placeholder hasta tener real payment links tracking

    // CÁLCULO PONDERADO
    const total = Math.round(
      (speedScore * 0.40) + 
      (conversionScore * 0.30) + 
      (activityScore * 0.20) + 
      (paymentScore * 0.10)
    );

    // GENERAR SUGERENCIAS ACCIONABLES
    const suggestions: string[] = [];
    if (speedScore < 80) suggestions.push(`Tienes ${unreadWeight} mensajes esperando respuesta. ¡Dales amor! ☕`);
    if (conversionScore < 50) suggestions.push('Mueve tus leads nuevos a "Seguimiento" para subir tu score.');
    if (activityScore < 50) suggestions.push('Hay leads enfriándose. ¿Hacemos un follow-up hoy?');
    if (total > 90) suggestions.push('¡Nivel Maestro! Tu negocio está volando hoy. 🚀');

    return {
      total,
      speedScore,
      conversionScore,
      activityScore,
      paymentScore,
      suggestions
    };
  }
};
