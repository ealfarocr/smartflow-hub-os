import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Circle, Plus, Trash2, LayoutList,
  ChevronDown, ChevronRight, X, Pencil, Check, FolderPlus,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Task } from '@/types';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore';
import { useUIStore } from '@/stores/uiStore';

const PRIORITY_MAP = { high: 0, medium: 1, low: 2 };

interface SectionState {
  collapsed: boolean;
  addingTask: boolean;
  newTitle: string;
  newPriority: 'low' | 'medium' | 'high';
}

const PRIORITY_COLORS = {
  high:   { dot: 'bg-rose-500',   label: 'Alta',  pill: 'bg-rose-50 text-rose-500 border-rose-200'   },
  medium: { dot: 'bg-[#1877F2]',  label: 'Media', pill: 'bg-blue-50 text-[#1877F2] border-blue-200'  },
  low:    { dot: 'bg-slate-300',  label: 'Baja',  pill: 'bg-slate-50 text-slate-400 border-slate-200' },
};

const sectionIcon = (section: string) => {
  const s = section.toLowerCase();
  if (s.includes('llamad')) return '📞';
  if (s.includes('cotiz')) return '📄';
  if (s.includes('email') || s.includes('correo')) return '📧';
  if (s.includes('reuni') || s.includes('meeting')) return '📅';
  if (s.includes('pago') || s.includes('cobr')) return '💳';
  if (s.includes('venta')) return '🤝';
  return '📋';
};

