import { useState, useEffect } from 'react';
import { 
  Blocks, MessageCircle, Database, Mail, Calendar, 
  FormInput, Webhook, ArrowRight, AlertCircle, 
  CheckCircle2, Save, X, Bot, Zap, Sparkles, MessageSquare 
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { IntegrationService, WhatsAppIntegration, MetaIntegration } from '@/services/firebase/IntegrationService';

export const IntegrationsPlaceholderView = () => {
  const { activeMembership } = useAuthStore();
  const [waConfig, setWaConfig] = useState<WhatsAppIntegration | null>(null);
  const [fbConfig, setFbConfig] = useState<MetaIntegration | null>(null);
  const [igConfig, setIgConfig] = useState<MetaIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modal active state
  const [activeModal, setActiveModal] = useState<'whatsapp' | 'facebook' | 'instagram' | null>(null);

  // Form States
  const [waForm, setWaForm] = useState({
    phoneNumberId: '',
    whatsappBusinessAccountId: '',
    appSecret: '',
    verifyToken: '',
    accessToken: '',
    isActive: true,
    isAiAutomated: true
  });

  const [fbForm, setFbForm] = useState({
    platformId: '',
    accessToken: '',
    isActive: true,
    isAiAutomated: true
  });

  const [igForm, setIgForm] = useState({
    platformId: '',
    accessToken: '',
    isActive: true,
    isAiAutomated: true
  });

  useEffect(() => {
    if (activeMembership) {
      loadAllConfigs();
    }
  }, [activeMembership]);

  const loadAllConfigs = async () => {
    try {
      setLoading(true);
      if (!activeMembership) return;
      const tenantId = activeMembership.tenantId;

      const [wa, fb, ig] = await Promise.all([
        IntegrationService.getWhatsAppConfig(tenantId),
        IntegrationService.getMetaConfig(tenantId, 'facebook'),
        IntegrationService.getMetaConfig(tenantId, 'instagram')
      ]);

      if (wa) {
        setWaConfig(wa);
        setWaForm({
          phoneNumberId: wa.phoneNumberId || '',
          whatsappBusinessAccountId: wa.whatsappBusinessAccountId || '',
          appSecret: wa.appSecret || '',
          verifyToken: wa.verifyToken || '',
          accessToken: wa.accessToken || '',
          isActive: wa.isActive ?? true,
          isAiAutomated: wa.isAiAutomated ?? true
        });
      }

      if (fb) {
        setFbConfig(fb);
        setFbForm({
          platformId: fb.platformId || '',
          accessToken: fb.accessToken || '',
          isActive: fb.isActive ?? true,
          isAiAutomated: fb.isAiAutomated ?? true
        });
      }

      if (ig) {
        setIgConfig(ig);
        setIgForm({
          platformId: ig.platformId || '',
          accessToken: ig.accessToken || '',
          isActive: ig.isActive ?? true,
          isAiAutomated: ig.isAiAutomated ?? true
        });
      }
    } catch (error) {
      console.error('Error loading integration configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership) return;
    try {
      setSaving(true);
      await IntegrationService.saveWhatsAppConfig(activeMembership.tenantId, waForm);
      await loadAllConfigs();
      setActiveModal(null);
    } catch (error) {
      console.error('Error saving WhatsApp config:', error);
      alert('Error guardando configuración de WhatsApp');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveFacebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership) return;
    try {
      setSaving(true);
      await IntegrationService.saveMetaConfig(activeMembership.tenantId, 'facebook', fbForm);
      await loadAllConfigs();
      setActiveModal(null);
    } catch (error) {
      console.error('Error saving Facebook config:', error);
      alert('Error guardando configuración de Facebook');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInstagram = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership) return;
    try {
      setSaving(true);
      await IntegrationService.saveMetaConfig(activeMembership.tenantId, 'instagram', igForm);
      await loadAllConfigs();
      setActiveModal(null);
    } catch (error) {
      console.error('Error saving Instagram config:', error);
      alert('Error guardando configuración de Instagram');
    } finally {
      setSaving(false);
    }
  };

  const openConfigModal = (id: 'whatsapp' | 'facebook' | 'instagram') => {
    setActiveModal(id);
  };

  const integrations = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Cloud API',
      description: 'Conecta tu línea oficial de WhatsApp Business para recibir, enviar y automatizar mensajes con IA.',
      icon: MessageCircle,
      status: loading ? 'soon' : (waConfig?.isActive ? 'connected' : 'pending'),
      statusText: loading ? 'Cargando...' : (waConfig?.isActive ? 'CONECTADO REAL' : 'Pendiente'),
      color: waConfig?.isActive ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-slate-500',
      isAiActive: waConfig?.isAiAutomated,
      action: () => openConfigModal('whatsapp')
    },
    {
      id: 'facebook',
      name: 'Facebook Messenger',
      description: 'Centraliza chats de tu Fanpage y activa el Piloto Automático con IA para cerrar ventas 24/7.',
      icon: MessageSquare,
      status: loading ? 'soon' : (fbConfig?.isActive ? 'connected' : 'pending'),
      statusText: loading ? 'Cargando...' : (fbConfig?.isActive ? 'CONECTADO REAL' : 'Pendiente'),
      color: fbConfig?.isActive ? 'bg-[#1877F2] shadow-blue-500/20' : 'bg-slate-500',
      isAiActive: fbConfig?.isAiAutomated,
      action: () => openConfigModal('facebook')
    },
    {
      id: 'instagram',
      name: 'Instagram Direct Messages',
      description: 'Sincroniza tus DMs de Instagram comercial y automatiza con Gemini 1.5 Flash.',
      icon: Sparkles,
      status: loading ? 'soon' : (igConfig?.isActive ? 'connected' : 'pending'),
      statusText: loading ? 'Cargando...' : (igConfig?.isActive ? 'CONECTADO REAL' : 'Pendiente'),
      color: igConfig?.isActive ? 'bg-gradient-to-tr from-[#FFB900] via-[#D1005E] to-[#C100B4] shadow-pink-500/20' : 'bg-slate-500',
      isAiActive: igConfig?.isAiAutomated,
      action: () => openConfigModal('instagram')
    },
    {
      id: 'mail',
      name: 'Servidor de Correo (SMTP)',
      description: 'Envío de cotizaciones, recibos y notificaciones automáticas por correo electrónico.',
      icon: Mail,
      status: 'disconnected',
      statusText: 'No Conectada',
      color: 'bg-indigo-500',
      isAiActive: false
    },
    {
      id: 'calendar',
      name: 'Google Calendar / Outlook',
      description: 'Sincronización bidireccional de la agenda de ventas e instalaciones de paneles.',
      icon: Calendar,
      status: 'soon',
      statusText: 'Próximamente',
      color: 'bg-sky-500',
      isAiActive: false
    },
    {
      id: 'webhooks',
      name: 'Webhooks Personalizados',
      description: 'Envía y recibe información de sistemas externos vía peticiones HTTP.',
      icon: Webhook,
      status: 'soon',
      statusText: 'Próximamente',
      color: 'bg-slate-700',
      isAiActive: false
    }
  ];

  const getStatusBadge = (status: string, text: string, isAiActive?: boolean) => {
    switch (status) {
      case 'connected':
        return (
          <div className="flex flex-col items-end gap-1.5">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 animate-pulse">
              <CheckCircle2 className="w-3 h-3 mr-1" /> {text}
            </span>
            {isAiActive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-purple-500 text-white shadow-lg shadow-purple-500/30">
                <Bot className="w-2.5 h-2.5 mr-0.5" /> PILOTO AUTOMÁTICO ACTIVO
              </span>
            )}
          </div>
        );
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><AlertCircle className="w-3 h-3 mr-1" /> {text}</span>;
      case 'disconnected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">{text}</span>;
      case 'soon':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{text}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-8 font-sans pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="p-4 rounded-3xl bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-xl shadow-indigo-500/10 shrink-0">
            <Blocks className="w-8 h-8 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Multicanal & Integraciones</h1>
              <span className="px-2.5 py-0.5 bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[9px] font-black uppercase tracking-widest rounded-full">
                Hub OS
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Conecta y centraliza tus canales de chat de WhatsApp, Facebook e Instagram. ¡Habilita el Piloto Automático con Gemini para responder de forma autónoma!
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <div key={integration.id} className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-lg hover:-translate-y-0.5">
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3.5 rounded-2xl text-white shadow-lg ${integration.color}`}>
                  <integration.icon className="w-6 h-6" />
                </div>
                {getStatusBadge(integration.status, integration.statusText, integration.isAiActive)}
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{integration.name}</h3>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-6 flex-1 leading-relaxed">{integration.description}</p>
            </div>
            
            <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-700">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                {integration.id === 'whatsapp' || integration.id === 'facebook' || integration.id === 'instagram' ? (
                  <>
                    <Zap className="w-3 h-3 text-indigo-500" /> Canal de Soporte/Ventas
                  </>
                ) : 'Módulo Opcional'}
              </span>
              <button 
                onClick={integration.action}
                disabled={!integration.action}
                className="text-xs font-black uppercase tracking-wider text-[#1877F2] hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 flex items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Configurar <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* WhatsApp Modal */}
      {activeModal === 'whatsapp' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center">
                <MessageCircle className="w-5 h-5 mr-2 text-emerald-500" />
                Configurar WhatsApp Cloud API
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveWhatsApp} className="p-6 space-y-4">
              <div className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-4 rounded-2xl text-xs font-semibold leading-relaxed">
                Obtén estos datos desde tu portal de Meta Developers para tu App vinculada.
                La URL del webhook debe apuntar a la Cloud Function de este sistema.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Phone Number ID</label>
                  <input
                    type="text"
                    required
                    value={waForm.phoneNumberId}
                    onChange={(e) => setWaForm({...waForm, phoneNumberId: e.target.value})}
                    placeholder="Ej. 101234567890123"
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">WA Business Account ID</label>
                  <input
                    type="text"
                    required
                    value={waForm.whatsappBusinessAccountId}
                    onChange={(e) => setWaForm({...waForm, whatsappBusinessAccountId: e.target.value})}
                    placeholder="Ej. 110234567890123"
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Verify Token (Webhook)</label>
                  <input
                    type="text"
                    required
                    value={waForm.verifyToken}
                    onChange={(e) => setWaForm({...waForm, verifyToken: e.target.value})}
                    placeholder="Tu token secreto para Meta"
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">App Secret</label>
                  <input
                    type="password"
                    required
                    value={waForm.appSecret}
                    onChange={(e) => setWaForm({...waForm, appSecret: e.target.value})}
                    placeholder="Para validación de firma"
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">System User Access Token</label>
                <input
                  type="password"
                  required
                  value={waForm.accessToken}
                  onChange={(e) => setWaForm({...waForm, accessToken: e.target.value})}
                  placeholder="Token permanente EA..."
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl flex flex-col gap-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-500 text-white rounded-lg">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 dark:text-white leading-none">Piloto Automático Inteligente</p>
                      <p className="text-[10px] font-semibold text-slate-400 mt-1">Google Gemini 1.5 responde de forma autónoma.</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={waForm.isAiAutomated}
                      onChange={(e) => setWaForm({...waForm, isAiAutomated: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              </div>

              <div className="flex items-center mt-2">
                <input
                  type="checkbox"
                  id="waIsActive"
                  checked={waForm.isActive}
                  onChange={(e) => setWaForm({...waForm, isActive: e.target.checked})}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="waIsActive" className="ml-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Integración Activa
                </label>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-5 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-black uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : (
                    <>
                      <Save className="w-4 h-4 mr-2" /> Guardar Configuración
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Facebook Modal */}
      {activeModal === 'facebook' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center">
                <MessageSquare className="w-5 h-5 mr-2 text-[#1877F2]" />
                Configurar Facebook Messenger API
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveFacebook} className="p-6 space-y-4">
              <div className="bg-blue-500/10 text-[#1877F2] dark:text-blue-300 p-4 rounded-2xl text-xs font-semibold leading-relaxed">
                Ingresa tu Facebook Page ID y tu Access Token generado desde el portal de Meta para Developers para activar la sincronización del buzón.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Facebook Page ID</label>
                <input
                  type="text"
                  required
                  value={fbForm.platformId}
                  onChange={(e) => setFbForm({...fbForm, platformId: e.target.value})}
                  placeholder="Ej. 906688959199328"
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Page Access Token</label>
                <input
                  type="password"
                  required
                  value={fbForm.accessToken}
                  onChange={(e) => setFbForm({...fbForm, accessToken: e.target.value})}
                  placeholder="EA..."
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
                />
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl flex flex-col gap-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-500 text-white rounded-lg">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 dark:text-white leading-none">Piloto Automático Inteligente</p>
                      <p className="text-[10px] font-semibold text-slate-400 mt-1">Google Gemini 1.5 responde de forma autónoma.</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={fbForm.isAiAutomated}
                      onChange={(e) => setFbForm({...fbForm, isAiAutomated: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              </div>

              <div className="flex items-center mt-2">
                <input
                  type="checkbox"
                  id="fbIsActive"
                  checked={fbForm.isActive}
                  onChange={(e) => setFbForm({...fbForm, isActive: e.target.checked})}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="fbIsActive" className="ml-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Integración Activa
                </label>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-5 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-black uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-[#1877F2] hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : (
                    <>
                      <Save className="w-4 h-4 mr-2" /> Guardar Configuración
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Instagram Modal */}
      {activeModal === 'instagram' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/65 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center">
                <Sparkles className="w-5 h-5 mr-2 text-pink-500" />
                Configurar Instagram DM API
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveInstagram} className="p-6 space-y-4">
              <div className="bg-pink-500/10 text-pink-700 dark:text-pink-300 p-4 rounded-2xl text-xs font-semibold leading-relaxed">
                Ingresa tu Instagram Business Account ID y tu Access Token generado para conectar tu bandeja en el CRM multiagente.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Instagram Account ID</label>
                <input
                  type="text"
                  required
                  value={igForm.platformId}
                  onChange={(e) => setIgForm({...igForm, platformId: e.target.value})}
                  placeholder="Ej. 17841479625483131"
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Page Access Token</label>
                <input
                  type="password"
                  required
                  value={igForm.accessToken}
                  onChange={(e) => setIgForm({...igForm, accessToken: e.target.value})}
                  placeholder="EA..."
                  className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl flex flex-col gap-3 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-500 text-white rounded-lg">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 dark:text-white leading-none">Piloto Automático Inteligente</p>
                      <p className="text-[10px] font-semibold text-slate-400 mt-1">Google Gemini 1.5 responde de forma autónoma.</p>
                    </div>
                  </div>
                  <label className="relative inline-flex inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={igForm.isAiAutomated}
                      onChange={(e) => setIgForm({...igForm, isAiAutomated: e.target.checked})}
                    />
                    <div className="w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                  </label>
                </div>
              </div>

              <div className="flex items-center mt-2">
                <input
                  type="checkbox"
                  id="igIsActive"
                  checked={igForm.isActive}
                  onChange={(e) => setIgForm({...igForm, isActive: e.target.checked})}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <label htmlFor="igIsActive" className="ml-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Integración Activa
                </label>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-5 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-black uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-gradient-to-r from-pink-500 to-purple-600 hover:opacity-95 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : (
                    <>
                      <Save className="w-4 h-4 mr-2" /> Guardar Configuración
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
