import { useState, useEffect } from 'react';
import { useAgendaStore } from '@/stores/agendaStore';
import { useLeadStore } from '@/stores/leadStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { AgendaItem, Lead } from '@/types';

interface AgendaModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: Partial<AgendaItem>;
  forcedLead?: Lead;
}

export const AgendaModal = ({ isOpen, onClose, initialData, forcedLead }: AgendaModalProps) => {
  const { addItem, updateItem } = useAgendaStore();
  const { leads } = useLeadStore();
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  
  const [formData, setFormData] = useState<Partial<AgendaItem>>({
    title: '',
    type: 'seguimiento',
    date: new Date().toISOString().slice(0, 16),
    leadId: '',
    isCompleted: false,
  });

  useEffect(() => {
    if (isOpen) {
      setFormData({
        title: initialData?.title || '',
        type: initialData?.type || 'seguimiento',
        date: initialData?.date || new Date().toISOString().slice(0, 16),
        leadId: initialData?.leadId || '',
        isCompleted: false,
      });
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const isEdit = !!initialData?.id;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId || !user?.id) return;

    if (typeof formData.title === 'string' && formData.title.trim() === '') {
       addToast('El título no puede estar vacío', 'error');
       return;
    }

    try {
      const formattedData = {
        ...(formData as any),
        title: formData.title?.trim() || '',
        date: new Date(formData.date!).toISOString()
      };

      if (isEdit && initialData?.id) {
        await updateItem(initialData.id, formattedData);
        addToast('Actividad actualizada correctamente', 'success');
      } else {
        await addItem(activeMembership.tenantId, user.id, formattedData);
        addToast('Actividad agregada a la agenda', 'success');
      }
      
      onClose();
    } catch (error) {
      addToast('Error al guardar la actividad', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm shadow-2xl">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {isEdit ? 'Editar Actividad' : 'Nueva Actividad'}
          </h3>
        </div>
        <div className="p-6">
          <form id="agenda-form" onSubmit={handleSave} className="space-y-4">
            {forcedLead && (
              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-sm mb-4">
                <p className="text-slate-500 dark:text-slate-400">Pautando cita para:</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">{forcedLead.name}</p>
                <div className="flex items-center mt-1 text-slate-500">
                  Tel: {forcedLead.phone}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título</label>
              <input required type="text" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo</label>
              <select required value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                <option value="llamada">Llamada</option>
                <option value="seguimiento">Seguimiento</option>
                <option value="visita técnica">Visita Técnica</option>
                <option value="instalación">Instalación</option>
                <option value="recordatorio">Recordatorio</option>
                <option value="tarea interna">Tarea Interna</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Fecha y Hora</label>
              <input required type="datetime-local" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
            </div>
            {!forcedLead && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Asociar a Lead (Opcional)</label>
                <select value={formData.leadId} onChange={e => setFormData({...formData, leadId: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                  <option value="">Ninguno</option>
                  {leads.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
          </form>
        </div>
        <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">Cancelar</button>
          <button type="submit" form="agenda-form" className="px-5 py-2.5 text-sm font-medium text-white bg-[#1877F2] hover:bg-primary-700 rounded-lg transition-colors shadow-lg shadow-primary-500/30">
            {isEdit ? 'Guardar Cambios' : 'Guardar Actividad'}
          </button>
        </div>
      </div>
    </div>
  );
};
