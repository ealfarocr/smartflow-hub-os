import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { TenantSettings } from '@/services/firebase/SettingsService';
import { TenantFeatures, AIAgentConfig, MediaLibraryItem } from '@/types';
import { Save, Building2, Palette, MessageSquare, Percent, GitMerge, Loader2, Blocks, Copy, Check, Eye, Handshake, FileText, Bell, RefreshCw, Bot, Upload, Trash2, Image, File } from 'lucide-react';
import { LogoUploader } from './LogoUploader';
import { ColorPickerField } from './ColorPickerField';
import { PipelineEditor } from './PipelineEditor';
import { SuperAdminService } from '@/services/firebase/SuperAdminService';

type TabId = 'company' | 'branding' | 'commercial' | 'templates' | 'pipeline' | 'features' | 'agente';

export const SettingsView = () => {
  const store = useSettingsStore();
  const { activeMembership, user } = useAuthStore();
  const { addToast } = useUIStore();
  const [activeTab, setActiveTab] = useState<TabId>('company');
  const [isSaving, setIsSaving] = useState(false);

  // Local form state
  const [companyData, setCompanyData] = useState(store.company);
  const [brandingData, setBrandingData] = useState(store.branding);
  const [commercialData, setCommercialData] = useState(store.commercial);
  const [templatesData, setTemplatesData] = useState(store.templates);
  const [pipelineData, setPipelineData] = useState(store.pipeline);
  const [whatsappTemplatesData, setWhatsappTemplatesData] = useState(store.whatsappTemplates);
  const [featuresData, setFeaturesData] = useState<Partial<TenantFeatures>>(store.features || {});
  const [aiAgentConfigData, setAiAgentConfigData] = useState<AIAgentConfig>(
    store.aiAgentConfig || { apiKey: '', knowledgeFiles: [], productFiles: [], mediaLibrary: [] }
  );
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isUploadingKnowledge, setIsUploadingKnowledge] = useState(false);
  const [manualKnowledge, setManualKnowledge] = useState<string>(
    () => (store.aiAgentConfig?.knowledgeFiles || []).find(f => f.url === 'manual')?.content || ''
  );

  // Plantillas tab state
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('Ana González');

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsub = store.subscribe(activeMembership.tenantId);
      return () => unsub();
    }
  }, [activeMembership?.tenantId]);

  // Sync local state when store loads
  useEffect(() => {
    if (!store.isLoading) {
      setCompanyData(store.company);
      setBrandingData(store.branding);
      setCommercialData(store.commercial);
      setTemplatesData(store.templates);
      setPipelineData(store.pipeline);
      setWhatsappTemplatesData(store.whatsappTemplates);
      setFeaturesData(store.features || {});
      const agentCfg = store.aiAgentConfig || { apiKey: '', knowledgeFiles: [], productFiles: [], mediaLibrary: [] };
      setAiAgentConfigData(agentCfg);
      setManualKnowledge((agentCfg.knowledgeFiles || []).find(f => f.url === 'manual')?.content || '');
    }
  }, [store.isLoading, store.company, store.branding, store.commercial, store.templates, store.pipeline, store.whatsappTemplates, store.aiAgentConfig]);

  const handleSave = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      // Merge manual knowledge text into knowledgeFiles (entry with url='manual')
      const knowledgeFilesWithManual = [
        ...(aiAgentConfigData.knowledgeFiles || []).filter(f => f.url !== 'manual'),
        ...(manualKnowledge.trim()
          ? [{ name: 'Información del proyecto', url: 'manual', type: 'text/plain', content: manualKnowledge.trim() }]
          : []),
      ];
      const settings: TenantSettings = {
        company: companyData,
        branding: brandingData,
        commercial: commercialData,
        templates: templatesData,
        pipeline: pipelineData,
        whatsappTemplates: whatsappTemplatesData,
        features: featuresData,
        aiAgentConfig: { ...aiAgentConfigData, knowledgeFiles: knowledgeFilesWithManual },
      };
      await store.updateSettings(activeMembership.tenantId, settings, activeMembership.userId || undefined);
      
      if (user?.isSuperAdmin) {
        await SuperAdminService.updateTenantFeatures(activeMembership.tenantId, featuresData as TenantFeatures);
      }
      addToast('Configuración guardada exitosamente.', 'success');
    } catch (error) {
      console.error(error);
      addToast('Error al guardar la configuración.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: 'company' as TabId, label: 'Datos de la Empresa', icon: Building2 },
    { id: 'branding' as TabId, label: 'Branding', icon: Palette },
    { id: 'commercial' as TabId, label: 'Parámetros Comerciales', icon: Percent },
    { id: 'templates' as TabId, label: 'Plantillas', icon: MessageSquare },
    { id: 'pipeline' as TabId, label: 'Pipeline CRM', icon: GitMerge },
    { id: 'features' as TabId, label: 'Módulos', icon: Blocks },
    { id: 'agente' as TabId, label: 'Agente IA', icon: Bot },
  ];

  const CURRENCIES = [
    { code: 'MXN', label: '🇲🇽 MXN - Peso Mexicano' },
    { code: 'USD', label: '🇺🇸 USD - Dólar Estadounidense' },
    { code: 'PEN', label: '🇵🇪 PEN - Sol Peruano' },
    { code: 'CRC', label: '🇨🇷 CRC - Colón Costarricense' },
    { code: 'COP', label: '🇨🇴 COP - Peso Colombiano' },
    { code: 'CLP', label: '🇨🇱 CLP - Peso Chileno' },
    { code: 'ARS', label: '🇦🇷 ARS - Peso Argentino' },
    { code: 'GTQ', label: '🇬🇹 GTQ - Quetzal Guatemalteco' },
    { code: 'HNL', label: '🇭🇳 HNL - Lempira Hondureño' },
    { code: 'NIO', label: '🇳🇮 NIO - Córdoba Nicaragüense' },
    { code: 'PAB', label: '🇵🇦 PAB - Balboa Panameño' },
    { code: 'DOP', label: '🇩🇴 DOP - Peso Dominicano' },
    { code: 'UYU', label: '🇺🇾 UYU - Peso Uruguayo' },
    { code: 'BOB', label: '🇧🇴 BOB - Boliviano' },
    { code: 'PYG', label: '🇵🇾 PYG - Guaraní Paraguayo' },
    { code: 'EUR', label: '🇪🇺 EUR - Euro' },
  ];

  // Color Celeste Facebook: #1877F2
  const inputCls = "w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-[#1877F2] focus:border-[#1877F2] transition-all shadow-sm";
  const labelCls = "block text-sm font-bold text-slate-700 dark:text-slate-200 mb-1.5";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Configuración del Sistema</h1>
        <button
          onClick={handleSave}
          disabled={store.isLoading || isSaving}
          className="bg-[#1877F2] hover:bg-[#166fe5] text-white px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center shadow-lg shadow-[#1877F2]/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-premium flex flex-col md:flex-row overflow-hidden min-h-[640px]">
        {/* Sidebar */}
        <div className="md:w-64 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
          <nav className="space-y-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-4 py-3 text-sm font-bold rounded-xl transition-all ${
                  activeTab === tab.id
                    ? 'bg-[#1877F2] text-white shadow-lg shadow-[#1877F2]/20'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <tab.icon className={`w-4 h-4 mr-3 ${activeTab === tab.id ? 'text-white' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 lg:p-10 overflow-y-auto relative bg-white dark:bg-slate-800">
          {store.isLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center">
              <Loader2 className="w-10 h-10 text-[#1877F2] animate-spin mb-4" />
              <p className="text-slate-900 dark:text-white font-bold animate-pulse">Sincronizando configuración...</p>
            </div>
          )}

          {/* ═══ TAB: EMPRESA ═══ */}
          {activeTab === 'company' && (
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Datos de la Empresa</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Información legal y de contacto mostrada en documentos y cotizaciones.</p>
              </div>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelCls}>Nombre Legal / Razón Social</label>
                    <input type="text" value={companyData.legalName} onChange={e => setCompanyData({...companyData, legalName: e.target.value})} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Nombre Comercial</label>
                    <input type="text" value={companyData.tradeName} onChange={e => setCompanyData({...companyData, tradeName: e.target.value})} className={inputCls} placeholder="Ej: Mi Empresa S.A." />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>RFC / ID Fiscal</label>
                  <input type="text" value={companyData.taxId} onChange={e => setCompanyData({...companyData, taxId: e.target.value})} className={inputCls} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelCls}>Teléfono</label>
                    <input type="text" value={companyData.phone} onChange={e => setCompanyData({...companyData, phone: e.target.value})} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Correo Electrónico</label>
                    <input type="email" value={companyData.email} onChange={e => setCompanyData({...companyData, email: e.target.value})} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Sitio Web</label>
                  <input type="url" value={companyData.website} onChange={e => setCompanyData({...companyData, website: e.target.value})} className={inputCls} placeholder="https://www.ejemplo.com" />
                </div>
                <div>
                  <label className={labelCls}>Dirección Física</label>
                  <textarea rows={3} value={companyData.physicalAddress} onChange={e => setCompanyData({...companyData, physicalAddress: e.target.value})} className={`${inputCls} resize-none`} />
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: BRANDING ═══ */}
          {activeTab === 'branding' && (
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Branding</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Identidad visual de tu empresa. Se usará en cotizaciones, PDFs y comunicaciones.</p>
              </div>

              {activeMembership?.tenantId && (
                <LogoUploader
                  logoUrl={brandingData.logoUrl}
                  tenantId={activeMembership.tenantId}
                  onLogoUploaded={(url) => setBrandingData({...brandingData, logoUrl: url})}
                />
              )}

              <div>
                <h3 className="text-sm font-bold text-[#1877F2] mb-4 uppercase tracking-wider">Paleta de Colores</h3>
                <div className="space-y-4">
                  <ColorPickerField label="Color Principal" value={brandingData.primaryColor} onChange={v => setBrandingData({...brandingData, primaryColor: v})} />
                  <ColorPickerField label="Color Secundario" value={brandingData.secondaryColor} onChange={v => setBrandingData({...brandingData, secondaryColor: v})} />
                  <ColorPickerField label="Color de Acento" value={brandingData.accentColor} onChange={v => setBrandingData({...brandingData, accentColor: v})} />
                </div>
              </div>

              {/* Header style selector — ABOVE preview */}
              <div>
                <label className={labelCls}>Estilo de Header para Cotizaciones</label>
                <div className="grid grid-cols-3 gap-3 mt-2">
                  {(['classic', 'modern', 'minimal'] as const).map(style => (
                    <button
                      key={style}
                      onClick={() => setBrandingData({...brandingData, quoteHeaderStyle: style})}
                      className={`relative p-4 rounded-xl border-2 text-center transition-all ${
                        brandingData.quoteHeaderStyle === style
                          ? 'border-[#1877F2] bg-[#1877F2]/5 shadow-md ring-1 ring-[#1877F2]/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {brandingData.quoteHeaderStyle === style && (
                        <span className="absolute top-2 right-2 w-5 h-5 bg-[#1877F2] rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </span>
                      )}
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{style === 'classic' ? 'Clásico' : style === 'modern' ? 'Moderno' : 'Minimal'}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic preview */}
              <div>
                <h3 className="text-sm font-bold text-[#1877F2] mb-3 uppercase tracking-wider">Vista Previa</h3>
                <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-lg">
                  {brandingData.quoteHeaderStyle === 'classic' && (
                    <div style={{ backgroundColor: brandingData.primaryColor }} className="p-8">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-16 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-12 w-12 rounded bg-white/20 flex items-center justify-center font-bold text-lg text-white border border-white/30">P</div>
                          )}
                          <div className="border-l border-white/20 pl-4 py-1">
                            <p className="text-white font-bold text-lg tracking-tight leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.2em] mt-0.5">Propuesta Técnica y Comercial</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-bold text-lg">COT-001</p>
                          <p className="text-white/60 text-xs">24/04/2026</p>
                        </div>
                      </div>
                    </div>
                  )}
                  {brandingData.quoteHeaderStyle === 'modern' && (
                    <div style={{ background: `linear-gradient(135deg, ${brandingData.primaryColor}, ${brandingData.secondaryColor})` }} className="p-8">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-bold text-lg">P</div>
                          )}
                          <div className="border-l border-white/20 pl-4 py-0.5">
                            <p className="text-white font-bold text-sm leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-white/70 text-[10px] font-bold uppercase tracking-wider mt-0.5">Propuesta Comercial</p>
                          </div>
                        </div>
                        <div style={{ backgroundColor: brandingData.accentColor }} className="px-4 py-2 rounded-full text-xs font-bold text-white shadow-xl">COT-001</div>
                      </div>
                    </div>
                  )}
                  {brandingData.quoteHeaderStyle === 'minimal' && (
                    <div className="bg-white dark:bg-slate-900 p-8" style={{ borderBottom: `4px solid ${brandingData.primaryColor}` }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-10 w-10 rounded flex items-center justify-center font-bold text-lg" style={{ color: brandingData.primaryColor, border: `2px solid ${brandingData.primaryColor}` }}>P</div>
                          )}
                          <div className="border-l border-slate-200 dark:border-slate-700 pl-4 py-0.5">
                            <p className="text-slate-900 dark:text-white font-bold text-sm leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mt-0.5">Propuesta Comercial</p>
                          </div>
                        </div>
                        <p className="text-sm font-bold" style={{ color: brandingData.primaryColor }}>COT-001</p>
                      </div>
                    </div>
                  )}
                  <div className="bg-slate-50 dark:bg-slate-900 p-4 text-[10px] font-bold text-slate-400 text-center uppercase tracking-widest">
                    Vista previa del encabezado · SmartFlow Hub OS
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: COMERCIAL ═══ */}
          {activeTab === 'commercial' && (
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Parámetros Comerciales</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configuración por defecto para cotizaciones y cierres.</p>
              </div>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelCls}>Días de Vigencia de Cotización</label>
                    <input type="number" min={1} value={commercialData.quoteValidityDays} onChange={e => setCommercialData({...commercialData, quoteValidityDays: Number(e.target.value)})} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Descuento Máximo Permitido (%)</label>
                    <input type="number" min={0} max={100} value={commercialData.maxDiscountPercent} onChange={e => setCommercialData({...commercialData, maxDiscountPercent: Number(e.target.value)})} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className={labelCls}>Tasa de Impuestos / IVA (%)</label>
                    <input type="number" min={0} value={commercialData.taxRatePercent} onChange={e => setCommercialData({...commercialData, taxRatePercent: Number(e.target.value)})} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Moneda Principal</label>
                    <select 
                      value={commercialData.currency} 
                      onChange={e => setCommercialData({...commercialData, currency: e.target.value})} 
                      className={inputCls}
                    >
                      {CURRENCIES.map(curr => (
                        <option key={curr.code} value={curr.code}>{curr.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Condiciones de Pago por Defecto</label>
                  <textarea rows={5} value={commercialData.defaultPaymentTerms} onChange={e => setCommercialData({...commercialData, defaultPaymentTerms: e.target.value})} className={`${inputCls} resize-none`} placeholder="Ej: 50% anticipo, 50% contra entrega..." />
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: PLANTILLAS ═══ */}
          {activeTab === 'templates' && (
            <div className="max-w-2xl space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Header */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex items-start gap-4">
                <div className="p-3 bg-[#1877F2]/10 rounded-2xl shrink-0">
                  <MessageSquare className="w-6 h-6 text-[#1877F2]" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">Plantillas de Mensajes</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Mensajes predefinidos para WhatsApp. Se envían con un clic desde la ventana de conversación — el nombre del cliente y tu empresa se rellenan automáticamente.
                  </p>
                </div>
              </div>

              {/* Variables reference */}
              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Variables disponibles</p>
                <div className="flex flex-wrap gap-2">
                  {([
                    { v: '{{leadName}}',    hint: 'Nombre del cliente' },
                    { v: '{{companyName}}', hint: 'Tu empresa' },
                    { v: '{{quoteNumber}}', hint: 'N° de cotización' },
                    { v: '{{savings}}',     hint: 'Ahorro estimado' },
                  ] as const).map(({ v, hint }) => (
                    <button
                      key={v}
                      onClick={() => {
                        navigator.clipboard.writeText(v);
                        setCopiedVar(v);
                        addToast('Variable copiada', 'success');
                        setTimeout(() => setCopiedVar(null), 2000);
                      }}
                      className="flex items-center gap-1.5 text-[10px] bg-[#1877F2]/10 text-[#1877F2] px-3 py-1.5 rounded-full font-bold hover:bg-[#1877F2]/20 transition-colors cursor-copy border border-[#1877F2]/20"
                    >
                      {copiedVar === v ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{v}</span>
                      <span className="text-slate-400 font-normal">— {hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live preview name input */}
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex items-center gap-3">
                <Eye className="w-4 h-4 text-amber-600 shrink-0" />
                <div className="flex-1 flex items-center gap-3">
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-300 shrink-0">Vista previa con nombre:</p>
                  <input
                    value={previewName}
                    onChange={e => setPreviewName(e.target.value)}
                    placeholder="Ej. Ana González"
                    className="flex-1 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-700 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-white outline-none focus:border-amber-400 transition-all"
                  />
                </div>
              </div>

              {/* Template cards */}
              <div className="space-y-4">
                {([
                  { key: 'welcomeMessage' as const, icon: Handshake, label: 'Bienvenida', desc: 'Se envía al iniciar contacto con un nuevo cliente.', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
                  { key: 'quoteMessage' as const,   icon: FileText,  label: 'Envío de Cotización', desc: 'Acompaña el PDF de cotización con contexto claro.', color: 'text-[#1877F2]', bg: 'bg-[#1877F2]/10' },
                  { key: 'meetingReminder' as const, icon: Bell,      label: 'Recordatorio de Reunión', desc: 'Avisa al cliente antes de una cita o visita técnica.', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/20' },
                  { key: 'followUpMessage' as const, icon: RefreshCw, label: 'Seguimiento', desc: 'Reactiva la conversación con prospectos sin respuesta.', color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/20' },
                ] as const).map(({ key, icon: Icon, label, desc, color, bg }) => {
                  const preview = templatesData[key]
                    .replace(/\{\{leadName\}\}/g, previewName || 'Ana González')
                    .replace(/\{\{companyName\}\}/g, companyData.tradeName || companyData.legalName || 'Tu Empresa')
                    .replace(/\{\{quoteNumber\}\}/g, 'COT-2026-001')
                    .replace(/\{\{savings\}\}/g, '15,400');
                  return (
                    <div key={key} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
                      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                        <div className={`p-2 rounded-xl ${bg}`}>
                          <Icon className={`w-4 h-4 ${color}`} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white">{label}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{desc}</p>
                        </div>
                      </div>
                      <div className="p-5 space-y-3">
                        <textarea
                          rows={3}
                          value={templatesData[key]}
                          onChange={e => setTemplatesData({ ...templatesData, [key]: e.target.value })}
                          className={`${inputCls} resize-none font-mono text-xs`}
                          placeholder="Escribe el mensaje con {{leadName}}, {{companyName}}..."
                        />
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 px-4 py-3 space-y-1">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Eye className="w-3 h-3" /> Vista previa</p>
                          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{preview || '—'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1877F2]/20 disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSaving ? 'Guardando...' : 'Guardar Plantillas'}
              </button>
            </div>
          )}

          {/* ═══ TAB: PIPELINE CRM ═══ */}
          {activeTab === 'pipeline' && (
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Pipeline CRM</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configura las etapas del embudo de ventas.</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-3 shadow-sm">
                <span className="text-xl">⚡</span>
                <span className="font-medium">Los cambios aquí definen cómo se organizan tus leads y oportunidades de negocio.</span>
              </div>
              <PipelineEditor
                stages={pipelineData.stages}
                onChange={(stages) => setPipelineData({ stages })}
              />
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#1877F2]/20 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? 'Guardando...' : 'Guardar Pipeline'}
              </button>
            </div>
          )}

          {/* ═══ TAB: MÓDULOS ═══ */}
          {activeTab === 'features' && (
            <div className="max-w-2xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Módulos del Sistema</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Habilita o deshabilita herramientas para esta organización.</p>
              </div>

              <div className="space-y-4">
                {([
                  { key: 'hasCrm' as keyof TenantFeatures, label: 'CRM & Ventas', desc: 'Gestión de leads y pipeline kanban.' },
                  { key: 'hasTasks' as keyof TenantFeatures, label: 'Mis Tareas', desc: 'Gestor de listas y tareas del negocio.' },
                  { key: 'hasMultiAgent' as keyof TenantFeatures, label: 'WhatsApp Coexistente', desc: 'CRM multi-agente con WhatsApp API oficial.' },
                  { key: 'hasMultiAgentPanel' as keyof TenantFeatures, label: 'Multi-Agente', desc: 'Panel de distribución de conversaciones entre agentes.' },
                  { key: 'hasAiAgent' as keyof TenantFeatures, label: 'Agente IA', desc: 'IA que responde, califica y agenda automáticamente.' },
                  { key: 'hasQualityAuditor' as keyof TenantFeatures, label: 'Auditor IA', desc: 'Audita chats y evalúa el desempeño de asesores.' },
                  { key: 'hasPaymentLinks' as keyof TenantFeatures, label: 'Links de Pago', desc: 'Genera cobros por WhatsApp con tarjeta o PayPal.' },
                  { key: 'hasQuotes' as keyof TenantFeatures, label: 'Cotizaciones PDF', desc: 'Generación de propuestas y cotizaciones profesionales.' },
                  { key: 'hasCatalog' as keyof TenantFeatures, label: 'Catálogo', desc: 'Organización de productos, servicios y precios.' },
                  { key: 'hasPackages' as keyof TenantFeatures, label: 'Paquetes comerciales', desc: 'Agrupación de ofertas o servicios en bloque.' },
                  { key: 'hasAgenda' as keyof TenantFeatures, label: 'Agenda inteligente', desc: 'Calendario de citas y tareas.' },
                  { key: 'hasIntegrations' as keyof TenantFeatures, label: 'Integraciones API', desc: 'Conexión con servicios externos.' },
                ] as const).map(({ key, label, desc }) => {
                  const isEnabled = featuresData[key] !== false;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${
                        isEnabled
                          ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-md ring-1 ring-slate-100'
                          : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 opacity-60'
                      }`}
                    >
                      <div className="flex-1 mr-4">
                        <p className={`font-bold text-sm ${ isEnabled ? 'text-slate-900 dark:text-white' : 'text-slate-400' }`}>
                          {label}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{desc}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { if (user?.isSuperAdmin) setFeaturesData({ ...featuresData, [key]: !isEnabled }); }}
                        disabled={!user?.isSuperAdmin}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all ${
                          isEnabled ? 'bg-[#1877F2]' : 'bg-slate-300 dark:bg-slate-600'
                        } ${!user?.isSuperAdmin && 'cursor-not-allowed opacity-50'}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform ${ isEnabled ? 'translate-x-6' : 'translate-x-1' }`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═══ TAB: AGENTE IA ═══ */}
          {activeTab === 'agente' && (
            <div className="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Agente IA</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Entrenamiento y biblioteca de archivos para el bot.</p>
              </div>

              {/* DOCUMENTOS DE ENTRENAMIENTO */}
              <div className="space-y-4">
                {/* Texto manual */}
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">Información del proyecto</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Pegá aquí toda la info del negocio: descripción, precios, medidas, servicios, ubicación, condiciones. El bot usará este texto para responder.</p>
                  <textarea
                    value={manualKnowledge}
                    onChange={e => setManualKnowledge(e.target.value)}
                    placeholder="Ej: Somos Iguana Park – Llanos de Cortés, proyecto residencial en Bagaces... Lotes desde ₡10,000,000..."
                    rows={10}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all shadow-sm outline-none resize-y font-mono"
                  />
                  <p className="text-xs text-slate-400 mt-1 text-right">{manualKnowledge.length.toLocaleString()} / 15,000 caracteres</p>
                </div>

                {/* Upload PDF/TXT adicional */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Archivos adicionales (PDF / TXT)</p>
                    <p className="text-xs text-slate-400 mt-0.5">Complementa con documentos: brochure técnico, planos, etc.</p>
                  </div>
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all ${isUploadingKnowledge ? 'opacity-50 pointer-events-none bg-slate-200 text-slate-500' : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/20'}`}>
                    {isUploadingKnowledge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isUploadingKnowledge ? 'Procesando...' : 'Subir PDF / TXT'}
                    <input
                      type="file"
                      accept=".pdf,.txt,text/plain,application/pdf"
                      className="hidden"
                      disabled={isUploadingKnowledge}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !activeMembership?.tenantId) return;
                        setIsUploadingKnowledge(true);
                        try {
                          const { extractTextFromFile } = await import('@/utils/pdfExtract');
                          const { SettingsService } = await import('@/services/firebase/SettingsService');
                          const [content, url] = await Promise.all([
                            extractTextFromFile(file),
                            SettingsService.uploadKnowledgeFile(activeMembership.tenantId, file),
                          ]);
                          const newEntry = {
                            name: file.name,
                            url,
                            type: file.type,
                            content: content.slice(0, 15000),
                            size: file.size,
                          };
                          setAiAgentConfigData(prev => ({
                            ...prev,
                            knowledgeFiles: [...(prev.knowledgeFiles || []), newEntry],
                          }));
                          addToast('Documento extraído. Guardá los cambios para activar.', 'success');
                        } catch (err: any) {
                          addToast(err?.message || 'Error al procesar el archivo', 'error');
                        } finally {
                          setIsUploadingKnowledge(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>

                {(aiAgentConfigData.knowledgeFiles || []).length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-10 text-center">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-400 mb-1">Sin documentos de entrenamiento</p>
                    <p className="text-xs text-slate-400">Subí el PDF con precios, descripción del proyecto, medidas de lotes, etc.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(aiAgentConfigData.knowledgeFiles || []).map((kf, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-2xl">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600">
                          <FileText className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{kf.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {kf.content ? `${Math.round(kf.content.length / 1000)}k caracteres extraídos` : 'Sin contenido extraído'}
                            {kf.size ? ` · ${Math.round(kf.size / 1024)} KB` : ''}
                          </p>
                          {kf.content && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2 font-mono">
                              {kf.content.slice(0, 120)}…
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setAiAgentConfigData(prev => ({
                            ...prev,
                            knowledgeFiles: (prev.knowledgeFiles || []).filter((_, i) => i !== idx),
                          }))}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-start gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-xl">
                  <Bot className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    El bot leerá estos documentos y podrá responder preguntas sobre precios, medidas, ubicación y cualquier info del proyecto. Máximo 15,000 caracteres por archivo.
                  </p>
                </div>
              </div>

              {/* SEPARADOR */}
              <div className="border-t border-slate-200 dark:border-slate-700" />

              <div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Archivos para enviar al cliente</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">PDFs o imágenes que el bot enviará por WhatsApp cuando el cliente los solicite (masterplan, brochure, cotización tipo, etc.)</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div />
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all ${isUploadingMedia ? 'opacity-50 pointer-events-none bg-slate-200 text-slate-500' : 'bg-[#1877F2] hover:bg-blue-600 text-white shadow-lg shadow-[#1877F2]/20'}`}>
                    {isUploadingMedia ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {isUploadingMedia ? 'Subiendo...' : 'Subir archivo'}
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      className="hidden"
                      disabled={isUploadingMedia}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !activeMembership?.tenantId) return;
                        setIsUploadingMedia(true);
                        try {
                          const { SettingsService } = await import('@/services/firebase/SettingsService');
                          const url = await SettingsService.uploadMedia(activeMembership.tenantId, file);
                          const isImage = file.type.startsWith('image/');
                          const newItem: MediaLibraryItem = {
                            id: `media-${Date.now()}`,
                            name: file.name.replace(/\.[^.]+$/, ''),
                            url,
                            type: isImage ? 'image' : 'document',
                          };
                          setAiAgentConfigData(prev => ({
                            ...prev,
                            mediaLibrary: [...(prev.mediaLibrary || []), newItem],
                          }));
                          addToast('Archivo subido. Guardá los cambios para confirmar.', 'success');
                        } catch {
                          addToast('Error al subir archivo', 'error');
                        } finally {
                          setIsUploadingMedia(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>

                {(aiAgentConfigData.mediaLibrary || []).length === 0 ? (
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-12 text-center">
                    <File className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-400 mb-1">Sin archivos en la biblioteca</p>
                    <p className="text-xs text-slate-400">Subí PDFs o imágenes que el bot podrá enviar al cliente.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(aiAgentConfigData.mediaLibrary || []).map((item) => (
                      <div key={item.id} className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-2xl">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600">
                          {item.type === 'image'
                            ? <Image className="w-5 h-5 text-blue-500" />
                            : <File className="w-5 h-5 text-red-500" />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <input
                            type="text"
                            value={item.name}
                            onChange={e => setAiAgentConfigData(prev => ({
                              ...prev,
                              mediaLibrary: (prev.mediaLibrary || []).map(m => m.id === item.id ? { ...m, name: e.target.value } : m),
                            }))}
                            placeholder="Nombre del archivo"
                            className={inputCls}
                          />
                          <input
                            type="text"
                            value={item.description || ''}
                            onChange={e => setAiAgentConfigData(prev => ({
                              ...prev,
                              mediaLibrary: (prev.mediaLibrary || []).map(m => m.id === item.id ? { ...m, description: e.target.value } : m),
                            }))}
                            placeholder="Descripción (ej: Máster plan del proyecto, planos, brochure...)"
                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-2 text-xs text-slate-600 dark:text-slate-400 focus:ring-2 focus:ring-[#1877F2] focus:border-[#1877F2] transition-all shadow-sm outline-none"
                          />
                          <a href={item.url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-[#1877F2] hover:underline truncate block">{item.url}</a>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAiAgentConfigData(prev => ({
                            ...prev,
                            mediaLibrary: (prev.mediaLibrary || []).filter(m => m.id !== item.id),
                          }))}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl">
                  <Bot className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    El bot verá estos archivos en su contexto. Cuando el cliente solicite un documento disponible, lo enviará directamente por WhatsApp con una leyenda. Dá clic en <strong>Guardar Cambios</strong> para activar.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
