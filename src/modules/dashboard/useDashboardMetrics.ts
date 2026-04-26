import { useMemo } from 'react';
import { Lead, Quote, AgendaItem, Conversation } from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';

// ── Types ──────────────────────────────────────────────
export type PeriodKey = 'today' | '7d' | '30d' | 'this_month' | 'last_month';

export interface DashboardActivity {
  id: string;
  type: 'lead_new' | 'quote_created' | 'quote_sent' | 'deal_closed' | 'deal_lost' | 'visit_scheduled' | 'message_received';
  title: string;
  subtitle: string;
  date: Date;
  icon: string; // emoji
  color: string;
  link?: string;
}

export interface DashboardMetrics {
  newLeads: number;
  newLeadsPrev: number;
  quotesSent: number;
  quotesSentPrev: number;
  closedDeals: number;
  closedDealsPrev: number;
  potentialAmount: number;
  potentialAmountPrev: number;
  totalLeads: number;
  conversionRate: number;
  averageTicket: number;
  pendingActivities: number;
  upcomingVisits: number;
  leadsByStage: Array<{ stage: string; count: number; color: string }>;
  quotesByStatus: Array<{ status: string; count: number; color: string }>;
  activityByDay: Array<{ date: string; label: string; leads: number; quotes: number }>;
  recentActivity: DashboardActivity[];
}

// ── Helpers ────────────────────────────────────────────

function getPeriodRange(period: PeriodKey): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let from: Date;

  switch (period) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;
    case '7d':
      from = new Date(to);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      break;
    case '30d':
      from = new Date(to);
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      break;
    case 'this_month':
      from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
    case 'last_month':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      to.setTime(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999).getTime());
      break;
    default:
      from = new Date(to);
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
  }
  return { from, to };
}

function getPreviousPeriodRange(from: Date, to: Date): { from: Date; to: Date } {
  const duration = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return { from: prevFrom, to: prevTo };
}

/** Parse any date-like field into a Date object. Handles Timestamps, ISO strings, Date objects. */
function toDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val.toDate && typeof val.toDate === 'function') return val.toDate(); // Firestore Timestamp
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'number') return new Date(val);
  return null;
}

