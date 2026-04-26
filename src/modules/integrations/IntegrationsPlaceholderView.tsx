import { useState, useEffect } from 'react';
import { Blocks, MessageCircle, Database, Mail, Calendar, FormInput, Webhook, ArrowRight, AlertCircle, CheckCircle2, Save, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { IntegrationService, WhatsAppIntegration } from '@/services/firebase/IntegrationService';

export const IntegrationsPlaceholderView = () => {
  const { activeMembership } = useAuthStore();
  const [waConfig, setWaConfig] = useState<WhatsAppIntegration | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    phoneNumberId: '',
    whatsappBusinessAccountId: '',
    appSecret: '',
    verifyToken: '',
    accessToken: '',
    isActive: true
  });

  useEffect(() => {
    if (activeMembership) {
      loadWhatsAppConfig();
    }
  }, [activeMembership]);

  const loadWhatsAppConfig = async () => {
    try {
      setLoading(true);
      if (!activeMembership) return;
      const config = await IntegrationService.getWhatsAppConfig(activeMembership.tenantId);
      if (config) {
        setWaConfig(config);
        setFormData({
          phoneNumberId: config.phoneNumberId || '',
          whatsappBusinessAccountId: config.whatsappBusinessAccountId || '',
          appSecret: config.appSecret || '',
          verifyToken: config.verifyToken || '',
          accessToken: config.accessToken || '',
          isActive: config.isActive ?? true
        });
      }
    } catch (error) {
      console.error('Error loading WhatsApp config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership) return;
    try {
      setSaving(true);
      await IntegrationService.saveWhatsAppConfig(activeMembership.tenantId, formData);
      await loadWhatsAppConfig();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error guardando configuración');
    } finally {
      setSaving(false);
    }
  };

  const integrations = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Cloud API',
      description: 'Conecta tu línea oficial de WhatsApp Business para recibir y enviar mensajes desde el CRM.',
      icon: MessageCircle,
      status: loading ? 'soon' : (waConfig?.isActive ? 'connected' : 'pending'),
      statusText: loading ? 'Cargando...' : (waConfig?.isActive ? 'Conectado' : 'Pendiente de Configuración'),
      color: waConfig?.isActive ? 'bg-emerald-500' : 'bg-slate-500',
      action: () => setIsModalOpen(true)
    },
    {
      id: 'firebase',
      name: 'Firebase Realtime & Auth',
      description: 'Sincronización en tiempo real y autenticación robusta para todos los tenants.',
      icon: Database,
      status: 'soon',
      statusText: 'Próximamente en Fase 2',
      color: 'bg-orange-500'
    },
    {
      id: 'mail',
      name: 'Servidor de Correo (SMTP)',
      description: 'Envío de cotizaciones, recordatorios y notificaciones automáticas por correo electrónico.',
      icon: Mail,
      status: 'disconnected',
      statusText: 'No Conectada',
      color: 'bg-blue-500'
    },
    {
      id: 'calendar',
      name: 'Google Calendar / Outlook',
      description: 'Sincronización bidireccional de la agenda de ventas e instalaciones.',
      icon: Calendar,
      status: 'soon',
      statusText: 'Próximamente',
      color: 'bg-indigo-500'
    },
    {
      id: 'forms',
      name: 'Formularios Web (Leads)',
      description: 'Inyecta leads directamente desde tu landing page o Facebook Lead Ads.',
      icon: FormInput,
      status: 'disconnected',
      statusText: 'No Conectada',
      color: 'bg-purple-500'
    },
    {
      id: 'webhooks',
      name: 'Webhooks Personalizados',
      description: 'Envía y recibe información de sistemas externos vía peticiones HTTP.',
      icon: Webhook,
      status: 'soon',
      statusText: 'Próximamente',
      color: 'bg-slate-700'
    }
  ];

  const getStatusBadge = (status: string, text: string) => {
    switch (status) {
      case 'connected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3 mr-1" /> {text}</span>;
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"><AlertCircle className="w-3 h-3 mr-1" /> {text}</span>;
      case 'disconnected':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300">{text}</span>;
      case 'soon':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{text}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center">
            <Blocks className="w-6 h-6 mr-3 text-primary-500" />
            Integraciones (Hub)
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Conecta herramientas externas para potenciar la automatización del CRM.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {integrations.map((integration) => (
          <div key={integration.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-md">
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl text-white shadow-inner ${integration.color}`}>
                  <integration.icon className="w-6 h-6" />
                </div>
                {getStatusBadge(integration.status, integration.statusText)}
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">{integration.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 flex-1">{integration.description}</p>
            </div>
            
            <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex items-center justify-between border-t border-slate-100 dark:border-slate-700">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {integration.id === 'whatsapp' ? 'Módulo Core' : 'Opcional'}
              </span>
              <button 
                onClick={integration.action}
                disabled={!integration.action}
                className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 flex items-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                Configurar <ArrowRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Configurations Meta */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 font-sans">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center">
                <MessageCircle className="w-5 h-5 mr-2 text-emerald-500" />
                Configuración Meta App (WhatsApp)
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500 dark:hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 p-4 rounded-lg text-sm mb-4">
                Obtén estos datos desde tu portal de Meta Developers para tu App vinculada.
                La URL del webhook debe apuntar a la Cloud Function de este sistema.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone Number ID</label>
                  <input
                    type="text"
                    required
                    value={formData.phoneNumberId}
                    onChange={(e) => setFormData({...formData, phoneNumberId: e.target.value})}
                    placeholder="Ej. 101234567890123"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">WA Business Account ID</label>
                  <input
                    type="text"
                    required
                    value={formData.whatsappBusinessAccountId}
                    onChange={(e) => setFormData({...formData, whatsappBusinessAccountId: e.target.value})}
                    placeholder="Ej. 110234567890123"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Verify Token (Webhook)</label>
                  <input
                    type="text"
                    required
                    value={formData.verifyToken}
                    onChange={(e) => setFormData({...formData, verifyToken: e.target.value})}
                    placeholder="Tu token secreto para Meta"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">App Secret</label>
                  <input
                    type="password"
                    required
                    value={formData.appSecret}
                    onChange={(e) => setFormData({...formData, appSecret: e.target.value})}
                    placeholder="Para validación de firma"
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">System User Access Token</label>
                <input
                  type="password"
                  required
                  value={formData.accessToken}
                  onChange={(e) => setFormData({...formData, accessToken: e.target.value})}
                  placeholder="Token permanente EA..."
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-sm"
                />
              </div>

              <div className="flex items-center mt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                  className="rounded border-slate-300 text-primary-600 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                />
                <label htmlFor="isActive" className="ml-2 text-sm text-slate-700 dark:text-slate-300">
                  Integración Activa
                </label>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium flex items-center disabled:opacity-50"
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
