import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeadStore } from '@/stores/leadStore';
import { useQuoteStore } from '@/stores/quoteStore';
import { useAgendaStore } from '@/stores/agendaStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { useDashboardMetrics, formatCompact, pctChange, PeriodKey } from './useDashboardMetrics';
import {
  Users, FileText, TrendingUp, BarChart3,
  ArrowUpRight, ArrowDownRight, Sparkles,
  CheckCircle2, Clock, ChevronRight, Loader2,
  AlertCircle, ArrowRight, Target, CalendarCheck,
  MapPin, Share2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { SmartFlowScoreService, ScoreBreakdown } from '@/services/SmartFlowScoreService';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today',      label: 'Hoy' },
  { key: '7d',         label: '7 días' },
  { key: '30d',        label: '30 días' },
  { key: 'this_month', label: 'Este mes' },
  { key: 'last_month', label: 'Mes anterior' },
];

export const DashboardPageView = () => {
  const navigate = useNavigate();
  const { activeMembership } = useAuthStore();
  const tenantId = activeMembership?.tenantId;

  const { leads, subscribe: subLeads, isLoading: leadsLoading } = useLeadStore();
  const { quotes, subscribe: subQuotes, isLoading: quotesLoading } = useQuoteStore();
  const { items: agendaItems, subscribe: subAgenda } = useAgendaStore();
  const { conversations, subscribeInbox } = useConversationStore();
  const { features, subscribe: subSettings } = useSettingsStore();
  const { teamMembers, subscribe: subUsers } = useUserStore();

  const [period, setPeriod] = useState<PeriodKey>('30d');

  useEffect(() => {
    if (!tenantId) return;
    const unsubs = [
      subLeads(tenantId),
      subQuotes(tenantId),
      subAgenda(tenantId),
      subscribeInbox(tenantId),
      subSettings(tenantId),
      subUsers(tenantId),
    ];
    return () => unsubs.forEach(u => u());
  }, [tenantId]);

  const m = useDashboardMetrics(leads, quotes, agendaItems, conversations, period, features || {}, teamMembers.length || 1);

  const [score, setScore] = useState<ScoreBreakdown | null>(null);
  useEffect(() => {
    if (leads.length > 0 || conversations.length > 0) {
      setScore(SmartFlowScoreService.calculateScore(leads, conversations));
    }
  }, [leads, conversations]);

  const isLoading = leadsLoading || quotesLoading;
  const scoreVal   = score?.total ?? 0;
  const scoreColor = scoreVal >= 80 ? '#10B981' : scoreVal >= 50 ? '#F59E0B' : '#1877F2';
  const scoreLabel = scoreVal >= 80 ? '¡En llamas!' : scoreVal >= 50 ? 'Hay oportunidad' : 'Necesita impulso';
  const maxLeadStage   = Math.max(...m.leadsByStage.map(s => s.count), 1);
  const maxDayActivity = Math.max(...m.activityByDay.map(d => d.leads + d.quotes), 1);

  if (isLoading && leads.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 text-[#1877F2] animate-spin" />
        <p className="text-sm text-slate-400">Cargando métricas...</p>
      </div>
    );
  }

  return (
    <div className="pb-10 space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-800 px-6 py-4 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-lg font-black text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">Vista general de tu negocio</p>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-900 rounded-xl p-1 gap-1">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                period === p.key
                  ? 'bg-white dark:bg-slate-700 text-[#1877F2] shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          { label: 'Leads nuevos',    value: m.newLeads,        prev: m.newLeadsPrev,        fmt: (v: number) => String(v), icon: Users,      color: '#1877F2', delay: 0.05 },
          { label: 'Cotizaciones',    value: m.quotesSent,      prev: m.quotesSentPrev,      fmt: (v: number) => String(v), icon: FileText,   color: '#8B5CF6', delay: 0.10 },
          { label: 'Cierres',         value: m.closedDeals,     prev: m.closedDealsPrev,     fmt: (v: number) => String(v), icon: TrendingUp, color: '#10B981', delay: 0.15 },
          { label: 'Monto potencial', value: m.potentialAmount, prev: m.potentialAmountPrev, fmt: formatCompact,             icon: BarChart3,  color: '#F59E0B', delay: 0.20 },
        ] as const).map(card => {
          const change = pctChange(card.value, card.prev);
          const up = change >= 0;
          return (
            <motion.div
              key={card.label}
              className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-5 flex flex-col gap-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: card.delay }}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400">{card.label}</p>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${card.color}18` }}>
                  <card.icon className="w-4 h-4" style={{ color: card.color }} strokeWidth={2} />
                </div>
              </div>
              <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                {card.fmt(card.value)}
              </p>
              <span className={`self-start inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                up
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
                  : 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400'
              }`}>
                {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                {Math.abs(change)}% vs anterior
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Score + Sugerencias */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex items-center gap-5">
          <div className="relative shrink-0">
            <svg className="w-24 h-24 -rotate-90">
              <circle cx="48" cy="48" r="40" fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-100 dark:text-slate-700" />
              <motion.circle
                cx="48" cy="48" r="40"
                fill="none" stroke={scoreColor} strokeWidth="7"
                strokeDasharray={251}
                initial={{ strokeDashoffset: 251 }}
                animate={{ strokeDashoffset: 251 - (251 * scoreVal) / 100 }}
                transition={{ duration: 1.4, ease: 'easeOut' }}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-slate-900 dark:text-white">{scoreVal}</span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Score</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">SmartFlow Score</p>
            <p className="text-lg font-black text-slate-900 dark:text-white leading-snug">{scoreLabel}</p>
            <button
              onClick={() => navigate('/conversaciones')}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#1877F2] hover:underline"
            >
              Mejorar score <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-4 h-4 text-[#1877F2]" />
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Siguientes pasos recomendados</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(score?.suggestions ?? ['Cargando...', 'Cargando...', 'Cargando...']).slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{s}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/conversaciones')}
            className="mt-4 flex items-center gap-1 text-xs font-bold text-[#1877F2] hover:underline"
          >
            <Share2 className="w-3.5 h-3.5" /> Compartir progreso
          </button>
        </div>
      </div>

      {/* Oportunidades */}
      {m.uncapturedValues && m.uncapturedValues.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 px-1">
            <AlertCircle className="w-3.5 h-3.5" /> Oportunidades sin capturar
          </p>
          {m.uncapturedValues.map(v => (
            <div key={v.key} className="flex flex-col sm:flex-row items-center gap-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-700/20 rounded-2xl px-6 py-4">
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-bold text-amber-600 bg-white dark:bg-amber-900/30 border border-amber-200 px-3 py-1 rounded-full">Oportunidad</span>
                <span className="text-2xl font-black text-amber-600">+{v.value}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{v.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{v.description}</p>
              </div>
              <button
                onClick={() => navigate(v.solutionRoute)}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors"
              >
                Capturar <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline + Cotizaciones */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pipeline por etapa</p>
            <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-full">{m.totalLeads} leads</span>
          </div>
          <div className="space-y-3">
            {m.leadsByStage.map(s => (
              <div key={s.stage} className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-xs text-slate-500 dark:text-slate-400 w-28 shrink-0 truncate">{s.stage}</span>
                <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-5 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full flex items-center justify-end pr-2.5"
                    style={{ backgroundColor: s.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max((s.count / maxLeadStage) * 100, s.count > 0 ? 6 : 0)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  >
                    {s.count > 0 && <span className="text-[10px] font-bold text-white">{s.count}</span>}
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-5">Cotizaciones</p>
          {m.quotesByStatus.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-300 dark:text-slate-600">
              <FileText className="w-8 h-8 mb-2" />
              <p className="text-xs text-slate-400">Sin cotizaciones</p>
            </div>
          ) : (
            <div className="space-y-2">
              {m.quotesByStatus.map(s => (
                <div key={s.status} className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-sm text-slate-600 dark:text-slate-300">{s.status}</span>
                  </div>
                  <span className="text-lg font-black text-slate-900 dark:text-white">{s.count}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-400">Total</span>
                <span className="text-lg font-black text-[#1877F2]">{quotes.length}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actividad + Rendimiento */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-5">Actividad — Últimos 7 días</p>
          <div className="flex items-end gap-2 h-28">
            {m.activityByDay.map(d => {
              const total  = d.leads + d.quotes;
              const height = maxDayActivity > 0 ? (total / maxDayActivity) * 100 : 0;
              const leadH  = total > 0 ? (d.leads  / total) * height : 0;
              const quoteH = total > 0 ? (d.quotes / total) * height : 0;
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">{total || ''}</span>
                  <div className="w-full flex flex-col justify-end rounded-lg overflow-hidden" style={{ height: 88 }}>
                    {quoteH > 0 && <div className="w-full bg-violet-400" style={{ height: `${quoteH}%`, minHeight: 3 }} />}
                    {leadH  > 0 && <div className="w-full bg-[#1877F2]" style={{ height: `${leadH}%`,  minHeight: 3 }} />}
                    {total  === 0 && <div className="w-full bg-slate-100 dark:bg-slate-700 rounded" style={{ height: 4 }} />}
                  </div>
                  <span className="text-[10px] text-slate-400">{d.label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-5 mt-4 justify-center">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded bg-[#1877F2]" />
              <span className="text-xs text-slate-400">Leads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded bg-violet-400" />
              <span className="text-xs text-slate-400">Cotizaciones</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-5">Rendimiento comercial</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: Target,        color: '#1877F2', value: `${m.conversionRate}%`,                                     label: 'Conversión'   },
              { icon: BarChart3,     color: '#10B981', value: m.averageTicket > 0 ? formatCompact(m.averageTicket) : '—', label: 'Ticket prom.' },
              { icon: CalendarCheck, color: '#F59E0B', value: String(m.pendingActivities),                                label: 'Pendientes'   },
              { icon: MapPin,        color: '#8B5CF6', value: String(m.upcomingVisits),                                   label: 'Visitas téc.' },
            ].map(({ icon: Icon, color, value, label }) => (
              <div key={label} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 flex flex-col items-center gap-1.5 text-center">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
                  <Icon className="w-4 h-4" style={{ color }} strokeWidth={2} />
                </div>
                <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
                <p className="text-[10px] text-slate-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actividad Reciente */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-4">Actividad reciente</p>
        {m.recentActivity.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-300 dark:text-slate-600">
            <Clock className="w-8 h-8 mb-2" />
            <p className="text-sm text-slate-400">Sin actividad reciente</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/40">
            {m.recentActivity.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-3 group">
                <span className="text-base w-7 text-center shrink-0">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{a.title}</p>
                  <p className="text-xs text-slate-400 truncate">{a.subtitle}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">{formatTimeAgo(a.date)}</span>
                  {a.link && (
                    <a href={a.link} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#1877F2]">
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

function formatTimeAgo(date: Date): string {
  const now     = new Date();
  const diffMs  = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);

  if (diffMin < 1)  return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffH   < 24) return `Hace ${diffH}h`;

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return `Hoy ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString())
    return `Ayer ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;

  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}
