import { useState } from 'react';
import { X, Send, ChevronRight, MessageSquareText, Loader2, AlertCircle } from 'lucide-react';
import { WhatsappTemplate } from '@/types';

interface TemplateSelectorProps {
  templates: WhatsappTemplate[];
  contactName: string;
  onSend: (template: WhatsappTemplate, components: TemplateComponent[]) => Promise<void>;
  onClose: () => void;
}

export interface TemplateComponent {
  type: 'body';
  parameters: { type: 'text'; text: string }[];
}

/**
 * Panel selector de plantillas aprobadas de Meta.
 * Muestra la lista de plantillas activas, permite llenar variables
 * y genera un preview antes de enviar.
 */
export const TemplateSelector = ({ templates, contactName, onSend, onClose }: TemplateSelectorProps) => {
  const activeTemplates = templates.filter(t => t.isActive);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsappTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const handleSelectTemplate = (tpl: WhatsappTemplate) => {
    setSelectedTemplate(tpl);
    // Pre-fill first variable with contact name if it's likely a name field
    const defaults = tpl.variables.map((v, i) =>
      i === 0 && v.toLowerCase().includes('nombre') ? contactName : ''
    );
    setVariableValues(defaults);
    setSendError(null);
  };

  const buildPreview = (template: WhatsappTemplate, values: string[]) => {
    let preview = template.bodyPreview;
    template.variables.forEach((_, i) => {
      preview = preview.replace(`{{${i + 1}}}`, values[i] || `[${template.variables[i]}]`);
    });
    return preview;
  };

  const handleSend = async () => {
    if (!selectedTemplate) return;

    // Validate all variables are filled
    const hasEmpty = selectedTemplate.variables.some((_, i) => !variableValues[i]?.trim());
    if (hasEmpty) {
      setSendError('Por favor completa todos los campos de la plantilla.');
      return;
    }

    const components: TemplateComponent[] = selectedTemplate.variables.length > 0
      ? [{
          type: 'body',
          parameters: variableValues.map(text => ({ type: 'text', text }))
        }]
      : [];

    setIsSending(true);
    setSendError(null);
    try {
      await onSend(selectedTemplate, components);
      onClose();
    } catch (err: any) {
      setSendError(err.message || 'Error al enviar la plantilla.');
    } finally {
      setIsSending(false);
    }
  };

  const categoryLabel: Record<WhatsappTemplate['category'], string> = {
    UTILITY: 'Utilidad',
    MARKETING: 'Marketing',
    AUTHENTICATION: 'Autenticación',
  };

  const categoryColor: Record<WhatsappTemplate['category'], string> = {
    UTILITY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    MARKETING: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    AUTHENTICATION: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  };

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <MessageSquareText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">Plantilla aprobada por Meta</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">La ventana de 24h ha vencido · selecciona una plantilla</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selectedTemplate ? (
            /* Template List */
            <div className="p-4 space-y-2">
              {activeTemplates.length === 0 && (
                <div className="text-center py-10 text-slate-400">
                  <MessageSquareText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No hay plantillas activas configuradas.</p>
                  <p className="text-xs mt-1">Añade plantillas en Configuración → Plantillas.</p>
                </div>
              )}
              {activeTemplates.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => handleSelectTemplate(tpl)}
                  className="w-full text-left p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-all group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-sm text-slate-900 dark:text-white group-hover:text-primary-700 dark:group-hover:text-primary-400">
                      {tpl.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${categoryColor[tpl.category]}`}>
                        {categoryLabel[tpl.category]}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-primary-500 shrink-0" />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {tpl.bodyPreview}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">{tpl.metaTemplateName} · {tpl.languageCode}</p>
                </button>
              ))}
            </div>
          ) : (
            /* Template Detail + Variable Filling */
            <div className="p-5 space-y-5">
              <button
                onClick={() => setSelectedTemplate(null)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary-600 transition-colors"
              >
                ← Volver a plantillas
              </button>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-slate-900 dark:text-white">{selectedTemplate.name}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${categoryColor[selectedTemplate.category]}`}>
                    {categoryLabel[selectedTemplate.category]}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">{selectedTemplate.metaTemplateName} · {selectedTemplate.languageCode}</p>
              </div>

              {/* Variable fields */}
              {selectedTemplate.variables.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Completar Variables
                  </h4>
                  {selectedTemplate.variables.map((varLabel, i) => (
                    <div key={i}>
                      <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                        {`{{${i + 1}}}`} — {varLabel}
                      </label>
                      <input
                        type="text"
                        value={variableValues[i] || ''}
                        onChange={e => {
                          const next = [...variableValues];
                          next[i] = e.target.value;
                          setVariableValues(next);
                        }}
                        placeholder={varLabel}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Preview */}
              <div>
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
                  Vista Previa
                </h4>
                <div className="bg-[#efeae2] dark:bg-[#0b141a] rounded-xl p-4">
                  <div className="inline-block max-w-[85%] bg-white dark:bg-slate-800 rounded-lg rounded-tl-none p-3 shadow-sm">
                    <p className="text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                      {buildPreview(selectedTemplate, variableValues)}
                    </p>
                    <p className="text-[10px] text-slate-400 text-right mt-1">ahora · plantilla</p>
                  </div>
                </div>
              </div>

              {/* Error */}
              {sendError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {sendError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — Send button shown only when template is selected */}
        {selectedTemplate && (
          <div className="p-5 border-t border-slate-200 dark:border-slate-700 shrink-0">
            <button
              onClick={handleSend}
              disabled={isSending}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {isSending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando plantilla...</>
                : <><Send className="w-4 h-4" /> Enviar Plantilla</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
