import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useLeadStore } from '@/stores/leadStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import {
  Plus, Phone, MapPin, DollarSign, Loader2, AlertCircle,
  MessageCircle, Calendar, Edit2, Trash2, Filter, Search,
  MessageSquare, GitMerge, X, Save, Sparkles, ArrowRight, MoreVertical
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { es } from 'date-fns/locale';
import { Lead } from '@/types';
import { AgendaModal } from '../agenda/components/AgendaModal';
import { useSettingsStore } from '@/stores/settingsStore';
import { PipelineEditor } from '../settings/PipelineEditor';
import { PipelineStage } from '@/services/firebase/SettingsService';
import { toDateSafe } from '@/utils/dateUtils';

const getSourceStyles = (source: string) => {
  switch (source?.toLowerCase()) {
    case 'whatsapp': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'facebook': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'messenger': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400';
    case 'instagram': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
    default: return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
};

const getSourceIcon = (source: string) => {
  switch (source?.toLowerCase()) {
    case 'whatsapp': return <MessageCircle className="w-2.5 h-2.5" />;
    case 'facebook': return <MessageSquare className="w-2.5 h-2.5" />;
    case 'messenger': return <MessageSquare className="w-2.5 h-2.5" />;
    case 'instagram': return <MessageSquare className="w-2.5 h-2.5" />;
    default: return <Search className="w-2.5 h-2.5" />;
  }
};

export const CRMPageView = () => {
  const { leads, moveLead, subscribe, isLoading, error, createLead, seedLeads } = useLeadStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const navigate = useNavigate();
  const [isSeeding, setIsSeeding] = useState(false);
  const [agentFilter, setAgentFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [agents, setAgents] = useState<{id: string, name: string}[]>([]);
  const [agendaModalLead, setAgendaModalLead] = useState<Lead | null>(null);
  const [initialAgendaData, setInitialAgendaData] = useState({});
  const [isPipelineModalOpen, setIsPipelineModalOpen] = useState(false);
  const [tempPipeline, setTempPipeline] = useState<PipelineStage[]>([]);
  // Vista compacta mobile: una sola etapa visible a la vez (ver handleChangeLeadStage / getStageLeads)
  const [mobileStage, setMobileStage] = useState<string | null>(null);
  const [actionSheetLead, setActionSheetLead] = useState<Lead | null>(null);

  const { commercial, pipeline, subscribe: subscribeSettings, updateSettings } = useSettingsStore();
  const currency = commercial?.currency || 'MX';

  // Etapas dinámicas desde los settings del tenant, ordenadas por orden
  const stages = (pipeline?.stages ?? []).slice().sort((a, b) => a.order - b.order);
  
  // Solución para compatibilidad de hydration con hello-pangea/dnd si se usa StrictMode
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const animation = requestAnimationFrame(() => setEnabled(true));
    return () => {
      cancelAnimationFrame(animation);
      setEnabled(false);
    };
  }, []);

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribeLeads = subscribe(activeMembership.tenantId);
      const unsubscribeSettings = subscribeSettings(activeMembership.tenantId);
      
      // Cargar Agentes
      const loadAgents = async () => {
        try {
          const { collection, query, where, getDocs } = await import('firebase/firestore');
          const { db } = await import('@/lib/firebase');
          const q = query(collection(db, 'memberships'), where('tenantId', '==', activeMembership.tenantId));
          const snap = await getDocs(q);
          const agentList = snap.docs.map(doc => ({
            id: doc.data().userId,
            name: doc.data().userName || 'Agente'
          }));
          setAgents(agentList);
        } catch (e) {
          console.error("Error loading agents:", e);
        }
      };

      loadAgents();

      return () => {
        unsubscribeLeads();
        unsubscribeSettings();
      };
    }
  }, [activeMembership?.tenantId, subscribe, subscribeSettings]);

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination || !activeMembership?.tenantId) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    try {
      await moveLead(
        activeMembership.tenantId, 
        draggableId, 
        source.droppableId,
        destination.droppableId,
        destination.index
      );
    } catch (error) {
      addToast('Error al mover lead. Reintenta.', 'error');
    }
  };

  const handleEditLead = async (lead: Lead) => {
    const newName = window.prompt('Nombre del cliente:', lead.name);
    if (!newName) return;
    const newPhone = window.prompt('Teléfono:', lead.phone);
    if (!newPhone) return;
    
    try {
      const { updateLead } = useLeadStore.getState();
      await updateLead(lead.id, { name: newName, phone: newPhone });
      addToast('Lead actualizado', 'success');
    } catch (e) {
      addToast('Error al actualizar', 'error');
    }
  };

  const handleDeleteLead = async (lead: Lead) => {
    const confirm1 = window.confirm(`¿Seguro que deseas ELIMINAR a ${lead.name}?\nEsta acción no se puede deshacer.`);
    if (!confirm1) return;
    
    const confirm2 = window.prompt(`Para confirmar, escribe el nombre del cliente: ${lead.name}`);
    if (confirm2 !== lead.name) {
      addToast('El nombre no coincide. Eliminación cancelada.', 'info');
      return;
    }

    try {
      const { deleteLead } = useLeadStore.getState();
      await deleteLead(lead.id);
      addToast('Lead eliminado permanentemente', 'success');
    } catch (e) {
      addToast('Error al eliminar lead', 'error');
    }
  };

  const handleNewLead = async () => {
    if (!activeMembership?.tenantId) return;
    const name = window.prompt('Nombre del nuevo lead:');
    if (!name) return;
    const phone = window.prompt('WhatsApp / Celular:', '52');
    if (!phone) return;
    const city = window.prompt('Ciudad:', 'México');
    if (!city) return;
    
    try {
      await createLead(activeMembership.tenantId, {
        name,
        phone,
        city,
        keyData: `$0 ${currency}`,
        stage: stages.find(s => s.isDefault)?.label ?? stages[0]?.label ?? 'Nuevo',
        advisorId: activeMembership.userId || 'unassigned',
        source: 'WhatsApp'
      });
      addToast('Lead creado!', 'success');
    } catch (e) {
      addToast('Error al crear lead', 'error');
    }
  };

  const handleOpenAgenda = (lead: Lead) => {
    setAgendaModalLead(lead);
    
    // Calcular fecha predictiva
    const now = new Date();
    if (now.getHours() >= 18) {
      // Mañana a las 9am
      now.setDate(now.getDate() + 1);
      now.setHours(9, 0, 0, 0);
    } else {
      // Hoy + 1 hora, redondeado al próximo múltiplo de 30 mins
      now.setHours(now.getHours() + 1);
      const minutes = now.getMinutes();
      const roundedMinutes = minutes < 30 ? 30 : 60;
      if (roundedMinutes === 60) {
        now.setHours(now.getHours() + 1);
        now.setMinutes(0);
      } else {
        now.setMinutes(30);
      }
    }
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localIso = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
    
    setInitialAgendaData({
      title: `Visita Técnica: ${lead.name}`,
      date: localIso,
      type: 'visita técnica',
      leadId: lead.id
    });
  };

  const handleSeed = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSeeding(true);
    try {
      await seedLeads(activeMembership.tenantId);
      addToast('Leads semilla inyectados', 'success');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleOpenPipeline = () => {
    setTempPipeline(pipeline?.stages || []);
    setIsPipelineModalOpen(true);
  };

  const handleSavePipeline = async () => {
    if (!activeMembership?.tenantId) return;
    try {
      await updateSettings(activeMembership.tenantId, {
        pipeline: { stages: tempPipeline }
      });
      setIsPipelineModalOpen(false);
      addToast('Pipeline actualizado correctamente', 'success');
    } catch (error) {
      addToast('Error al guardar el pipeline', 'error');
    }
  };

  const handleChangeLeadStage = async (lead: Lead, newStage: string) => {
    if (!activeMembership?.tenantId || lead.stage === newStage) return;
    try {
      // Mover al final de la nueva etapa
      const stageLeads = leads.filter(l => l.stage === newStage);
      await moveLead(activeMembership.tenantId, lead.id, lead.stage, newStage, stageLeads.length);
      addToast(`Lead movido a ${newStage}`, 'success');
    } catch (error) {
      addToast('Error al cambiar etapa', 'error');
    }
  };

  // Mismo filtro (agente + búsqueda) y orden que ya usaba cada columna del Kanban desktop —
  // extraído para reutilizarlo también en el selector de etapas y la lista compacta de mobile.
  const getStageLeads = (stageLabel: string) => leads
    .filter(l => l.stage === stageLabel)
    .filter(l => {
      if (agentFilter === 'all') return true;
      if (agentFilter === 'unassigned') return !l.advisorId || l.advisorId === 'unassigned';
      return l.advisorId === agentFilter;
    })
    .filter(l => {
      if (!searchQuery) return true;
      const search = searchQuery.toLowerCase();
      return l.name.toLowerCase().includes(search) || l.phone.includes(search);
    })
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const formatLeadActivity = (value: string) => {
    const d = toDateSafe(value);
    if (!d) return 'Sin actividad';
    return formatDistanceToNowStrict(d, { addSuffix: true, locale: es });
  };

  const activeMobileStage = mobileStage && stages.some(s => s.label === mobileStage)
    ? mobileStage
    : (stages[0]?.label ?? '');
  const mobileStageLeads = activeMobileStage ? getStageLeads(activeMobileStage) : [];

  if (!enabled) return null;

  return (
    <div className="flex flex-col md:h-[calc(100vh-8rem)]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0 mb-4 md:mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">CRM / Pipeline</h1>
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 w-full md:w-auto">
          <div className="relative group w-full md:w-auto">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-[#1877F2] transition-colors" />
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all appearance-none w-full md:w-auto md:min-w-[180px] shadow-sm"
            >
               <option value="all">👥 Todos los Agentes</option>
               <option value="unassigned">👤 Sin Asignar</option>
               {agents.map(agent => (
                 <option key={agent.id} value={agent.id}>👤 {agent.name}</option>
               ))}
            </select>
          </div>

          <div className="relative group w-full md:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-[#1877F2] transition-colors" />
            <input
              type="text"
              placeholder="Buscar por nombre o celular..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all w-full md:w-auto md:min-w-[240px] shadow-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleNewLead}
              className="flex-1 md:flex-none bg-[#1877F2] hover:bg-blue-700 text-white px-6 py-2 rounded-xl text-sm font-black transition-all flex items-center justify-center shadow-lg shadow-blue-600/20 uppercase tracking-widest"
            >
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Lead
            </button>
            <button
              onClick={handleOpenPipeline}
              className="p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-300 hover:text-[#1877F2] transition-all shadow-sm"
              title="Configurar Pipeline"
            >
              <GitMerge className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* ═══ DESKTOP / TABLET (md+) — Kanban sin cambios de comportamiento ═══ */}
      <div className="hidden md:block flex-1 overflow-x-auto pb-6 relative custom-scrollbar">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center">
             <Loader2 className="w-12 h-12 text-[#1877F2] animate-spin mb-4" />
             <p className="text-slate-500 font-medium animate-pulse text-lg">Sincronizando pipeline...</p>
          </div>
        )}
        
        {error && (
          <div className="absolute inset-0 bg-white dark:bg-slate-900 z-30 flex flex-col items-center justify-center p-6 text-center">
            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Error en Pipeline</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
              {error.includes('index') 
                ? 'Falta un índice para organizar los leads. Por favor reintenta en un momento.' 
                : error}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-6 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Reintentar
            </button>
          </div>
        )}
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex space-x-4 h-full items-start">
            {stages.map((stageObj) => {
              const stage = stageObj.label;
              const stageLeads = getStageLeads(stage);

              return (
                <div key={stageObj.id} className="w-80 shrink-0 flex flex-col h-full bg-slate-100/50 dark:bg-slate-800/30 rounded-xl">
                  <div className="p-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700/50">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stageObj.color }} />
                      <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">{stage}</h3>
                    </div>
                    <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold px-2 py-0.5 rounded-full">
                      {stageLeads.length}
                    </span>
                  </div>

                  <Droppable droppableId={stage}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 overflow-y-auto p-3 space-y-3 transition-colors ${
                          snapshot.isDraggingOver ? 'bg-slate-200/50 dark:bg-slate-800/80' : ''
                        }`}
                      >
                        {stageLeads.map((lead, index) => (
                          <Draggable key={lead.id} draggableId={lead.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 group ${
                                  snapshot.isDragging ? 'shadow-lg ring-2 ring-primary-500/50' : 'hover:shadow-md'
                                }`}
                                style={{ ...provided.draggableProps.style }}
                              >
                                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter mb-2 ${getSourceStyles(lead.source)}`}>
                                  {getSourceIcon(lead.source)}
                                  {lead.source}
                                </div>
                                <div className="flex justify-between items-start mb-1">
                                  <div className="flex items-center gap-2 pr-2 overflow-hidden">
                                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{lead.name}</div>
                                     {(lead.aiScore !== undefined || lead.aiPropensity !== undefined) && (
                                       <div 
                                         className={`px-1.5 py-0.5 rounded text-[10px] font-black flex items-center gap-1 shrink-0 cursor-help ${
                                           (lead.aiPropensity || lead.aiScore || 0) >= 80 ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 
                                           (lead.aiPropensity || lead.aiScore || 0) >= 50 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 
                                           'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                                         }`}
                                         title={lead.aiScoreReason || 'SmartFlow Brain Propensity'}
                                       >
                                         {lead.aiSentiment === 'positive' ? '😍' : 
                                          lead.aiSentiment === 'critical' ? '😡' : 
                                          (lead.aiPropensity || lead.aiScore || 0) >= 80 ? '🔥' : '❄️'} 
                                         {lead.aiPropensity || lead.aiScore}%
                                       </div>
                                     )}
                                   </div>
                                  <div className="flex space-x-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button 
                                      onClick={() => navigate(`/conversaciones?leadId=${lead.id}`)}
                                      className="p-1.5 bg-green-50 text-green-600 hover:bg-green-100 rounded-md transition-colors"
                                      title="Abrir WhatsApp"
                                    >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => handleOpenAgenda(lead)}
                                      className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"
                                      title="Agendar Cita"
                                    >
                                      <Calendar className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => handleEditLead(lead)}
                                      className="p-1.5 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                                      title="Editar Lead"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {lead.aiNextStep && (
                                  <div className="mb-3 px-3 py-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 rounded-xl flex items-center gap-2 group/step cursor-pointer hover:bg-primary-100 transition-all">
                                    <Sparkles className="w-3 h-3 text-[#1877F2] animate-pulse" />
                                    <span className="text-[10px] font-black text-primary-700 dark:text-primary-300 uppercase tracking-tighter">
                                      IA: {lead.aiNextStep}
                                    </span>
                                    <ArrowRight className="w-3 h-3 text-primary-400 ml-auto group-hover/step:translate-x-1 transition-transform" />
                                  </div>
                                )}

                                <div className="mb-4">
                                  <select
                                    value={lead.stage}
                                    onChange={(e) => handleChangeLeadStage(lead, e.target.value)}
                                    className="w-full text-[11px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-slate-600 dark:text-slate-400 outline-none focus:ring-1 focus:ring-[#1877F2]/30 transition-all appearance-none cursor-pointer hover:border-[#1877F2]/50"
                                  >
                                    {stages.map(s => (
                                      <option key={s.id} value={s.label}>{s.label}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                  <div className="flex items-center"><Phone className="w-3 h-3 justify-center mr-1.5" />{lead.phone}</div>
                                  <div className="flex items-center"><MapPin className="w-3 h-3 justify-center mr-1.5" />{lead.city}</div>
                                  <div className="flex items-center text-[#1877F2] dark:text-primary-400 font-medium mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 relative">
                                    <DollarSign className="w-3 h-3 justify-center mr-1" />
                                    {lead.keyData === 'Pendiente de calificar' ? 'Pendiente de cotizar' : lead.keyData}
                                    
                                    <button 
                                      onClick={() => handleDeleteLead(lead)}
                                      className="absolute right-0 bottom-0 p-1.5 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                      title="Eliminar Lead"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>
        </DragDropContext>
      </div>

      {/* ═══ MOBILE (< md) — una sola etapa a la vez, sin drag & drop ═══ */}
      <div className="md:hidden flex-1 flex flex-col min-h-0">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mb-3" />
            <p className="text-slate-500 text-sm">Sincronizando pipeline...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
              {error.includes('index') ? 'Falta un índice para organizar los leads. Reintentá en un momento.' : error}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-5 py-2 rounded-lg text-sm font-medium"
            >
              Reintentar
            </button>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Selector compacto de etapas — único que puede tener scroll horizontal */}
            <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory pb-2 mb-3 -mx-4 px-4">
              {stages.map(stageObj => {
                const count = getStageLeads(stageObj.label).length;
                const isActive = activeMobileStage === stageObj.label;
                return (
                  <button
                    key={stageObj.id}
                    onClick={() => setMobileStage(stageObj.label)}
                    className={`shrink-0 snap-start px-3.5 py-2 rounded-full text-xs font-bold border transition-all ${
                      isActive
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                    style={isActive ? { backgroundColor: stageObj.color } : undefined}
                  >
                    {stageObj.label} <span className="opacity-80">· {count}</span>
                  </button>
                );
              })}
            </div>

            {/* Tarjetas compactas de la etapa seleccionada */}
            <div className="flex-1 overflow-y-auto space-y-2 pb-4">
              {mobileStageLeads.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-6">Sin leads en esta etapa</p>
              ) : (
                mobileStageLeads.map(lead => (
                  <div
                    key={lead.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActionSheetLead(lead)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setActionSheetLead(lead); }}
                    className="w-full text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-3 flex items-start gap-2 active:bg-slate-50 dark:active:bg-slate-700/40 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{lead.name}</p>
                        {(lead.aiPropensity !== undefined || lead.aiScore !== undefined) && (
                          <span className="shrink-0 text-[11px]" title={lead.aiScoreReason}>
                            {lead.aiSentiment === 'positive' ? '😍' :
                             lead.aiSentiment === 'critical' ? '😡' :
                             (lead.aiPropensity || lead.aiScore || 0) >= 80 ? '🔥' : '❄️'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{lead.phone}</p>
                      <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="shrink-0">{formatLeadActivity(lead.lastActivity)}</span>
                        <span className="truncate">
                          Asesor: {agents.find(a => a.id === lead.advisorId)?.name || 'Sin asignar'}
                        </span>
                      </div>
                      {lead.keyData && lead.keyData !== 'Pendiente de calificar' && (
                        <p className="text-xs font-bold text-[#1877F2] dark:text-primary-400 mt-1">{lead.keyData}</p>
                      )}
                    </div>
                    <MoreVertical className="w-4 h-4 text-slate-300 shrink-0 mt-0.5" />
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Action sheet mobile — reutiliza los mismos handlers del desktop (cambiar etapa, agendar, editar, eliminar) */}
      {actionSheetLead && (
        <div
          className="md:hidden fixed inset-0 z-[110] flex items-end"
          onClick={() => setActionSheetLead(null)}
        >
          <div className="absolute inset-0 bg-slate-900/50" />
          <div
            className="relative w-full bg-white dark:bg-slate-800 rounded-t-3xl p-4 shadow-2xl animate-in slide-in-from-bottom duration-200"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mb-4" />
            <div className="mb-3 px-1">
              <p className="font-bold text-sm text-slate-900 dark:text-white">{actionSheetLead.name}</p>
              <p className="text-xs text-slate-400">{actionSheetLead.phone}</p>
            </div>

            <button
              onClick={() => { navigate(`/conversaciones?leadId=${actionSheetLead.id}`); setActionSheetLead(null); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              <MessageCircle className="w-4 h-4 text-green-600" /> Abrir conversación
            </button>

            <div className="px-3 py-2">
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Cambiar etapa</label>
              <select
                value={actionSheetLead.stage}
                onChange={(e) => { handleChangeLeadStage(actionSheetLead, e.target.value); setActionSheetLead(null); }}
                className="w-full text-sm font-bold bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 outline-none"
              >
                {stages.map(s => (
                  <option key={s.id} value={s.label}>{s.label}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => { handleOpenAgenda(actionSheetLead); setActionSheetLead(null); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              <Calendar className="w-4 h-4 text-blue-600" /> Agendar cita
            </button>
            <button
              onClick={() => { handleEditLead(actionSheetLead); setActionSheetLead(null); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 text-sm font-semibold text-slate-700 dark:text-slate-200"
            >
              <Edit2 className="w-4 h-4 text-slate-500" /> Editar
            </button>
            <button
              onClick={() => { handleDeleteLead(actionSheetLead); setActionSheetLead(null); }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-sm font-semibold text-red-600"
            >
              <Trash2 className="w-4 h-4" /> Eliminar
            </button>

            <button
              onClick={() => setActionSheetLead(null)}
              className="w-full mt-2 py-3 text-sm font-bold text-slate-400"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <AgendaModal
        isOpen={!!agendaModalLead}
        onClose={() => setAgendaModalLead(null)}
        initialData={initialAgendaData}
        forcedLead={agendaModalLead!}
      />

      {/* Modal de Configuración de Pipeline */}
      {isPipelineModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="bg-[#1877F2] p-6 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <GitMerge className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Configurar Pipeline</h3>
                  <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest">Personaliza tus etapas de venta</p>
                </div>
              </div>
              <button onClick={() => setIsPipelineModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 max-h-[70vh] overflow-y-auto scrollbar-hide">
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-3 mb-6">
                <span className="text-lg">⚡</span>
                <span className="font-bold uppercase tracking-tight">Cambiar el orden o los nombres de las etapas reorganizará tus leads automáticamente.</span>
              </div>

              <PipelineEditor 
                stages={tempPipeline}
                onChange={setTempPipeline}
              />
            </div>

            <div className="p-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex gap-3">
              <button
                onClick={() => setIsPipelineModalOpen(false)}
                className="flex-1 py-3.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-all uppercase tracking-widest"
              >
                Cancelar
              </button>
              <button
                onClick={handleSavePipeline}
                className="flex-[2] py-3.5 bg-[#1877F2] hover:bg-blue-700 text-white rounded-xl text-sm font-black transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2 uppercase tracking-widest"
              >
                <Save className="w-4 h-4" />
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