function inRange(dateVal: any, from: Date, to: Date): boolean {
  const d = toDate(dateVal);
  if (!d) return false;
  return d >= from && d <= to;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString('es-MX')}`;
}

// Stage colors — match CRM pipeline defaults
const STAGE_COLORS: Record<string, string> = {
  'Nuevo': '#3b82f6',
  'Seguimiento': '#f59e0b',
  'Visita Técnica': '#8b5cf6',
  'Venta Realizada': '#10b981',
  'Perdido': '#ef4444',
};

const QUOTE_STATUS_COLORS: Record<string, string> = {
  'borrador': '#94a3b8',
  'enviada': '#3b82f6',
  'aprobada': '#10b981',
  'rechazada': '#ef4444',
  'vencida': '#f59e0b',
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
  'borrador': 'Borrador',
  'enviada': 'Enviada',
  'aprobada': 'Aprobada',
  'rechazada': 'Rechazada',
  'vencida': 'Vencida',
};

// ── Hook ───────────────────────────────────────────────

export function useDashboardMetrics(
  leads: Lead[],
  quotes: Quote[],
  agendaItems: AgendaItem[],
  conversations: Conversation[],
   period: PeriodKey
): DashboardMetrics {
  const { commercial } = useSettingsStore();
  const currency = commercial?.currency || 'MX';

  return useMemo(() => {
    const { from, to } = getPeriodRange(period);
    const prev = getPreviousPeriodRange(from, to);

    // ── Leads ──
    const leadsInPeriod = leads.filter(l => inRange(l.createdAt, from, to));
    const leadsInPrev = leads.filter(l => inRange(l.createdAt, prev.from, prev.to));
    const closedStages = ['Venta Realizada'];
    const lostStages = ['Perdido'];
    const closedLeads = leads.filter(l => closedStages.includes(l.stage) && inRange(l.createdAt, from, to));
    const closedLeadsPrev = leads.filter(l => closedStages.includes(l.stage) && inRange(l.createdAt, prev.from, prev.to));

    // ── Quotes ──
    const quotesInPeriod = quotes.filter(q => inRange(q.date || (q as any).createdAt, from, to));
    const quotesInPrev = quotes.filter(q => inRange(q.date || (q as any).createdAt, prev.from, prev.to));
    const sentStatuses = ['enviada', 'aprobada'];
    const quotesSent = quotesInPeriod.filter(q => sentStatuses.includes(q.status)).length || quotesInPeriod.length;
    const quotesSentPrev = quotesInPrev.filter(q => sentStatuses.includes(q.status)).length || quotesInPrev.length;

    // Potential amount — open quotes (not rejected)
    const openQuotes = quotes.filter(q => !['rechazada', 'vencida'].includes(q.status));
    const potentialAmount = openQuotes.reduce((sum, q) => sum + (q.total || 0), 0);
    const prevOpenQuotes = quotes.filter(q => !['rechazada', 'vencida'].includes(q.status) && inRange(q.date || (q as any).createdAt, prev.from, prev.to));
    const potentialAmountPrev = prevOpenQuotes.reduce((sum, q) => sum + (q.total || 0), 0);

    // Closed amount
    const closedQuotes = quotes.filter(q => q.status === 'aprobada');
    const closedAmount = closedQuotes.reduce((sum, q) => sum + (q.total || 0), 0);
    const closedCount = closedLeads.length || closedQuotes.length;

    // ── Conversion rate ──
    const totalLeads = leads.length;
    const totalClosed = leads.filter(l => closedStages.includes(l.stage)).length;
    const conversionRate = totalLeads > 0 ? Math.round((totalClosed / totalLeads) * 100) : 0;
    const averageTicket = totalClosed > 0 ? Math.round(closedAmount / totalClosed) : 0;

    // ── Agenda ──
    const now = new Date();
    const pendingActivities = agendaItems.filter(a => !a.isCompleted && toDate(a.date) && toDate(a.date)! >= now).length;
    const upcomingVisits = agendaItems.filter(a => !a.isCompleted && a.type === 'visita técnica' && toDate(a.date) && toDate(a.date)! >= now).length;

    // ── Leads by stage ──
    const stageOrder = ['Nuevo', 'Seguimiento', 'Visita Técnica', 'Venta Realizada', 'Perdido'];
    const leadsByStage = stageOrder.map(stage => ({
      stage,
      count: leads.filter(l => l.stage === stage).length,
      color: STAGE_COLORS[stage] || '#94a3b8',
    }));

    // ── Quotes by status ──
    const statusOrder = ['borrador', 'enviada', 'aprobada', 'rechazada', 'vencida'];
    const quotesByStatus = statusOrder.map(status => ({
      status: QUOTE_STATUS_LABELS[status] || status,
      count: quotes.filter(q => q.status === status).length,
      color: QUOTE_STATUS_COLORS[status] || '#94a3b8',
    })).filter(s => s.count > 0);

    // ── Activity by day (last 7 days) ──
    const dayLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const activityByDay: DashboardMetrics['activityByDay'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      activityByDay.push({
        date: dayStart.toISOString().split('T')[0],
        label: dayLabels[dayStart.getDay()],
        leads: leads.filter(l => inRange(l.createdAt, dayStart, dayEnd)).length,
        quotes: quotes.filter(q => inRange(q.date || (q as any).createdAt, dayStart, dayEnd)).length,
      });
    }

    // ── Recent activity (combined feed) ──
    const recentActivity: DashboardActivity[] = [];

    // From leads
    leads
      .filter(l => l.createdAt)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
      .slice(0, 8)
      .forEach(l => {
        const d = toDate(l.createdAt);
        if (!d) return;

        if (closedStages.includes(l.stage)) {
          recentActivity.push({
            id: `lead-closed-${l.id}`,
            type: 'deal_closed',
            title: `Venta realizada: ${l.name}`,
            subtitle: l.city,
            date: d,
            icon: '🎉',
            color: '#10b981',
            link: '/crm',
          });
        } else if (lostStages.includes(l.stage)) {
          recentActivity.push({
            id: `lead-lost-${l.id}`,
            type: 'deal_lost',
            title: `Lead perdido: ${l.name}`,
            subtitle: l.city,
            date: d,
            icon: '❌',
            color: '#ef4444',
            link: '/crm',
          });
        } else {
          recentActivity.push({
            id: `lead-${l.id}`,
            type: 'lead_new',
            title: `Nuevo lead: ${l.name}`,
            subtitle: `${l.source} · ${l.city}`,
            date: d,
            icon: '👤',
            color: '#3b82f6',
            link: '/crm',
          });
        }
      });

    // From quotes
    quotes
      .slice(0, 6)
      .forEach(q => {
        const d = toDate(q.date || (q as any).createdAt);
        if (!d) return;
        const isSent = q.status === 'enviada' || q.status === 'aprobada';
        recentActivity.push({
          id: `quote-${q.id}`,
          type: isSent ? 'quote_sent' : 'quote_created',
          title: `Cotización ${q.quoteNumber} ${isSent ? 'enviada' : 'creada'}`,
          subtitle: `$${q.total?.toLocaleString('es-MX') || '0'} ${currency}`,
          date: d,
          icon: isSent ? '📩' : '📄',
          color: isSent ? '#2563eb' : '#94a3b8',
          link: '/cotizaciones',
        });
      });

    // From conversations (last messages)
    conversations
      .filter(c => c.lastMessageSender === 'lead' && c.lastMessageDate)
      .sort((a, b) => (toDate(b.lastMessageDate)?.getTime() || 0) - (toDate(a.lastMessageDate)?.getTime() || 0))
      .slice(0, 5)
      .forEach(c => {
        const d = toDate(c.lastMessageDate);
        if (!d) return;
        recentActivity.push({
          id: `conv-${c.id}`,
          type: 'message_received',
          title: `Mensaje de ${c.contactName}`,
          subtitle: c.lastMessage?.slice(0, 60) || 'Nuevo mensaje',
          date: d,
          icon: '💬',
          color: '#10b981',
          link: '/conversaciones',
        });
      });

    // From agenda
    agendaItems
      .filter(a => a.type === 'visita técnica' && !a.isCompleted)
      .slice(0, 4)
      .forEach(a => {
        const d = toDate(a.date);
        if (!d) return;
        recentActivity.push({
          id: `agenda-${a.id}`,
          type: 'visit_scheduled',
          title: `Visita técnica: ${a.title}`,
          subtitle: d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }),
          date: d,
          icon: '🏠',
          color: '#8b5cf6',
          link: '/agenda',
        });
      });

    // Sort by date desc, limit to 15
    recentActivity.sort((a, b) => b.date.getTime() - a.date.getTime());
    recentActivity.splice(15);

    return {
      newLeads: leadsInPeriod.length,
      newLeadsPrev: leadsInPrev.length,
      quotesSent,
      quotesSentPrev,
      closedDeals: closedCount,
      closedDealsPrev: closedLeadsPrev.length,
      potentialAmount,
      potentialAmountPrev,
      totalLeads,
      conversionRate,
      averageTicket,
      pendingActivities,
      upcomingVisits,
      leadsByStage,
      quotesByStatus,
      activityByDay,
      recentActivity,
    };
  }, [leads, quotes, agendaItems, conversations, period]);
}

export { formatCompact, pctChange };
