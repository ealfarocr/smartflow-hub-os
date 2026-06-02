import React, { useState } from 'react';
import { PipelineStage } from '@/services/firebase/SettingsService';
import { Plus, GripVertical, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

interface Props {
  stages: PipelineStage[];
  onChange: (stages: PipelineStage[]) => void;
}

export const PipelineEditor: React.FC<Props> = ({ stages, onChange }) => {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const moveStage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= stages.length) return;
    const copy = [...stages];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy.map((s, i) => ({ ...s, order: i })));
  };

  const updateStage = (id: string, patch: Partial<PipelineStage>) => {
    onChange(stages.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const addStage = () => {
    const newId = `stage-${Date.now()}`;
    onChange([...stages, {
      id: newId,
      label: 'Nueva Etapa',
      order: stages.length,
      color: '#6b7280',
      isDefault: false,
      isClosed: false,
    }]);
  };

  const removeStage = (id: string) => {
    onChange(stages.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })));
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {stages.map((stage, idx) => (
          <div key={stage.id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 group">
            {/* Drag handle visual + reorder buttons */}
            <div className="flex flex-col gap-0.5 text-slate-400">
              <button onClick={() => moveStage(idx, -1)} disabled={idx === 0} className="hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-20 p-0.5">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <GripVertical className="w-4 h-4 mx-auto" />
              <button onClick={() => moveStage(idx, 1)} disabled={idx === stages.length - 1} className="hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-20 p-0.5">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Color */}
            <input
              type="color"
              value={stage.color}
              onChange={e => updateStage(stage.id, { color: e.target.value })}
              className="w-8 h-8 rounded-lg border border-slate-300 dark:border-slate-600 cursor-pointer appearance-none bg-transparent [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md"
            />

            {/* Label */}
            <input
              type="text"
              value={stage.label}
              onChange={e => updateStage(stage.id, { label: e.target.value })}
              className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm font-medium focus:ring-2 focus:ring-primary-500"
            />

            {/* Toggles */}
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer" title="Etapa por defecto para nuevos leads">
                <input type="checkbox" checked={stage.isDefault} onChange={e => {
                  // Solo uno puede ser default
                  if (e.target.checked) {
                    onChange(stages.map(s => ({ ...s, isDefault: s.id === stage.id })));
                  } else {
                    updateStage(stage.id, { isDefault: false });
                  }
                }} className="rounded border-slate-300 text-[#1877F2] focus:ring-primary-500" />
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Default</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer" title="Etapa de cierre (ganada/perdida)">
                <input type="checkbox" checked={stage.isClosed} onChange={e => updateStage(stage.id, { isClosed: e.target.checked })} className="rounded border-slate-300 text-[#1877F2] focus:ring-primary-500" />
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">Cierre</span>
              </label>
            </div>

            {/* Delete */}
            {confirmDelete === stage.id ? (
              <div className="flex items-center gap-1">
                <button onClick={() => removeStage(stage.id)} className="text-xs bg-red-500 text-white px-2 py-1 rounded font-medium hover:bg-red-600">Sí</button>
                <button onClick={() => setConfirmDelete(null)} className="text-xs bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded font-medium">No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(stage.id)} className="p-1.5 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Eliminar etapa">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <button onClick={addStage} className="w-full border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg py-3 text-sm font-medium text-slate-500 hover:text-[#1877F2] hover:border-primary-400 transition-colors flex items-center justify-center gap-2">
        <Plus className="w-4 h-4" /> Agregar Etapa
      </button>
    </div>
  );
};
