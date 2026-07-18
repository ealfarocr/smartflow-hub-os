import { useState, useEffect, useRef } from 'react';
import { Bot, Globe, FileText, Trash2, Loader2, Save, Upload, Sparkles } from 'lucide-react';
import { GlobalAgentService, GlobalAgentConfig, GlobalAgentFile } from '@/services/firebase/GlobalAgentService';
import { useUIStore } from '@/stores/uiStore';

export const GlobalAgentView = () => {
  const { addToast } = useUIStore();
  const [config, setConfig] = useState<GlobalAgentConfig>({ generalInstructions: '', knowledgeFiles: [], mediaLibrary: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try { setConfig(await GlobalAgentService.get()); }
      catch { addToast('Error al cargar la base global.', 'error'); }
      finally { setIsLoading(false); }
    })();
  }, []);

  const saveInstructions = async () => {
    setIsSaving(true);
    try {
      await GlobalAgentService.save({ generalInstructions: config.generalInstructions });
      addToast('Instrucciones globales guardadas.', 'success');
    } catch { addToast('Error al guardar.', 'error'); }
    finally { setIsSaving(false); }
  };

  const handleUpload = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) { addToast('El archivo supera los 8MB.', 'error'); return; }
    setIsUploading(true);
    try {
      let content: string | undefined;
      try {
        const { extractTextFromFile } = await import('@/utils/pdfExtract');
        content = (await extractTextFromFile(file)).slice(0, 15000);
      } catch {
        if (['application/json', 'text/plain', 'text/csv'].includes(file.type)) content = await file.text();
      }
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('@/lib/firebase');
      const path = `agent-global/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);

      const newFile: GlobalAgentFile = { name: file.name, url, type: file.type || 'application/octet-stream', size: file.size, ...(content && { content }) };
      const updated = { ...config, knowledgeFiles: [...config.knowledgeFiles, newFile] };
      setConfig(updated);
      await GlobalAgentService.save({ knowledgeFiles: updated.knowledgeFiles });
      addToast(`✅ "${file.name}" agregado a la base global.`, 'success');
    } catch (e: any) {
      addToast(`Error: ${e?.message || 'No se pudo subir'}`, 'error');
    } finally { setIsUploading(false); }
  };

  const removeFile = async (idx: number) => {
    const updated = { ...config, knowledgeFiles: config.knowledgeFiles.filter((_, i) => i !== idx) };
    setConfig(updated);
    try { await GlobalAgentService.save({ knowledgeFiles: updated.knowledgeFiles }); }
    catch { addToast('Error al eliminar.', 'error'); }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-10 h-10 text-[#1877F2] animate-spin" /></div>;
  }

  const chars = config.generalInstructions.length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-2 sm:p-4">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1877F2] to-violet-600 rounded-3xl p-6 text-white shadow-xl shadow-blue-500/20">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 bg-white/20 rounded-2xl flex items-center justify-center"><Globe className="w-6 h-6" /></div>
          <div>
            <h1 className="text-xl font-black">Agente IA — Base Global</h1>
            <p className="text-white/80 text-xs font-bold uppercase tracking-widest">Aplica a TODOS los negocios · actuales y futuros</p>
          </div>
        </div>
        <p className="text-sm text-white/90 leading-relaxed">
          Lo que configures aquí entrena a <strong>todos</strong> los agentes del Hub automáticamente. Cada negocio lo combina con su propia información privada — nunca se mezcla entre negocios.
        </p>
      </div>

      {/* Instrucciones generales */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-violet-500" />
          <h2 className="text-base font-black text-slate-800 dark:text-white">Instrucciones generales de ventas</h2>
        </div>
        <p className="text-xs text-slate-400 font-bold mb-4">Metodología, tono y técnicas de cierre que aplican a todos los agentes.</p>
        <textarea
          value={config.generalInstructions}
          onChange={(e) => setConfig({ ...config, generalInstructions: e.target.value })}
          rows={10}
          maxLength={15000}
          placeholder="Ej: Sos un cerrador experto. Siempre respondés directo, construís valor, creás urgencia real, manejás objeciones con seguridad y guiás al cliente hacia la venta o la visita..."
          className="w-full bg-slate-50 dark:bg-slate-900 rounded-2xl px-4 py-3 text-sm outline-none resize-y border-2 border-transparent focus:border-[#1877F2]/20 transition-colors leading-relaxed"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-[11px] font-bold text-slate-400">{chars.toLocaleString()} / 15,000 · lo leen todos los agentes</span>
          <button onClick={saveInstructions} disabled={isSaving}
            className="flex items-center gap-2 bg-[#1877F2] hover:bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 active:scale-95">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
          </button>
        </div>
      </div>

      {/* Documentos globales */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-100 dark:border-slate-700 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-[#1877F2]" />
            <h2 className="text-base font-black text-slate-800 dark:text-white">Documentos globales de ventas</h2>
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="flex items-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50">
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Subir
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.json,.csv,.docx" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
        </div>
        <p className="text-xs text-slate-400 font-bold mb-4">PDFs de entrenamiento de ventas (Grant Cardone, cierres por WhatsApp, etc.) que entrenan a TODOS los agentes.</p>

        {config.knowledgeFiles.length === 0 ? (
          <div className="text-center py-10 bg-slate-50 dark:bg-slate-900/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-400 font-bold">Aún no hay documentos globales.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {config.knowledgeFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-red-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">{f.content ? 'Texto leído por la IA' : 'Documento'}</p>
                </div>
                <button onClick={() => removeFile(i)} className="p-1.5 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
