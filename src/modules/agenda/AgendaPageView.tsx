import { useEffect, useState } from 'react';
import { useAgendaStore } from '@/stores/agendaStore';
import { useLeadStore } from '@/stores/leadStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { AgendaItem } from '@/types';
import { Plus, Calendar as CalendarIcon, List, CheckCircle2, Circle, Clock, MapPin, User as UserIcon, CalendarX2, Loader2, AlertCircle, Pencil } from 'lucide-react';
import { format, isSameDay, addDays } from 'date-fns';
import { AgendaModal } from './components/AgendaModal';

export const AgendaPageView = () => {
  const { items, updateItem, subscribe, isLoading, error } = useAgendaStore();
  const { leads } = useLeadStore();
  const { activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  
  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribe = subscribe(activeMembership.tenantId);
      return () => unsubscribe();
    }
  }, [activeMembership?.tenantId, subscribe]);
  
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<AgendaItem>>({
    title: '',
    type: 'seguimiento',
    date: new Date().toISOString().slice(0, 16),
    leadId: '',
    isCompleted: false,
  });
  const handleEditItem = (item: AgendaItem) => {
    setFormData({
      id: item.id,
      title: item.title,
      type: item.type,
      date: new Date(item.date).toISOString().slice(0, 16),
      leadId: item.leadId || '',
      isCompleted: item.isCompleted,
    });
    setIsModalOpen(true);
  };

  const handleCreateNew = () => {
    setFormData({
      title: '',
      type: 'seguimiento',
      date: new Date().toISOString().slice(0, 16),
      leadId: '',
      isCompleted: false,
    });
    setIsModalOpen(true);
  };
  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateItem(id, { isCompleted: !currentStatus });
    } catch (error) {
      addToast('Error al actualizar estado', 'error');
    }
  };

  // Mock Calendar setup
  const today = new Date();
  const calendarDays = Array.from({ length: 7 }).map((_, i) => addDays(today, i - 1));

  const getTypeColor = (type: AgendaItem['type']) => {
    switch(type) {
      case 'llamada': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
      case 'visita técnica': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400';
      case 'instalación': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
      default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Agenda</h1>
        <div className="flex space-x-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-primary-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'calendar' ? 'bg-white dark:bg-slate-700 shadow-sm text-primary-600 dark:text-primary-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <CalendarIcon className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleCreateNew}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nueva Actividad
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm relative min-h-[400px]">
           {isLoading && (
             <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 text-primary-500 animate-spin mb-4" />
                <p className="text-slate-500 font-medium animate-pulse text-lg">Sincronizando agenda...</p>
             </div>
           )}

           {error && (
             <div className="absolute inset-0 bg-white dark:bg-slate-900 z-30 flex flex-col items-center justify-center p-6 text-center">
               <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
                 <AlertCircle className="w-10 h-10 text-red-500" />
               </div>
               <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Error de Calendario</h3>
               <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
                 {error.includes('index') 
                   ? 'Falta un índice para ordenar los eventos de la agenda.' 
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
           {items.length === 0 ? (
             <div className="p-16 text-center flex flex-col items-center">
               <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-full mb-4">
                 <CalendarX2 className="w-8 h-8 text-slate-400" />
               </div>
               <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">Agenda Despejada</h3>
               <p className="text-sm text-slate-500 max-w-sm mb-4">No tienes actividades programadas. Utiliza la agenda para dar seguimiento a tus leads comerciales.</p>
             </div>
           ) : (
           <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(item => {
                const lead = leads.find(l => l.id === item.leadId);
                return (
                  <li key={item.id} className={`group p-4 sm:p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${item.isCompleted ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4">
                        <button onClick={() => toggleStatus(item.id, item.isCompleted)} className="mt-1 flex-shrink-0 text-slate-400 hover:text-primary-600 dark:hover:text-primary-400">
                          {item.isCompleted ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6" />}
                        </button>
                        <div>
                          <div className="flex items-center space-x-3 mb-1">
                            <h3 className={`font-semibold text-lg ${item.isCompleted ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-white'}`}>{item.title}</h3>
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${getTypeColor(item.type)}`}>
                              {item.type}
                            </span>
                          </div>
                          {lead && (
                            <div className="flex items-center space-x-4 text-sm text-slate-500 mt-2">
                              <span className="flex items-center"><UserIcon className="w-4 h-4 mr-1" /> {lead.name}</span>
                              <span className="flex items-center"><MapPin className="w-4 h-4 mr-1" /> {lead.city}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end gap-2">
                        <div className="flex items-center justify-end text-slate-600 dark:text-slate-300 font-medium bg-slate-100 dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                          <Clock className="w-4 h-4 mr-2 text-primary-500" />
                          {format(new Date(item.date), 'dd/MM/yyyy HH:mm')}
                        </div>
                        <button 
                          onClick={() => handleEditItem(item)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-xs font-medium text-slate-500 hover:text-primary-600 dark:hover:text-primary-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-md"
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1.5" /> Editar
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
           </ul>
           )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm p-4">
          <div className="grid grid-cols-7 gap-4">
             {calendarDays.map((date, i) => {
               const dayItems = items.filter(item => isSameDay(new Date(item.date), date));
               const isToday = isSameDay(date, today);
               return (
                 <div key={i} className={`min-h-[150px] border border-slate-200 dark:border-slate-700 rounded-lg p-2 ${isToday ? 'bg-primary-50 dark:bg-primary-900/10 border-primary-300 dark:border-primary-800' : 'bg-slate-50 dark:bg-slate-900/50'}`}>
                   <p className={`text-xs font-bold mb-2 ${isToday ? 'text-primary-600 dark:text-primary-400' : 'text-slate-500'}`}>
                     {format(date, 'EEEE dd')}
                   </p>
                   <div className="space-y-2">
                      {dayItems.map(item => (
                        <div key={item.id} className={`group relative p-1.5 rounded text-xs truncate cursor-pointer ${getTypeColor(item.type)} border border-black/5 dark:border-white/5 transition-colors hover:ring-1 hover:ring-primary-500/50`} onClick={() => handleEditItem(item)}>
                          <span className={item.isCompleted ? 'line-through opacity-70' : ''}>{format(new Date(item.date), 'HH:mm')} {item.title}</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); toggleStatus(item.id, item.isCompleted); }}
                            className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 hover:scale-110 transition-all p-0.5"
                            title={item.isCompleted ? "Marcar como pendiente" : "Marcar como completada"}
                          >
                            {item.isCompleted ? <Circle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                          </button>
                        </div>
                      ))}
                   </div>
                 </div>
               );
             })}
          </div>
        </div>
      )}

      <AgendaModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        initialData={formData} 
      />
    </div>
  );
};
