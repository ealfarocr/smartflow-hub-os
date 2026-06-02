import { useState, useEffect, useRef, useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Bot, Save, Upload, FileText, Package as PackageIcon,
  Key, Trash2, Sparkles, Globe,
  MessageSquare, Settings2, Brain, Send,
  CheckCircle2, AlertCircle, Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { storage } from '@/lib/firebase';
import { AIAgentConfig } from '@/types';

export const AIAgentView = () => {
  const { activeMembership } = useAuthStore();
  const { aiAgentConfig, updateSettings } = useSettingsStore();
  const { addToast } = useUIStore();
  
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'training' | 'test'>('config');
  const knowledgeInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<AIAgentConfig>({
    apiKey: '',
    knowledgeFiles: [],
    productFiles: [],
  });
  const [manualKnowledge, setManualKnowledge] = useState<string>('');

  // Estado para el chat de prueba
  const [chatMessages, setChatMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [aiUsage, setAiUsage] = useState<{ used: number; limit: number; remaining: number } | null>(null);

  useEffect(() => {
    if (aiAgentConfig) {
      setConfig({
        apiKey: aiAgentConfig.apiKey || '',
        knowledgeFiles: aiAgentConfig.knowledgeFiles || [],
        productFiles: aiAgentConfig.productFiles || [],
        mediaLibrary: aiAgentConfig.mediaLibrary || [],
      });
      setManualKnowledge(
        (aiAgentConfig.knowledgeFiles || []).find(f => f.url === 'manual')?.content || ''
      );
    }
  }, [aiAgentConfig]);

  const handleSave = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      const knowledgeWithManual = [
        ...config.knowledgeFiles.filter(f => f.url !== 'manual'),
        ...(manualKnowledge.trim()
          ? [{ name: 'Información del proyecto', url: 'manual', type: 'text/plain', content: manualKnowledge.trim() }]
          : []),
      ];
      const finalConfig = { ...config, knowledgeFiles: knowledgeWithManual };
      setConfig(finalConfig);
      await updateSettings(activeMembership.tenantId, { aiAgentConfig: finalConfig }, activeMembership.userId || undefined);
      addToast('Configuración del Agente IA guardada.', 'success');
    } catch (error) {
      console.error(error);
      addToast('Error al guardar configuración.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileUpload = (type: 'knowledge' | 'product') => {
    if (type === 'knowledge') knowledgeInputRef.current?.click();
    else productInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>, type: 'knowledge' | 'product') => {
    const file = e.target.files?.[0];
    if (!file || !activeMembership?.tenantId) return;

    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      addToast(`El archivo supera los ${MAX_MB}MB permitidos.`, 'error');
      return;
    }

    setIsUploading(true);
    try {
      // Extraer texto del archivo (PDF, TXT, JSON, CSV)
      let textContent: string | undefined;
      try {
        const { extractTextFromFile } = await import('@/utils/pdfExtract');
        const raw = await extractTextFromFile(file);
        textContent = raw.slice(0, 15000);
      } catch {
        // Fallback para otros tipos (JSON, CSV)
        const isTextReadable = ['application/json', 'text/plain', 'text/csv'].includes(file.type) || file.name.endsWith('.json') || file.name.endsWith('.csv');
        if (isTextReadable) textContent = await file.text();
      }

      // Subir a Firebase Storage
      const storageRef = ref(storage, `tenants/${activeMembership.tenantId}/ai-agent/${type}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      const newFile = {
        name: file.name,
        url: downloadUrl,
        type: file.type || 'application/octet-stream',
        size: file.size,
        ...(textContent && { content: textContent })
      };

      // Calcular config actualizada y guardar simultáneamente
      const updated: AIAgentConfig = type === 'knowledge'
        ? { ...config, knowledgeFiles: [...config.knowledgeFiles, newFile] }
        : { ...config, productFiles: [...config.productFiles, newFile] };

      setConfig(updated);

      await updateSettings(activeMembership.tenantId, { aiAgentConfig: updated }, activeMembership.userId || undefined);
      addToast(`✅ "${file.name}" guardado correctamente.`, 'success');
    } catch (err: any) {
      console.error('Error uploading/saving file:', err);
      addToast(`Error: ${err?.message || 'No se pudo subir el archivo. Intenta de nuevo.'}`, 'error');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveFile = async (type: 'knowledge' | 'product', index: number) => {
    const updated: AIAgentConfig = type === 'knowledge'
      ? { ...config, knowledgeFiles: config.knowledgeFiles.filter((_, i) => i !== index) }
      : { ...config, productFiles: config.productFiles.filter((_, i) => i !== index) };

    setConfig(updated);

    if (activeMembership?.tenantId) {
      await updateSettings(activeMembership.tenantId, { aiAgentConfig: updated }, activeMembership.userId || undefined)
        .catch(() => addToast('Error al guardar cambios.', 'error'));
    }
  };

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isTyping || !activeMembership?.tenantId) return;

    const userMsg = { role: 'user' as const, content: inputMessage.trim() };
    const updatedMessages = [...chatMessages, userMsg];
    setChatMessages(updatedMessages);
    setInputMessage('');
    setIsTyping(true);

    try {
      const functions = getFunctions();
      const chatFn = httpsCallable<
        { messages: { role: string; content: string }[]; tenantId: string },
        { reply: string; usage?: { used: number; limit: number; remaining: number } }
      >(functions, 'chatWithAgent');

      const result = await chatFn({
        messages: updatedMessages,
        tenantId: activeMembership.tenantId,
      });

      setChatMessages(prev => [...prev, { role: 'assistant', content: result.data.reply }]);
      if (result.data.usage) setAiUsage(result.data.usage);
    } catch (err: any) {
      console.error('chatWithAgent error:', err);
      const isLimit = err?.message?.includes('límite') || err?.code === 'functions/resource-exhausted';
      const errorDetail = err?.message ? ` (${err.code}: ${err.message})` : '';
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: isLimit
          ? `⚠️ ${err.message}`
          : `❌ Error al conectar con el Agente IA.${errorDetail}`,
      }]);
    } finally {
      setIsTyping(false);
    }
  }, [inputMessage, isTyping, chatMessages, activeMembership?.tenantId]);

  const isReady = config.knowledgeFiles.length > 0 || config.productFiles.length > 0 || manualKnowledge.trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20">
      {/* Inputs de archivo ocultos */}
      <input ref={knowledgeInputRef} type="file" accept=".pdf,.txt,.json,.csv,.docx" className="hidden" onChange={e => handleFileSelected(e, 'knowledge')} />
      <input ref={productInputRef} type="file" accept=".pdf,.txt,.json,.csv,.xlsx,.docx" className="hidden" onChange={e => handleFileSelected(e, 'product')} />

      {/* Header Premium y Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-5">
          <div className={`p-4 rounded-3xl shadow-2xl transition-all duration-500 ${isReady ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-[#1877F2] shadow-blue-500/20'}`}>
            <Bot className="w-10 h-10 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Agente IA</h1>
              {isReady ? (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black rounded-full uppercase tracking-widest">
                  <CheckCircle2 className="w-3 h-3" /> Listo
                </span>
              ) : (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-black rounded-full uppercase tracking-widest">
                  <AlertCircle className="w-3 h-3" /> Falta Config
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Entrena y personaliza el cerebro de tu asistente virtual.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166fe5] text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-[#1877F2]/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex p-1.5 bg-slate-100 dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 w-full max-w-md mx-auto sm:mx-0">
        <button
          onClick={() => setActiveTab('config')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black transition-all ${activeTab === 'config' ? 'bg-white dark:bg-slate-800 shadow-xl text-[#1877F2]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Settings2 className="w-4 h-4" /> CONFIG
        </button>
        <button
          onClick={() => setActiveTab('training')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black transition-all ${activeTab === 'training' ? 'bg-white dark:bg-slate-800 shadow-xl text-[#1877F2]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Brain className="w-4 h-4" /> ENTRENAR
        </button>
        <button
          onClick={() => setActiveTab('test')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-black transition-all ${activeTab === 'test' ? 'bg-white dark:bg-slate-800 shadow-xl text-[#1877F2]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <Play className="w-4 h-4" /> PROBAR
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'config' && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-8"
          >
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 border border-slate-200 dark:border-slate-700 shadow-sm space-y-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-[#1877F2]">
                  <Key className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-lg">Conexión Maestro</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Motor OpenAI GPT-4o</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">OpenAI API Key <span className="text-emerald-500">(Opcional)</span></label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="sk-proj-... (ya configurada en el servidor)"
                  className="w-full px-6 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl outline-none text-slate-900 dark:text-white font-black transition-all"
                />
                <p className="text-[10px] font-bold text-emerald-600 leading-relaxed uppercase tracking-tight">
                  ✅ La API Key ya está configurada en el servidor. No necesitas ingresarla aquí.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-br from-[#1877F2] to-[#166fe5] rounded-[2.5rem] p-10 text-white shadow-xl shadow-[#1877F2]/20 relative overflow-hidden group flex flex-col justify-between">
              <Globe className="absolute -right-10 -top-10 w-64 h-64 opacity-10 group-hover:scale-110 transition-transform duration-1000" />
              <div className="relative z-10">
                <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-6">
                  <Sparkles className="w-8 h-8 text-blue-100" />
                </div>
                <h4 className="text-2xl font-black tracking-tight mb-4">Seguridad Multi-Inquilino</h4>
                <p className="text-sm font-medium text-blue-100 leading-relaxed">
                  Tu IA vive en una "Isla de Datos". El conocimiento cargado aquí es exclusivo de tu negocio y no se comparte con OpenAI para entrenamiento público ni con otros usuarios del Hub.
                </p>
              </div>
              <div className="mt-8 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest bg-black/10 w-fit px-4 py-2 rounded-full border border-white/10">
                <CheckCircle2 className="w-4 h-4 text-blue-200" /> Datos 100% Privados
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'training' && (
          <motion.div
            key="training"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            {/* Información del proyecto — texto directo */}
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-700 shadow-sm space-y-5">
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-[1.25rem] bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600">
                  <FileText className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white text-xl">Información del Proyecto</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Pegá aquí precios, medidas, ubicación, servicios y condiciones</p>
                </div>
              </div>
              <textarea
                value={manualKnowledge}
                onChange={e => setManualKnowledge(e.target.value)}
                placeholder="Ej: Somos Iguana Park – Llanos de Cortés. Proyecto residencial en Bagaces, Guanacaste. Lotes desde ₡10,000,000, Quintas desde ₡18,000,000..."
                rows={10}
                className="w-full bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-emerald-400 rounded-2xl px-6 py-4 text-sm text-slate-700 dark:text-slate-200 outline-none resize-y font-mono transition-all"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">{manualKnowledge.length.toLocaleString()} / 15,000 caracteres</p>
                <p className="text-xs text-emerald-600 font-semibold">✓ El bot leerá este texto en cada conversación</p>
              </div>
            </div>

            {/* Base de Conocimiento */}
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-[1.25rem] bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600">
                    <Brain className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 dark:text-white text-xl">Cerebro del Negocio</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Entrena la personalidad y conocimiento general</p>
                  </div>
                </div>
                <button
                  onClick={() => handleFileUpload('knowledge')}
                  disabled={isUploading}
                  className="flex items-center gap-2 px-8 py-4 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-[#1877F2] hover:text-white transition-all group disabled:opacity-50 disabled:cursor-wait"
                >
                  {isUploading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-4 h-4 group-hover:-translate-y-1 transition-transform" />}
                  {isUploading ? 'SUBIENDO...' : 'SUBIR DOCUMENTOS'}
                </button>
              </div>

              {config.knowledgeFiles.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-950/30 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                  <FileText className="w-16 h-16 text-slate-200 dark:text-slate-800 mx-auto mb-4" />
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Arrastra tus manuales o políticas aquí</p>
                  <p className="text-xs text-slate-400 mt-2">Formatos aceptados: PDF, DOCX, TXT</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {config.knowledgeFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl group hover:border-[#1877F2]/30 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                          <FileText className="w-5 h-5 text-[#1877F2]" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-slate-900 dark:text-white truncate max-w-[120px] uppercase">{file.name}</span>
                          <span className="text-[10px] font-bold text-slate-400">PDF Document</span>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveFile('knowledge', idx)} className="text-slate-300 hover:text-red-500 p-2 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Catálogo */}
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-200 dark:border-slate-700 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div className="flex items-center gap-5">
                  <div className="w-14 h-14 rounded-[1.25rem] bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-500">
                    <PackageIcon className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 dark:text-white text-xl">Listas de Precios</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Sube listas de precios, tarifas o inventario</p>
                  </div>
                </div>
                <button
                  onClick={() => handleFileUpload('product')}
                  disabled={isUploading}
                  className="flex items-center gap-2 px-8 py-4 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-500 hover:text-white transition-all group disabled:opacity-50 disabled:cursor-wait"
                >
                  {isUploading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Upload className="w-4 h-4 group-hover:-translate-y-1 transition-transform" />}
                  {isUploading ? 'SUBIENDO...' : 'SUBIR TABLAS / CSV'}
                </button>
              </div>

              {config.productFiles.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 dark:bg-slate-950/30 rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800">
                  <PackageIcon className="w-16 h-16 text-slate-200 dark:text-slate-800 mx-auto mb-4" />
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Sube tus listas de precios o inventario</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {config.productFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl group hover:border-emerald-500/30 transition-all">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                          <PackageIcon className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-slate-900 dark:text-white truncate max-w-[120px] uppercase">{file.name}</span>
                          <span className="text-[10px] font-bold text-slate-400">Excel / CSV</span>
                        </div>
                      </div>
                      <button onClick={() => handleRemoveFile('product', idx)} className="text-slate-300 hover:text-red-500 p-2 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {activeTab === 'test' && (
          <motion.div
            key="test"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col h-[600px] overflow-hidden"
          >
            {/* Chat Header */}
            <div className="px-8 py-6 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-12 h-12 rounded-2xl bg-[#1877F2] flex items-center justify-center text-white">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div className="absolute -right-1 -bottom-1 w-4 h-4 bg-emerald-500 border-4 border-white dark:border-slate-900 rounded-full" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-tight">Simulador de Agente</h3>
                  <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">En línea y entrenado</p>
                </div>
              </div>
              <button 
                onClick={() => setChatMessages([])}
                className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors"
              >
                Limpiar Chat
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-[2rem] border-2 border-dashed border-slate-100 dark:border-slate-800">
                    <MessageSquare className="w-12 h-12 text-slate-200 dark:text-slate-800 mx-auto" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase">Prueba a tu Agente</h4>
                    <p className="text-xs text-slate-400 max-w-[250px] mx-auto mt-1">
                      Envía un mensaje para ver cómo respondería el agente con el conocimiento cargado.
                    </p>
                  </div>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: msg.role === 'user' ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] px-6 py-4 rounded-[1.5rem] text-sm font-medium leading-relaxed shadow-sm ${
                      msg.role === 'user' 
                        ? 'bg-[#1877F2] text-white rounded-tr-none' 
                        : 'bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-tl-none'
                    }`}>
                      {msg.content}
                    </div>
                  </motion.div>
                ))
              )}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-slate-100 dark:bg-slate-900 px-6 py-4 rounded-[1.5rem] rounded-tl-none">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="p-8 bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              {aiUsage && (
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-xs text-slate-400">
                    Consultas este mes: <span className="font-semibold text-slate-600 dark:text-slate-300">{aiUsage.used} / {aiUsage.limit}</span>
                  </span>
                  <span className={`text-xs font-semibold ${aiUsage.remaining <= 10 ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {aiUsage.remaining} restantes
                  </span>
                </div>
              )}
              <div className="relative flex items-center gap-3">
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Escribe tu pregunta aquí..."
                  className="flex-1 bg-white dark:bg-slate-800 border-2 border-transparent focus:border-[#1877F2]/20 rounded-2xl px-6 py-4 text-sm font-medium outline-none shadow-sm transition-all"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isTyping}
                  className="p-4 bg-[#1877F2] hover:bg-[#166fe5] text-white rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Loader2 = ({ className }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
