import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { TenantSettings } from '@/services/firebase/SettingsService';
import { Save, Building2, Palette, MessageSquare, Percent, GitMerge, Loader2, X } from 'lucide-react';
import { LogoUploader } from './LogoUploader';
import { ColorPickerField } from './ColorPickerField';
import { PipelineEditor } from './PipelineEditor';

type TabId = 'company' | 'branding' | 'commercial' | 'templates' | 'pipeline';

export const SettingsView = () => {
  const store = useSettingsStore();
  const { activeMembership } = useAuthStore();
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
    }
  }, [store.isLoading, store.company, store.branding, store.commercial, store.templates, store.pipeline, store.whatsappTemplates]);

  const handleSave = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      const settings: TenantSettings = {
        company: companyData,
        branding: brandingData,
        commercial: commercialData,
        templates: templatesData,
        pipeline: pipelineData,
        whatsappTemplates: whatsappTemplatesData,
      };
      await store.updateSettings(activeMembership.tenantId, settings, activeMembership.userId || undefined);
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
  ];

  const inputCls = "w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-shadow";
  const labelCls = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Configuración del Sistema</h1>
        <button
          onClick={handleSave}
          disabled={store.isLoading || isSaving}
          className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center shadow-sm disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row overflow-hidden min-h-[640px]">
        {/* Sidebar */}
        <div className="md:w-64 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-slate-800 text-primary-600 dark:text-primary-400 shadow-sm border border-slate-200 dark:border-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <tab.icon className={`w-4 h-4 mr-3 ${activeTab === tab.id ? 'text-primary-500' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 lg:p-10 overflow-y-auto relative">
          {store.isLoading && (
            <div className="absolute inset-0 bg-white/50 dark:bg-slate-800/50 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center">
              <Loader2 className="w-10 h-10 text-primary-500 animate-spin mb-4" />
              <p className="text-slate-500 font-medium animate-pulse">Sincronizando configuración...</p>
            </div>
          )}

          {/* ═══ TAB: EMPRESA ═══ */}
          {activeTab === 'company' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Datos de la Empresa</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Información legal y de contacto mostrada en documentos y cotizaciones.</p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Nombre Legal / Razón Social</label>
                    <input type="text" value={companyData.legalName} onChange={e => setCompanyData({...companyData, legalName: e.target.value})} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Nombre Comercial</label>
                    <input type="text" value={companyData.tradeName} onChange={e => setCompanyData({...companyData, tradeName: e.target.value})} className={inputCls} placeholder="Ej: Paneles Solares MX" />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>RFC / ID Fiscal</label>
                  <input type="text" value={companyData.taxId} onChange={e => setCompanyData({...companyData, taxId: e.target.value})} className={inputCls} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="max-w-2xl space-y-8">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Branding</h2>
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
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 uppercase tracking-wider">Paleta de Colores</h3>
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
                      className={`relative p-4 rounded-lg border-2 text-center transition-all ${
                        brandingData.quoteHeaderStyle === style
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-md ring-1 ring-primary-300'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      {brandingData.quoteHeaderStyle === style && (
                        <span className="absolute top-2 right-2 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </span>
                      )}
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{style === 'classic' ? 'Clásico' : style === 'modern' ? 'Moderno' : 'Minimal'}</p>
                      <p className="text-xs text-slate-500 mt-1">{style === 'classic' ? 'Formal y corporativo' : style === 'modern' ? 'Gradiente dinámico' : 'Limpio y simple'}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic preview based on selected style */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wider">Vista Previa</h3>
                <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">

                  {/* ─── CLASSIC: Solid corporate blue ─── */}
                  {brandingData.quoteHeaderStyle === 'classic' && (
                    <div style={{ backgroundColor: brandingData.primaryColor }} className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-16 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-12 w-12 rounded bg-white/20 flex items-center justify-center font-bold text-lg text-white border border-white/30">P</div>
                          )}
                          <div className="border-l border-white/20 pl-4 py-1">
                            <p className="text-white font-bold text-lg tracking-tight leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-white/60 text-[10px] font-medium uppercase tracking-[0.2em] mt-0.5">Propuesta Técnica y Comercial</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-bold text-lg">COT-001</p>
                          <p className="text-white/60 text-xs">24/04/2026</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ─── MODERN: Gradient + accent badge ─── */}
                  {brandingData.quoteHeaderStyle === 'modern' && (
                    <div style={{ background: `linear-gradient(135deg, ${brandingData.primaryColor}, ${brandingData.secondaryColor})` }} className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-10 w-10 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-bold text-lg">P</div>
                          )}
                          <div className="border-l border-white/20 pl-4 py-0.5">
                            <p className="text-white font-bold text-sm leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-white/70 text-[10px] uppercase tracking-wider mt-0.5">Propuesta Comercial</p>
                          </div>
                        </div>
                        <div style={{ backgroundColor: brandingData.accentColor }} className="px-3 py-1.5 rounded-full text-xs font-bold text-white shadow-lg">COT-001</div>
                      </div>
                    </div>
                  )}

                  {/* ─── MINIMAL: White bg, colored bottom line ─── */}
                  {brandingData.quoteHeaderStyle === 'minimal' && (
                    <div className="bg-white dark:bg-slate-900 p-6" style={{ borderBottom: `3px solid ${brandingData.primaryColor}` }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {brandingData.logoUrl ? (
                            <img src={brandingData.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
                          ) : (
                            <div className="h-10 w-10 rounded flex items-center justify-center font-bold text-lg" style={{ color: brandingData.primaryColor, border: `2px solid ${brandingData.primaryColor}` }}>P</div>
                          )}
                          <div className="border-l border-slate-200 dark:border-slate-700 pl-4 py-0.5">
                            <p className="text-slate-900 dark:text-white font-bold text-sm leading-tight">{companyData.tradeName || companyData.legalName || 'Tu Empresa'}</p>
                            <p className="text-slate-400 text-[10px] uppercase tracking-wider mt-0.5">Propuesta Comercial</p>
                          </div>
                        </div>
                        <p className="text-sm font-medium" style={{ color: brandingData.primaryColor }}>COT-001</p>
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-400 text-center">
                    Así se verá el encabezado de tus cotizaciones · Estilo: <span className="font-semibold text-slate-600 dark:text-slate-300">{brandingData.quoteHeaderStyle === 'classic' ? 'Clásico' : brandingData.quoteHeaderStyle === 'modern' ? 'Moderno' : 'Minimal'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: COMERCIAL ═══ */}
          {activeTab === 'commercial' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Parámetros Comerciales</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configuración por defecto para cotizaciones y cierres.</p>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Días de Vigencia de Cotización</label>
                    <input type="number" min={1} value={commercialData.quoteValidityDays} onChange={e => setCommercialData({...commercialData, quoteValidityDays: Number(e.target.value)})} className={`${inputCls} w-32`} />
                  </div>
                  <div>
                    <label className={labelCls}>Descuento Máximo Permitido (%)</label>
                    <input type="number" min={0} max={100} value={commercialData.maxDiscountPercent} onChange={e => setCommercialData({...commercialData, maxDiscountPercent: Number(e.target.value)})} className={`${inputCls} w-32`} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Tasa de Impuestos / IVA (%)</label>
                    <input type="number" min={0} value={commercialData.taxRatePercent} onChange={e => setCommercialData({...commercialData, taxRatePercent: Number(e.target.value)})} className={`${inputCls} w-32`} />
                  </div>
                  <div>
                    <label className={labelCls}>Moneda (Siglas)</label>
                    <div className="relative">
                      <input 
                        list="currencies"
                        type="text" 
                        value={commercialData.currency} 
                        onChange={e => setCommercialData({...commercialData, currency: e.target.value.toUpperCase().slice(0, 5)})} 
                        className={`${inputCls} w-40 font-bold uppercase`}
                        placeholder="Ej: MX, USD"
                      />
                      <datalist id="currencies">
                        <option value="MX">MX (Peso Mexicano)</option>
                        <option value="USD">USD (Dólar Estadounidense)</option>
                        <option value="PEN">PEN (Sol Peruano)</option>
                        <option value="CRC">CRC (Colón Costarricense)</option>
                        <option value="COP">COP (Peso Colombiano)</option>
                        <option value="CLP">CLP (Peso Chileno)</option>
                        <option value="ARS">ARS (Peso Argentino)</option>
                        <option value="GTQ">GTQ (Quetzal Guatemalteco)</option>
                        <option value="HNL">HNL (Lempira Hondureño)</option>
                        <option value="NIO">NIO (Córdoba Nicaragüense)</option>
                        <option value="PAB">PAB (Balboa Panameño)</option>
                        <option value="DOP">DOP (Peso Dominicano)</option>
                        <option value="UYU">UYU (Peso Uruguayo)</option>
                        <option value="BOB">BOB (Boliviano)</option>
                        <option value="PYG">PYG (Guaraní Paraguayo)</option>
                        <option value="EUR">EUR (Euro)</option>
                      </datalist>
                    </div>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Condiciones de Pago por Defecto</label>
                  <textarea rows={4} value={commercialData.defaultPaymentTerms} onChange={e => setCommercialData({...commercialData, defaultPaymentTerms: e.target.value})} className={`${inputCls} resize-none`} placeholder="Ej: 50% anticipo, 50% contra entrega. Transferencia bancaria o efectivo." />
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: PLANTILLAS ═══ */}
          {activeTab === 'templates' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Plantillas de Mensajes</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Plantillas que se pre-cargan en la bandeja de WhatsApp. Usa variables con doble llave.</p>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                {['{{leadName}}', '{{quoteNumber}}', '{{savings}}', '{{companyName}}'].map(v => (
                  <button key={v} onClick={() => navigator.clipboard.writeText(v)} className="text-xs bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 px-2.5 py-1 rounded-full font-mono hover:bg-primary-100 transition-colors cursor-copy" title="Click para copiar">
                    {v}
                  </button>
                ))}
              </div>
              <div className="space-y-5">
                <div>
                  <label className={`${labelCls} flex justify-between`}>Mensaje de Bienvenida</label>
                  <textarea rows={3} value={templatesData.welcomeMessage} onChange={e => setTemplatesData({...templatesData, welcomeMessage: e.target.value})} className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className={`${labelCls} flex justify-between`}>Envío de Cotización</label>
                  <textarea rows={3} value={templatesData.quoteMessage} onChange={e => setTemplatesData({...templatesData, quoteMessage: e.target.value})} className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className={`${labelCls} flex justify-between`}>Recordatorio de Reunión</label>
                  <textarea rows={3} value={templatesData.meetingReminder} onChange={e => setTemplatesData({...templatesData, meetingReminder: e.target.value})} className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className={`${labelCls} flex justify-between`}>Mensaje de Seguimiento</label>
                  <textarea rows={3} value={templatesData.followUpMessage} onChange={e => setTemplatesData({...templatesData, followUpMessage: e.target.value})} className={`${inputCls} resize-none`} />
                </div>

                <div className="pt-8 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Plantillas de WhatsApp (Meta)</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Gestiona las plantillas aprobadas en tu Business Manager de Meta.</p>
                    </div>
                    <button
                      onClick={() => {
                        const newTpl = {
                          id: `tpl-${Date.now()}`,
                          name: 'Nueva Plantilla',
                          metaTemplateName: '',
                          languageCode: 'es_MX',
                          category: 'UTILITY' as const,
                          bodyPreview: '',
                          variables: [],
                          isActive: true,
                        };
                        setWhatsappTemplatesData([...whatsappTemplatesData, newTpl]);
                      }}
                      className="text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 rounded-lg transition-colors flex items-center"
                    >
                      + Añadir Plantilla
                    </button>
                  </div>

                  <div className="space-y-4">
                    {whatsappTemplatesData?.map((tpl: any, index: number) => (
                      <div key={tpl.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nombre Descriptivo</label>
                              <input 
                                type="text" 
                                value={tpl.name} 
                                onChange={e => {
                                  const newList = [...whatsappTemplatesData];
                                  newList[index] = { ...tpl, name: e.target.value };
                                  setWhatsappTemplatesData(newList);
                                }} 
                                className={inputCls} 
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Nombre en Meta (API Name)</label>
                              <input 
                                type="text" 
                                value={tpl.metaTemplateName} 
                                onChange={e => {
                                  const newList = [...whatsappTemplatesData];
                                  newList[index] = { ...tpl, metaTemplateName: e.target.value };
                                  setWhatsappTemplatesData(newList);
                                }} 
                                className={`${inputCls} font-mono text-xs`} 
                                placeholder="ej: seguimiento_comercial"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const newList = whatsappTemplatesData.filter((_, i) => i !== index);
                                setWhatsappTemplatesData(newList);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Categoría</label>
                            <select 
                              value={tpl.category} 
                              onChange={e => {
                                const newList = [...whatsappTemplatesData];
                                newList[index] = { ...tpl, category: e.target.value as any };
                                setWhatsappTemplatesData(newList);
                              }} 
                              className={inputCls}
                            >
                              <option value="UTILITY">Utilidad</option>
                              <option value="MARKETING">Marketing</option>
                              <option value="AUTHENTICATION">Autenticación</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Idioma</label>
                            <input 
                              type="text" 
                              value={tpl.languageCode} 
                              onChange={e => {
                                const newList = [...whatsappTemplatesData];
                                newList[index] = { ...tpl, languageCode: e.target.value };
                                setWhatsappTemplatesData(newList);
                              }} 
                              className={inputCls} 
                              placeholder="es_MX"
                            />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex items-center cursor-pointer select-none">
                              <input 
                                type="checkbox" 
                                checked={tpl.isActive} 
                                onChange={e => {
                                  const newList = [...whatsappTemplatesData];
                                  newList[index] = { ...tpl, isActive: e.target.checked };
                                  setWhatsappTemplatesData(newList);
                                }}
                                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span className="ml-2 text-sm font-medium text-slate-700 dark:text-slate-300">Activa</span>
                            </label>
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Vista Previa del Cuerpo</label>
                          <textarea 
                            rows={3} 
                            value={tpl.bodyPreview} 
                            onChange={e => {
                              const newList = [...whatsappTemplatesData];
                              newList[index] = { ...tpl, bodyPreview: e.target.value };
                              setWhatsappTemplatesData(newList);
                            }} 
                            className={`${inputCls} resize-none`} 
                            placeholder="Hola {{1}}, gracias por tu interés..."
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Variables (Etiquetas)</label>
                          <input 
                            type="text" 
                            value={tpl.variables.join(', ')} 
                            onChange={e => {
                              const newList = [...whatsappTemplatesData];
                              newList[index] = { ...tpl, variables: e.target.value.split(',').map(s => s.trim()).filter(s => s) };
                              setWhatsappTemplatesData(newList);
                            }} 
                            className={inputCls} 
                            placeholder="Nombre Cliente, Empresa, etc."
                          />
                          <p className="text-[10px] text-slate-400 mt-1 italic">Separa por comas. Estas etiquetas aparecerán en el formulario de envío.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: PIPELINE CRM ═══ */}
          {activeTab === 'pipeline' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Pipeline CRM</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Configura las etapas del embudo de ventas. Estos stages se aplicarán al CRM en una fase posterior.</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <span className="text-lg leading-none">⚡</span>
                <span>Los cambios aquí se guardan en configuración. El CRM seguirá usando las etapas actuales hasta que se active la conexión dinámica.</span>
              </div>
              <PipelineEditor
                stages={pipelineData.stages}
                onChange={(stages) => setPipelineData({ stages })}
              />
              {/* Visual summary */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 uppercase tracking-wider">Vista Previa del Pipeline</h3>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {pipelineData.stages.map(s => (
                    <div key={s.id} className="flex-shrink-0 rounded-lg px-4 py-2.5 text-xs font-semibold text-white min-w-[100px] text-center" style={{ backgroundColor: s.color }}>
                      {s.label}
                      {s.isDefault && <span className="block text-[10px] font-normal opacity-80 mt-0.5">Default</span>}
                      {s.isClosed && <span className="block text-[10px] font-normal opacity-80 mt-0.5">Cierre</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
