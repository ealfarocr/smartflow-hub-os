import { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck, AlertTriangle, ChevronRight,
  User, Search, MessageCircle, Zap,
  TrendingUp, CheckCircle2, X, Clock,
  ThumbsUp, RefreshCcw, Target, Bot,
  Lightbulb, TrendingDown, SmilePlus, Frown,
  FileText, Users
} from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useConversationStore } from '@/stores/conversationStore';
import { useAuthStore } from '@/stores/authStore';
import { AnimatePresence, motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const getMs = (dateVal: any): number => {
  if (!dateVal) return 0;
  if (dateVal instanceof Date) return dateVal.getTime();
  if (typeof dateVal?.toDate === 'function') return dateVal.toDate().getTime();
  if (typeof dateVal?.seconds === 'number') return dateVal.seconds * 1000;
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

const safeFormatDate = (dateVal: any) => {
  if (!dateVal) return 'Sin actividad';
  try {
    const ms = getMs(dateVal);
    if (ms === 0) return 'Sin actividad';
    return formatDistanceToNow(new Date(ms), { addSuffix: true, locale: es });
  } catch { return 'Sin actividad'; }
};

const scoreColor = (s: number) =>
  s >= 90 ? { text: 'text-emerald-600', bg: 'bg-emerald-50', bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700', label: 'Excelente' }
  : s >= 60 ? { text: 'text-[#1877F2]', bg: 'bg-[#1877F2]/5', bar: 'bg-[#1877F2]', badge: 'bg-[#1877F2]/8 text-[#1877F2]', label: 'Buen Desempeño' }
  : { text: 'text-red-500', bg: 'bg-red-50', bar: 'bg-red-400', badge: 'bg-red-50 text-red-600', label: 'Bajo Desempeño' };

function generateBotSuggestions(conversations: any[]): { icon: any; color: string; bg: string; title: string; description: string }[] {
  const suggestions: { icon: any; color: string; bg: string; title: string; description: string }[] = [];
  const total = conversations.length;
  if (total === 0) return suggestions;

  const negative = conversations.filter(c => c.aiSentiment === 'negative' || c.aiSentiment === 'critical').length;
  const negativePct = Math.round((negative / total) * 100);

  const waitingLead = conversations.filter(c =>
    c.status !== 'archived' && c.lastMessageSender === 'lead'
  ).length;

  const noSentiment = conversations.filter(c => !c.aiSentiment).length;
  const resolved = conversations.filter(c => c.status === 'archived').length;
  const resolutionPct = Math.round((resolved / total) * 100);

  if (negativePct > 20) {
    suggestions.push({
      icon: Frown,
      color: 'text-red-500',
      bg: 'bg-red-50',
      title: `${negativePct}% de conversaciones con sentimiento negativo`,
      description: 'Revisá el manejo de objeciones en el documento de entrenamiento. Agregá respuestas para "está muy caro", "no conozco la zona" y "necesito pensarlo".',
    });
  }

  if (waitingLead > 2) {
    suggestions.push({
      icon: Clock,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
      title: `${waitingLead} conversaciones esperando respuesta del bot`,
      description: 'El cliente escribió pero el bot no respondió o tardó demasiado. Verificá que el autopilot esté activado y el token de WhatsApp esté vigente.',
    });
  }

  if (resolutionPct < 30 && total > 5) {
    suggestions.push({
      icon: Target,
      color: 'text-violet-500',
      bg: 'bg-violet-50',
      title: `Tasa de cierre baja (${resolutionPct}%)`,
      description: 'El bot está respondiendo pero pocas conversaciones terminan en visita agendada. Reforzá el CTA en el documento: "¿Cuándo le queda bien para visitar el proyecto?"',
    });
  }

  if (noSentiment > total * 0.5) {
    suggestions.push({
      icon: FileText,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
      title: 'Muchas conversaciones sin análisis de sentimiento',
      description: 'El sistema no ha procesado el sentimiento de estas conversaciones. Son oportunidades de mejora sin evaluar aún.',
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      icon: CheckCircle2,
      color: 'text-emerald-500',
      bg: 'bg-emerald-50',
      title: 'El agente está funcionando bien',
      description: 'No se detectaron patrones problemáticos en las conversaciones actuales. Seguí monitoreando a medida que crezca el volumen.',
    });
  }

  return suggestions;
}

export const QualityAuditorView = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAdvisor, setSelectedAdvisor] = useState<any>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'advisors' | 'bot'>('advisors');
  const { activeMembership } = useAuthStore();
  const { teamMembers, subscribe: subscribeUsers } = useUserStore();
  const { conversations, subscribeInbox } = useConversationStore();

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const u1 = subscribeUsers(activeMembership.tenantId);
      const u2 = subscribeInbox(activeMembership.tenantId);
      return () => { u1(); u2(); };
    }
  }, [activeMembership?.tenantId, subscribeUsers, subscribeInbox]);

  const handleRefresh = () => {
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 1500);
  };

  const auditorReports = useMemo(() => {
    return teamMembers.map(member => {
      const agentConvs = conversations.filter(c => c.advisorId === member.userId);
      const resolved = agentConvs.filter(c => c.status === 'archived').length;
      const baseScore = agentConvs.length > 0 ? (resolved / agentConvs.length) * 100 : 0;
      const sentimentBonus = agentConvs.filter(c => c.aiSentiment === 'positive').length * 2;
      const sentimentPenalty = agentConvs.filter(c => c.aiSentiment === 'critical').length * 10;
      const finalScore = Math.max(0, Math.min(100, Math.round(baseScore + sentimentBonus - sentimentPenalty)));
      const lastConv = [...agentConvs].sort((a, b) => getMs(b.updatedAt) - getMs(a.updatedAt))[0];
      return {
        ...member,
        score: finalScore,
        resolvedCount: resolved,
        activeCount: agentConvs.filter(c => c.status === 'active').length,
        lastActivity: safeFormatDate(lastConv?.updatedAt),
        sentiment: finalScore >= 80 ? 'Positivo' : finalScore >= 50 ? 'Neutral' : 'Crítico',
      };
    }).filter(m =>
      m.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [teamMembers, conversations, searchQuery]);

  const globalMetrics = useMemo(() => {
    const total = conversations.length;
    const closed = conversations.filter(c => c.status === 'archived').length;
    const critical = conversations.filter(c => c.aiSentiment === 'critical').length;
    const avgScore = auditorReports.length > 0
      ? Math.round(auditorReports.reduce((acc, r) => acc + r.score, 0) / auditorReports.length)
      : 0;
    return { total, closed, critical, avgScore };
  }, [conversations, auditorReports]);

  // Bot metrics
  const botConversations = useMemo(() =>
    conversations.filter(c => c.status === 'bot_handling' || (c as any).botEnabled === true),
  [conversations]);

  const botMetrics = useMemo(() => {
    const total = botConversations.length;
    const resolved = botConversations.filter(c => c.status === 'archived').length;
    const positive = botConversations.filter(c => c.aiSentiment === 'positive').length;
    const negative = botConversations.filter(c => c.aiSentiment === 'negative' || c.aiSentiment === 'critical').length;
    const waitingReply = botConversations.filter(c => c.status !== 'archived' && c.lastMessageSender === 'lead').length;
    const score = total > 0
      ? Math.max(0, Math.min(100, Math.round(((positive * 2 + resolved) / (total * 3)) * 100)))
      : 0;
    return { total, resolved, positive, negative, waitingReply, score };
  }, [botConversations]);

  const botSuggestions = useMemo(() => generateBotSuggestions(botConversations), [botConversations]);

  const kpis = [
    { label: 'Conversaciones', value: globalMetrics.total, icon: MessageCircle, color: '#1877F2', bgColor: 'bg-[#1877F2]/10' },
    { label: 'Tasa de Cierre',  value: globalMetrics.total > 0 ? `${Math.round((globalMetrics.closed / globalMetrics.total) * 100)}%` : '0%', icon: Target, color: '#10B981', bgColor: 'bg-emerald-50' },
    { label: 'Score Global IA', value: `${globalMetrics.avgScore}%`, icon: ShieldCheck, color: '#7C3AED', bgColor: 'bg-violet-50' },
    { label: 'Alertas Críticas', value: globalMetrics.critical, icon: AlertTriangle, color: '#F59E0B', bgColor: 'bg-amber-50' },
  ];

  const botKpis = [
    { label: 'Manejadas por Bot', value: botMetrics.total, icon: Bot, color: '#7C3AED', bgColor: 'bg-violet-50' },
    { label: 'Resueltas', value: botMetrics.resolved, icon: CheckCircle2, color: '#10B981', bgColor: 'bg-emerald-50' },
    { label: 'Sentimiento +', value: botMetrics.positive, icon: SmilePlus, color: '#1877F2', bgColor: 'bg-[#1877F2]/10' },
    { label: 'Esperando Resp.', value: botMetrics.waitingReply, icon: AlertTriangle, color: '#F59E0B', bgColor: 'bg-amber-50' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white">Quality Auditor</h1>
                <span className="text-lg font-black text-[#1877F2] italic">IA</span>
                <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-[9px] font-black rounded-lg uppercase tracking-widest">En vivo</span>
              </div>
              <p className="text-xs text-slate-400 font-medium">Control de calidad · {teamMembers.length} asesores · {botMetrics.total} conversaciones del bot</p>
            </div>
          </div>
          <button onClick={handleRefresh} disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl shadow-sm shadow-[#1877F2]/20 transition-all disabled:opacity-50">
            <RefreshCcw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-slate-50 dark:bg-slate-900/50 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('advisors')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all ${
              activeTab === 'advisors'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}>
            <Users className="w-3.5 h-3.5" />
            Asesores
          </button>
          <button
            onClick={() => setActiveTab('bot')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition-all ${
              activeTab === 'bot'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-600'
            }`}>
            <Bot className="w-3.5 h-3.5" />
            Agente IA
            {botMetrics.waitingReply > 0 && (
              <span className="w-4 h-4 bg-amber-400 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                {botMetrics.waitingReply}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'advisors' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((kpi, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-9 h-9 rounded-xl ${kpi.bgColor} flex items-center justify-center`}>
                    <kpi.icon className="w-4.5 h-4.5" style={{ color: kpi.color }} />
                  </div>
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                    <span className="text-[9px] font-black text-slate-400 uppercase">Live</span>
                  </div>
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{kpi.label}</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{kpi.value}</p>
              </motion.div>
            ))}
          </div>

          {/* Advisors Table */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4 text-slate-400" />
                <div>
                  <h2 className="text-sm font-black text-slate-900 dark:text-white">Desempeño de Asesores</h2>
                  <p className="text-[10px] text-slate-400 font-medium">Análisis de {auditorReports.length} asesores</p>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Buscar asesor..."
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:border-[#1877F2]/40 transition-colors w-52"
                />
              </div>
            </div>
            <div className="grid grid-cols-12 px-5 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
              <div className="col-span-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Asesor</div>
              <div className="col-span-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Score IA</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Cierres</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">Activas</div>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {auditorReports.length === 0 ? (
                <div className="py-14 text-center">
                  <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-400">Sin resultados para "{searchQuery}"</p>
                </div>
              ) : (
                auditorReports.map((report, i) => {
                  const sc = scoreColor(report.score);
                  const initials = report.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
                  return (
                    <motion.div key={report.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => setSelectedAdvisor(report)}
                      className="grid grid-cols-12 items-center px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 cursor-pointer transition-colors group">
                      <div className="col-span-5 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${sc.bg} ${sc.text}`}>
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 dark:text-white truncate">{report.name || 'Sin nombre'}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg ${sc.badge}`}>{sc.label}</span>
                            <span className="text-[9px] text-slate-400 hidden sm:inline">{report.lastActivity}</span>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-3 flex items-center gap-2.5">
                        <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${report.score}%` }}
                            transition={{ delay: 0.2 + i * 0.04, duration: 0.5 }}
                            className={`h-full rounded-full ${sc.bar}`}
                          />
                        </div>
                        <span className={`text-xs font-black tabular-nums ${sc.text}`}>{report.score}%</span>
                      </div>
                      <div className="col-span-2 text-center">
                        <span className="text-sm font-black text-slate-700 dark:text-slate-300">{report.resolvedCount}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-center gap-1">
                        <span className="text-sm font-black text-slate-700 dark:text-slate-300">{report.activeCount}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#1877F2] transition-colors" />
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'bot' && (
        <motion.div
          key="bot-tab"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6">

          {/* Bot KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {botKpis.map((kpi, i) => (
              <motion.div key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07 }}
                className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-9 h-9 rounded-xl ${kpi.bgColor} flex items-center justify-center`}>
                    <kpi.icon className="w-4.5 h-4.5" style={{ color: kpi.color }} />
                  </div>
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-emerald-500" />
                    <span className="text-[9px] font-black text-slate-400 uppercase">Live</span>
                  </div>
                </div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{kpi.label}</p>
                <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{kpi.value}</p>
              </motion.div>
            ))}
          </div>

          {/* Score del bot */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
            <div className="flex items-center gap-4">
              <div className="relative w-20 h-20 shrink-0">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-100 dark:text-slate-700" />
                  <motion.circle cx="28" cy="28" r="22" fill="none" strokeWidth="5"
                    strokeDasharray={`${2 * Math.PI * 22}`}
                    initial={{ strokeDashoffset: `${2 * Math.PI * 22}` }}
                    animate={{ strokeDashoffset: `${2 * Math.PI * 22 * (1 - botMetrics.score / 100)}` }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    strokeLinecap="round"
                    className={botMetrics.score >= 70 ? 'text-emerald-500' : botMetrics.score >= 40 ? 'text-[#1877F2]' : 'text-red-400'}
                    stroke="currentColor"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-black ${botMetrics.score >= 70 ? 'text-emerald-600' : botMetrics.score >= 40 ? 'text-[#1877F2]' : 'text-red-500'}`}>
                    {botMetrics.score}%
                  </span>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Bot className="w-4 h-4 text-violet-500" />
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Score del Agente IA</h3>
                </div>
                <p className="text-xs text-slate-400 mb-2">Basado en sentimiento positivo, resoluciones y conversaciones pendientes.</p>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1 text-emerald-600 font-bold">
                    <SmilePlus className="w-3 h-3" /> {botMetrics.positive} positivas
                  </span>
                  <span className="flex items-center gap-1 text-red-500 font-bold">
                    <TrendingDown className="w-3 h-3" /> {botMetrics.negative} negativas
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sugerencias de mejora */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2.5">
              <Lightbulb className="w-4 h-4 text-amber-400" />
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">Sugerencias para Mejorar el Agente</h2>
                <p className="text-[10px] text-slate-400 font-medium">Detectadas automáticamente del análisis de conversaciones</p>
              </div>
            </div>
            <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
              {botSuggestions.map((s, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-start gap-4 p-5">
                  <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900 dark:text-white mb-1">{s.title}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">{s.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Conversaciones del bot */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2.5">
              <MessageCircle className="w-4 h-4 text-slate-400" />
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">Conversaciones Manejadas por el Bot</h2>
                <p className="text-[10px] text-slate-400 font-medium">{botConversations.length} conversaciones detectadas</p>
              </div>
            </div>
            {botConversations.length === 0 ? (
              <div className="py-14 text-center">
                <Bot className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm font-bold text-slate-400">No hay conversaciones del bot aún</p>
                <p className="text-xs text-slate-300 mt-1">Cuando el autopilot atienda mensajes, aparecerán aquí</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {botConversations.slice(0, 20).map((conv, i) => {
                  const sentColor = conv.aiSentiment === 'positive' ? 'text-emerald-500 bg-emerald-50'
                    : conv.aiSentiment === 'critical' || conv.aiSentiment === 'negative' ? 'text-red-500 bg-red-50'
                    : 'text-slate-400 bg-slate-50';
                  const sentLabel = conv.aiSentiment === 'positive' ? 'Positivo'
                    : conv.aiSentiment === 'critical' ? 'Crítico'
                    : conv.aiSentiment === 'negative' ? 'Negativo'
                    : 'Neutral';
                  const waitingReply = conv.status !== 'archived' && conv.lastMessageSender === 'lead';
                  return (
                    <motion.div key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
                      <div className="w-9 h-9 rounded-xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-violet-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 dark:text-white truncate">{conv.contactName || 'Cliente'}</p>
                        <p className="text-[10px] text-slate-400 truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {waitingReply && (
                          <span className="text-[9px] font-black px-2 py-0.5 rounded-lg bg-amber-50 text-amber-500">
                            Esperando
                          </span>
                        )}
                        {conv.aiSentiment && (
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg ${sentColor}`}>
                            {sentLabel}
                          </span>
                        )}
                        <span className="text-[9px] text-slate-300">{safeFormatDate(conv.updatedAt)}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Detail Drawer — Advisors */}
      <AnimatePresence>
        {selectedAdvisor && (() => {
          const sc = scoreColor(selectedAdvisor.score);
          const advisorConvs = conversations.filter(c => c.advisorId === selectedAdvisor.userId);
          return (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setSelectedAdvisor(null)}
                className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-[100]"
              />
              <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-slate-800 z-[101] shadow-2xl flex flex-col overflow-hidden"
              >
                <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-black ${sc.bg} ${sc.text}`}>
                      {selectedAdvisor.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?'}
                    </div>
                    <div>
                      <h3 className="font-black text-slate-900 dark:text-white">{selectedAdvisor.name}</h3>
                      <p className="text-[10px] text-slate-400">{selectedAdvisor.email}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedAdvisor(null)}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  <div className={`rounded-2xl p-5 ${sc.bg} flex items-center gap-5`}>
                    <div className="relative w-16 h-16 shrink-0">
                      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/60" />
                        <circle cx="28" cy="28" r="22" fill="none" strokeWidth="6"
                          strokeDasharray={`${2 * Math.PI * 22}`}
                          strokeDashoffset={`${2 * Math.PI * 22 * (1 - selectedAdvisor.score / 100)}`}
                          strokeLinecap="round"
                          className={sc.text}
                          stroke="currentColor"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-sm font-black ${sc.text}`}>{selectedAdvisor.score}%</span>
                      </div>
                    </div>
                    <div>
                      <p className={`text-base font-black ${sc.text} mb-1`}>{sc.label}</p>
                      <p className="text-xs text-slate-500">Última actividad: {selectedAdvisor.lastActivity}</p>
                      <div className={`flex items-center gap-1.5 mt-2 text-xs font-bold ${sc.text}`}>
                        <ThumbsUp className="w-3.5 h-3.5" />
                        Sentimiento {selectedAdvisor.sentiment}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Total', value: selectedAdvisor.activeCount + selectedAdvisor.resolvedCount, icon: MessageCircle },
                      { label: 'Cierres', value: selectedAdvisor.resolvedCount, icon: CheckCircle2 },
                      { label: 'Activas', value: selectedAdvisor.activeCount, icon: Zap },
                    ].map(s => (
                      <div key={s.label} className="bg-slate-50 dark:bg-slate-900/50 rounded-2xl p-3.5 text-center">
                        <s.icon className="w-4 h-4 text-slate-400 mx-auto mb-1.5" />
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.label}</p>
                        <p className="text-xl font-black text-slate-900 dark:text-white">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conversaciones del asesor</h4>
                    </div>
                    {advisorConvs.length === 0 ? (
                      <div className="py-10 text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-700">
                        <MessageCircle className="w-6 h-6 text-slate-200 mx-auto mb-2" />
                        <p className="text-xs text-slate-400 font-bold">Sin conversaciones vinculadas</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {advisorConvs.map((conv, i) => {
                          const sentColor = conv.aiSentiment === 'positive' ? 'text-emerald-500 bg-emerald-50'
                            : conv.aiSentiment === 'critical' ? 'text-red-500 bg-red-50'
                            : 'text-slate-400 bg-slate-50';
                          return (
                            <div key={i} className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-700">
                              <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center shrink-0 shadow-sm">
                                <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-black text-slate-900 dark:text-white truncate">{conv.contactName || 'Cliente'}</p>
                                <p className="text-[10px] text-slate-400 truncate">{conv.lastMessage || 'Sin mensajes'}</p>
                              </div>
                              {conv.aiSentiment && (
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg shrink-0 ${sentColor}`}>
                                  {conv.aiSentiment === 'positive' ? 'Positivo' : conv.aiSentiment === 'critical' ? 'Crítico' : 'Neutral'}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex gap-3 shrink-0">
                  <button
                    onClick={() => window.open(`mailto:${selectedAdvisor.email}?subject=Feedback de Auditoría SmartFlow`, '_blank')}
                    className="flex-1 py-3 bg-[#1877F2] hover:bg-blue-600 text-white rounded-xl text-xs font-black shadow-sm shadow-[#1877F2]/20 transition-colors">
                    Enviar feedback
                  </button>
                  <button onClick={() => window.print()}
                    className="px-4 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-black transition-colors">
                    Imprimir
                  </button>
                </div>
              </motion.div>
            </>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};
