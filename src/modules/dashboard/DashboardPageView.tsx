import { useEffect, useState } from 'react';
import { useLeadStore } from '@/stores/leadStore';
import { useQuoteStore } from '@/stores/quoteStore';
import { useAgendaStore } from '@/stores/agendaStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useAuthStore } from '@/stores/authStore';
import { useDashboardMetrics, formatCompact, pctChange, PeriodKey } from './useDashboardMetrics';
import {
  Sun, Users, FileText, TrendingUp, BarChart3,
  ArrowUpRight, ArrowDownRight, Loader2, Target,
  CalendarCheck, MapPin, Clock, ChevronRight
} from 'lucide-react';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: 'this_month', label: 'Este mes' },
  { key: 'last_month', label: 'Mes anterior' },
];

export const DashboardPageView = () => {
  const { activeMembership } = useAuthStore();
  const tenantId = activeMembership?.tenantId;

  // Subscribe stores from Dashboard if not already active
  const { leads, subscribe: subLeads, isLoading: leadsLoading } = useLeadStore();
  const { quotes, subscribe: subQuotes, isLoading: quotesLoading } = useQuoteStore();
  const { items: agendaItems, subscribe: subAgenda } = useAgendaStore();
  const { conversations, subscribeInbox } = useConversationStore();

  const [period, setPeriod] = useState<PeriodKey>('30d');

  useEffect(() => {
    if (!tenantId) return;
    const unsubs = [
      subLeads(tenantId),
      subQuotes(tenantId),
      subAgenda(tenantId),
      subscribeInbox(tenantId),
    ];
    return () => unsubs.forEach(u => u());
  }, [tenantId]);

  const m = useDashboardMetrics(leads, quotes, agendaItems, conversations, period);
  const isLoading = leadsLoading || quotesLoading;

  // ── Stat cards config ──
  const cards = [
    {
      label: 'Leads Nuevos',
      value: m.newLeads,
      prev: m.newLeadsPrev,
      format: (v: number) => String(v),
      icon: Users,
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      label: 'Cotizaciones',
      value: m.quotesSent,
      prev: m.quotesSentPrev,
      format: (v: number) => String(v),
      icon: FileText,
      gradient: 'from-violet-500 to-purple-600',
    },
    {
      label: 'Cierres',
      value: m.closedDeals,
      prev: m.closedDealsPrev,
      format: (v: number) => String(v),
      icon: TrendingUp,
      gradient: 'from-emerald-500 to-green-600',
    },
    {
      label: 'Monto Potencial',
      value: m.potentialAmount,
      prev: m.potentialAmountPrev,
      format: formatCompact,
      icon: BarChart3,
      gradient: 'from-amber-500 to-orange-600',
    },
  ];

  const maxLeadStage = Math.max(...m.leadsByStage.map(s => s.count), 1);
  const maxDayActivity = Math.max(...m.activityByDay.map(d => d.leads + d.quotes), 1);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center">
          <Sun className="w-6 h-6 mr-2 text-primary-500" /> Dashboard
        </h1>
        <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                period === p.key
                  ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Loading overlay ─── */}
      {isLoading && leads.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
        </div>
      )}

      {/* ─── 4 Metric Cards ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {cards.map(card => {
          const change = pctChange(card.value, card.prev);
          const isPositive = change >= 0;
          return (
            <div key={card.label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{card.label}</p>
                  <p className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{card.format(card.value)}</p>
                </div>
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${card.gradient} shadow-lg`}>
                  <card.icon className="h-5 w-5 text-white" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                  isPositive
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {Math.abs(change)}%
                </span>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">vs periodo anterior</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Row 2: Leads by Stage + Quotes by Status ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Leads por etapa */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Pipeline — Leads por Etapa</h2>
            <span className="text-xs text-slate-400 font-medium">{m.totalLeads} totales</span>
          </div>
          <div className="space-y-3">
            {m.leadsByStage.map(s => (
              <div key={s.stage} className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 w-28 truncate">{s.stage}</span>
                <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-6 relative overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max((s.count / maxLeadStage) * 100, s.count > 0 ? 12 : 0)}%`,
                      backgroundColor: s.color,
                    }}
                  >
                    {s.count > 0 && <span className="text-[10px] font-bold text-white">{s.count}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cotizaciones por estado */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-5">Cotizaciones por Estado</h2>
          {m.quotesByStatus.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-8">Sin cotizaciones</p>
          ) : (
            <div className="space-y-3">
              {m.quotesByStatus.map(s => (
                <div key={s.status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{s.status}</span>
                  </div>
                  <span className="text-lg font-bold text-slate-900 dark:text-white">{s.count}</span>
                </div>
              ))}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase">Total</span>
                <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{quotes.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Row 3: Activity 7d chart + Performance summary ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Actividad 7 días */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-5">Actividad — Últimos 7 Días</h2>
          <div className="flex items-end gap-2 h-40">
            {m.activityByDay.map(d => {
              const total = d.leads + d.quotes;
              const height = maxDayActivity > 0 ? (total / maxDayActivity) * 100 : 0;
              const leadH = total > 0 ? (d.leads / total) * height : 0;
              const quoteH = total > 0 ? (d.quotes / total) * height : 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] font-bold text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">{total}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                    {quoteH > 0 && (
                      <div
                        className="w-full rounded-t-md bg-violet-400 dark:bg-violet-500 transition-all duration-500"
                        style={{ height: `${quoteH}%`, minHeight: quoteH > 0 ? '4px' : '0' }}
                        title={`${d.quotes} cotización(es)`}
                      />
                    )}
                    {leadH > 0 && (
                      <div
                        className={`w-full bg-blue-400 dark:bg-blue-500 transition-all duration-500 ${quoteH > 0 ? '' : 'rounded-t-md'} rounded-b-md`}
                        style={{ height: `${leadH}%`, minHeight: leadH > 0 ? '4px' : '0' }}
                        title={`${d.leads} lead(s)`}
                      />
                    )}
                    {total === 0 && (
                      <div className="w-full rounded-md bg-slate-100 dark:bg-slate-700" style={{ height: '4px' }} />
                    )}
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">{d.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-4 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-400" />
              <span className="text-[10px] font-medium text-slate-500">Leads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-violet-400" />
              <span className="text-[10px] font-medium text-slate-500">Cotizaciones</span>
            </div>
          </div>
        </div>

        {/* Rendimiento comercial */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-5">Rendimiento Comercial</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 text-center">
              <Target className="w-5 h-5 text-primary-500 mx-auto mb-2" />
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{m.conversionRate}%</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-1">Tasa de Conversión</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 text-center">
              <BarChart3 className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{m.averageTicket > 0 ? formatCompact(m.averageTicket) : '—'}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-1">Ticket Promedio</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 text-center">
              <CalendarCheck className="w-5 h-5 text-amber-500 mx-auto mb-2" />
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{m.pendingActivities}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-1">Actividades Pendientes</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 text-center">
              <MapPin className="w-5 h-5 text-violet-500 mx-auto mb-2" />
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white">{m.upcomingVisits}</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-1">Visitas Técnicas</p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Row 4: Recent Activity ─── */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-5">Actividad Reciente</h2>
        {m.recentActivity.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">Sin actividad reciente</p>
            <p className="text-xs mt-1">Los eventos aparecerán aquí conforme se generen leads, cotizaciones y mensajes.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {m.recentActivity.map(a => (
              <div key={a.id} className="flex items-center gap-4 py-3 group">
                <span className="text-xl flex-shrink-0 w-8 text-center">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{a.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{a.subtitle}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                    {formatTimeAgo(a.date)}
                  </span>
                  {a.link && (
                    <a href={a.link} className="opacity-0 group-hover:opacity-100 transition-opacity text-primary-500 hover:text-primary-600">
                      <ChevronRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** Format a Date as relative time: "Hace 2 min", "Hoy 8:45", "23 abr" */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffH < 24) return `Hace ${diffH}h`;

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return `Hoy ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Ayer ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}
