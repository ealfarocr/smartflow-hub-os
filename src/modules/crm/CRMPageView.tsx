import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useLeadStore } from '@/stores/leadStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { CRMStage } from '@/types';
import { Plus, Phone, MapPin, DollarSign, Loader2, AlertCircle, MessageCircle, Calendar } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lead } from '@/types';
import { AgendaModal } from '../agenda/components/AgendaModal';
import { useSettingsStore } from '@/stores/settingsStore';

const STAGES: CRMStage[] = [
  'Nuevo',
  'Seguimiento',
  'Visita Técnica',
  'Venta Realizada'
];

export const CRMPageView = () => {
  const { leads, moveLead, subscribe, isLoading, error, createLead, seedLeads } = useLeadStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const navigate = useNavigate();
  const [isSeeding, setIsSeeding] = useState(false);
  const [agendaModalLead, setAgendaModalLead] = useState<Lead | null>(null);
  const [initialAgendaData, setInitialAgendaData] = useState({});
  const { commercial, subscribe: subscribeSettings } = useSettingsStore();
  const currency = commercial?.currency || 'MX';
  
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
        source.droppableId as CRMStage, 
        destination.droppableId as CRMStage, 
        destination.index
      );
    } catch (error) {
      addToast('Error al mover lead. Reintenta.', 'error');
    }
  };

  const handleNewLead = async () => {
    if (!activeMembership?.tenantId) return;
    const name = window.prompt('Nombre del nuevo lead:');
    if (!name) return;
    
    try {
      await createLead(activeMembership.tenantId, {
        name,
        phone: '5500000000',
        city: 'Ciudad de Prueba',
        keyData: `$0 ${currency}`,
        stage: 'Nuevo',
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

  if (!enabled) return null;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">CRM / Pipeline</h1>
        <div className="flex space-x-2">
          {leads.length === 0 && (
            <button 
              onClick={handleSeed}
              disabled={isSeeding}
              className="border border-dashed border-primary-500 text-primary-600 hover:bg-primary-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              {isSeeding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="h-4 h-4 mr-2" />}
              Inyectar Datos Prueba
            </button>
          )}
          <button 
            onClick={handleNewLead}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Lead
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4 scrollbar-hide relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center">
             <Loader2 className="w-12 h-12 text-primary-500 animate-spin mb-4" />
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
            {STAGES.map((stage) => {
              const stageLeads = leads
                .filter(l => l.stage === stage)
                .sort((a, b) => a.orderIndex - b.orderIndex);

              return (
                <div key={stage} className="w-80 shrink-0 flex flex-col h-full bg-slate-100/50 dark:bg-slate-800/30 rounded-xl">
                  <div className="p-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700/50">
                    <h3 className="font-semibold text-sm text-slate-700 dark:text-slate-300">{stage}</h3>
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
                                <div className="flex justify-between items-start mb-1">
                                  <div className="font-medium text-slate-900 dark:text-slate-100 pr-2">{lead.name}</div>
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
                                  </div>
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                                  <div className="flex items-center"><Phone className="w-3 h-3 justify-center mr-1.5" />{lead.phone}</div>
                                  <div className="flex items-center"><MapPin className="w-3 h-3 justify-center mr-1.5" />{lead.city}</div>
                                  <div className="flex items-center text-primary-600 dark:text-primary-400 font-medium mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                                    <DollarSign className="w-3 h-3 justify-center mr-1" />
                                    {lead.keyData === 'Pendiente de calificar' ? 'Pendiente de cotizar' : lead.keyData}
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

      <AgendaModal
        isOpen={!!agendaModalLead}
        onClose={() => setAgendaModalLead(null)}
        initialData={initialAgendaData}
        forcedLead={agendaModalLead!}
      />
    </div>
  );
};