export const TasksView = () => {
  const { activeMembership, user } = useAuthStore();
  const { tasks: settingsTasks, updateSettings, subscribe: subSettings } = useSettingsStore();
  const { addToast } = useUIStore();
  const [tasks, setTasks]   = useState<Task[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');

  const userId   = user?.id || (user as any)?.uid;
  const tenantId = activeMembership?.tenantId;

  const [sections, setSections]           = useState<string[]>([]);
  const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>({});

  const [addingSection, setAddingSection]   = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const newSectionRef = useRef<HTMLInputElement>(null);

  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [renameValue, setRenameValue]         = useState('');

  useEffect(() => {
    if (!tenantId || !userId) return;
    const unsubSettings = subSettings(tenantId);
    const q = query(
      collection(db, 'tasks'),
      where('tenantId', '==', tenantId),
      where('advisorId', '==', userId)
    );
    const unsubTasks = onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Task[]);
    });
    return () => { unsubSettings(); unsubTasks(); };
  }, [tenantId, userId]);

  useEffect(() => {
    const base = settingsTasks?.sections || [];
    const fromTasks = tasks.map(t => t.category || 'General').filter(Boolean);
    const all = Array.from(new Set([...base, ...fromTasks]));
    setSections(all);
    setSectionStates(prev => {
      const next = { ...prev };
      all.forEach(s => { if (!next[s]) next[s] = { collapsed: false, addingTask: false, newTitle: '', newPriority: 'medium' }; });
      return next;
    });
  }, [settingsTasks?.sections, tasks]);

  useEffect(() => { if (addingSection) newSectionRef.current?.focus(); }, [addingSection]);

  const getSectionState = (s: string): SectionState =>
    sectionStates[s] ?? { collapsed: false, addingTask: false, newTitle: '', newPriority: 'medium' };

  const patchSection = (s: string, patch: Partial<SectionState>) =>
    setSectionStates(prev => ({ ...prev, [s]: { ...getSectionState(s), ...patch } }));

  const handleAddTask = async (section: string, e: React.FormEvent) => {
    e.preventDefault();
    const uid = user?.id || (user as any)?.uid;
    const state = getSectionState(section);
    if (!state.newTitle.trim() || !tenantId || !uid) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        tenantId, title: state.newTitle.trim(),
        isCompleted: false, priority: state.newPriority,
        category: section, advisorId: uid,
        createdAt: new Date().toISOString(), serverTimestamp: serverTimestamp()
      });
      patchSection(section, { newTitle: '', addingTask: false });
      addToast('Tarea agregada', 'success');
    } catch { addToast('Error al agregar tarea', 'error'); }
  };

  const toggleTask  = async (task: Task) => {
    try { await updateDoc(doc(db, 'tasks', task.id), { isCompleted: !task.isCompleted }); } catch { /* silent */ }
  };
  const deleteTask  = async (id: string) => {
    if (!confirm('¿Eliminar esta tarea?')) return;
    try { await deleteDoc(doc(db, 'tasks', id)); } catch { /* silent */ }
  };

  const handleAddSection = async () => {
    const name = newSectionName.trim();
    if (!name || !tenantId) { setAddingSection(false); return; }
    if (!sections.includes(name)) {
      const newSections = [...(settingsTasks?.sections || []), name];
      await updateSettings(tenantId, { tasks: { sections: newSections } });
      addToast('Sección creada', 'success');
    }
    setNewSectionName(''); setAddingSection(false);
  };

  const handleRenameSection = async (old: string) => {
    const name = renameValue.trim();
    if (!name || name === old || !tenantId) { setRenamingSection(null); return; }
    try {
      await Promise.all(tasks.filter(t => (t.category || 'General') === old).map(t =>
        updateDoc(doc(db, 'tasks', t.id), { category: name })
      ));
      const newSections = (settingsTasks?.sections || []).map(s => s === old ? name : s);
      await updateSettings(tenantId, { tasks: { sections: newSections } });
      addToast('Sección renombrada', 'success');
    } catch { addToast('Error al renombrar', 'error'); }
    setRenamingSection(null);
  };

  const deleteSection = async (section: string) => {
    if (!tenantId) return;
    const sectionTasks = tasks.filter(t => (t.category || 'General') === section);
    const count = sectionTasks.length;
    const msg = count > 0
      ? `Esta sección tiene ${count} tarea(s). ¿Eliminar todo?`
      : `¿Eliminar la sección "${section}"?`;
    if (!confirm(msg)) return;
    try {
      if (count > 0) await Promise.all(sectionTasks.map(t => deleteDoc(doc(db, 'tasks', t.id))));
      const newSections = (settingsTasks?.sections || []).filter(s => s !== section);
      await updateSettings(tenantId, { tasks: { sections: newSections } });
      addToast('Sección eliminada', 'success');
    } catch { addToast('Error al eliminar', 'error'); }
  };

  const getFilteredTasks = (section: string) =>
    tasks
      .filter(t => (t.category || 'General') === section)
      .filter(t => filter === 'all' ? true : filter === 'pending' ? !t.isCompleted : t.isCompleted)
      .sort((a, b) => {
        const pd = PRIORITY_MAP[a.priority] - PRIORITY_MAP[b.priority];
        return pd !== 0 ? pd : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

  const totalPending   = tasks.filter(t => !t.isCompleted).length;
  const totalCompleted = tasks.filter(t => t.isCompleted).length;

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">

      {/* ── Header ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2.5 bg-[#1877F2] rounded-xl">
            <LayoutList className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-black text-slate-900 dark:text-white">Mis Tareas</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalPending} pendiente{totalPending !== 1 ? 's' : ''} · {totalCompleted} completada{totalCompleted !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Filtro */}
          <div className="flex bg-slate-100 dark:bg-slate-900 rounded-xl p-1 gap-1">
            {(['all', 'pending', 'completed'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                  filter === f ? 'bg-white dark:bg-slate-700 text-[#1877F2] shadow-sm' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {f === 'all' ? 'Todas' : f === 'pending' ? 'Pendientes' : 'Listas'}
              </button>
            ))}
          </div>
          {/* Nueva sección */}
          <button
            onClick={() => setAddingSection(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-700 hover:bg-[#1877F2] hover:text-white text-slate-500 dark:text-slate-300 rounded-xl text-xs font-bold transition-all"
            title="Nueva sección"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Sección</span>
          </button>
        </div>
      </div>

      {/* ── Nueva sección (inline) ── */}
      {addingSection && (
        <form
          onSubmit={e => { e.preventDefault(); handleAddSection(); }}
          className="flex items-center gap-3 px-5 py-4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border-2 border-[#1877F2]/30"
        >
          <span className="text-lg">📁</span>
          <input
            ref={newSectionRef}
            type="text"
            placeholder="Nombre de la sección (ej: Visitas, Seguimiento...)"
            value={newSectionName}
            onChange={e => setNewSectionName(e.target.value)}
            onKeyDown={e => e.key === 'Escape' && setAddingSection(false)}
            className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-300"
          />
          <button type="submit" disabled={!newSectionName.trim()}
            className="px-4 py-1.5 bg-[#1877F2] text-white text-xs font-bold rounded-xl disabled:opacity-40 hover:bg-blue-600 transition-colors"
          >
            Crear
          </button>
          <button type="button" onClick={() => { setAddingSection(false); setNewSectionName(''); }}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </form>
      )}

      {/* ── Secciones ── */}
      {sections.map(section => {
        const state        = getSectionState(section);
        const sectionTasks = getFilteredTasks(section);
        const allCount     = tasks.filter(t => (t.category || 'General') === section).length;
        const pendingCount = tasks.filter(t => (t.category || 'General') === section && !t.isCompleted).length;

        return (
          <div key={section} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">

            {/* Cabecera de sección */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-slate-700">
              <button
                onClick={() => patchSection(section, { collapsed: !state.collapsed })}
                className="text-slate-300 hover:text-slate-500 transition-colors shrink-0"
              >
                {state.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              <span className="text-base leading-none shrink-0">{sectionIcon(section)}</span>

              {renamingSection === section ? (
                <form onSubmit={e => { e.preventDefault(); handleRenameSection(section); }} className="flex items-center gap-2 flex-1">
                  <input
                    autoFocus value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    className="flex-1 text-sm font-bold text-slate-900 dark:text-white bg-transparent border-b-2 border-[#1877F2] outline-none"
                  />
                  <button type="submit" className="p-1 text-[#1877F2] hover:bg-blue-50 rounded-lg"><Check className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => setRenamingSection(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded-lg"><X className="w-3.5 h-3.5" /></button>
                </form>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{section}</span>
                  {pendingCount > 0 && (
                    <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 bg-[#1877F2]/10 text-[#1877F2] rounded-full">{pendingCount}</span>
                  )}
                  {allCount === 0 && (
                    <span className="shrink-0 text-[10px] text-slate-300">vacía</span>
                  )}
                </div>
              )}

              {renamingSection !== section && (
                <div className="flex items-center gap-1 ml-auto shrink-0">
                  <button onClick={() => { setRenamingSection(section); setRenameValue(section); }}
                    className="p-1.5 text-slate-300 hover:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-all" title="Renombrar">
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button onClick={() => deleteSection(section)}
                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all" title="Eliminar">
                    <Trash2 className="w-3 h-3" />
                  </button>
                  {/* Botón + siempre visible */}
                  <button
                    onClick={() => patchSection(section, { addingTask: !state.addingTask, collapsed: false })}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#1877F2]/10 hover:bg-[#1877F2] text-[#1877F2] hover:text-white rounded-xl text-xs font-bold transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tarea</span>
                  </button>
                </div>
              )}
            </div>

            {!state.collapsed && (
              <div>
                {/* Lista de tareas */}
                {sectionTasks.length > 0 && (
                  <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
                    {sectionTasks.map(task => (
                      <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task.id)} />
                    ))}
                  </div>
                )}

                {/* Estado vacío */}
                {sectionTasks.length === 0 && !state.addingTask && (
                  <div className="px-5 py-5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                      <Circle className="w-4 h-4 text-slate-300" />
                    </div>
                    <p className="text-xs text-slate-400">
                      {filter !== 'all' ? 'Sin tareas para este filtro' : 'Sin tareas · Creá la primera'}
                    </p>
                  </div>
                )}

                {/* Formulario agregar tarea */}
                {state.addingTask ? (
                  <form onSubmit={e => handleAddTask(section, e)}
                    className="flex items-center gap-3 px-5 py-3.5 bg-blue-50/40 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/20"
                  >
                    <Circle className="w-4 h-4 text-slate-300 shrink-0" />
                    <input
                      autoFocus type="text"
                      placeholder="Escribí la tarea..."
                      value={state.newTitle}
                      onChange={e => patchSection(section, { newTitle: e.target.value })}
                      className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-900 dark:text-white placeholder:text-slate-300"
                    />
                    {/* Prioridad */}
                    <div className="flex gap-1.5 shrink-0">
                      {(['high', 'medium', 'low'] as const).map(p => (
                        <button key={p} type="button" onClick={() => patchSection(section, { newPriority: p })}
                          title={PRIORITY_COLORS[p].label}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${
                            state.newPriority === p ? PRIORITY_COLORS[p].dot + ' border-transparent' : 'bg-transparent border-slate-200 dark:border-slate-600'
                          }`}
                        />
                      ))}
                    </div>
                    <button type="submit" disabled={!state.newTitle.trim()}
                      className="px-3 py-1.5 bg-[#1877F2] text-white text-xs font-bold rounded-xl disabled:opacity-40 hover:bg-blue-600 transition-colors shrink-0"
                    >
                      Agregar
                    </button>
                    <button type="button" onClick={() => patchSection(section, { addingTask: false, newTitle: '' })}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => patchSection(section, { addingTask: true })}
                    className="w-full flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-slate-400 hover:text-[#1877F2] hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-all border-t border-slate-50 dark:border-slate-700/50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Agregar tarea
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Botón nueva sección (al final) ── */}
      {!addingSection && (
        <button
          onClick={() => setAddingSection(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-400 hover:text-[#1877F2] hover:border-[#1877F2]/40 hover:bg-blue-50/20 dark:hover:bg-blue-900/10 transition-all"
        >
          <Plus className="w-4 h-4" />
          Nueva sección
        </button>
      )}

    </div>
  );
};

/* ── TaskRow ── */
const TaskRow = ({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) => (
  <div className={`group flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${task.isCompleted ? 'opacity-50' : ''}`}>
    <button onClick={onToggle}
      className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
        task.isCompleted ? 'bg-[#1877F2] border-[#1877F2]' : 'border-slate-300 dark:border-slate-600 hover:border-[#1877F2]'
      }`}
    >
      {task.isCompleted ? <CheckCircle2 className="w-4 h-4 text-white" /> : <Circle className="w-4 h-4 text-transparent" />}
    </button>

    <p className={`flex-1 text-sm font-medium text-slate-800 dark:text-white truncate ${task.isCompleted ? 'line-through text-slate-400' : ''}`}>
      {task.title}
    </p>

    <div className="flex items-center gap-2 shrink-0">
      <span
        title={PRIORITY_COLORS[task.priority]?.label}
        className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[task.priority]?.dot ?? 'bg-slate-300'}`}
      />
      <button onClick={onDelete}
        className="p-1.5 text-transparent group-hover:text-slate-300 hover:!text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
);
