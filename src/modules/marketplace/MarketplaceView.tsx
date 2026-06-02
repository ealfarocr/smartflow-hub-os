import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag,
  CheckCircle2,
  Plus,
  Loader2,
  Zap,
  ShoppingCart,
  RefreshCw,
  ArrowLeft,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SuperAdminService } from '@/services/firebase/SuperAdminService';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';
import { ToolLibraryRecord, TenantFeatures } from '@/types';
import * as LucideIcons from 'lucide-react';

const TOOLS_FALLBACK: ToolLibraryRecord[] = [
  { id: 't1',  key: 'hasCrm',            label: 'CRM Base',              desc: 'Gestión de leads y ventas. Gratis para siempre.',                   iconName: 'Users',         color: '#10B981', isActive: true, order: 0,   price: 0,  isFree: true  },
  { id: 't2',  key: 'hasTasks',           label: 'Gestor de Listas',      desc: 'Organiza tareas y pendientes de tu negocio de forma ágil.',          iconName: 'LayoutList',    color: '#1877F2', isActive: true, order: 0.5, price: 0,  isFree: true  },
  { id: 't3',  key: 'hasPackages',        label: 'Paquetes Comerciales',  desc: 'Agrupa ofertas para cargarlas en bloque al cotizar. Incluido.',      iconName: 'Package',       color: '#EC4899', isActive: true, order: 1,   price: 0,  isFree: true  },
  { id: 't4',  key: 'hasMultiAgent',      label: 'WhatsApp Administrado', desc: 'CRM multi-agente con WhatsApp API oficial y 300 créditos.',          iconName: 'MessageSquare', color: '#25D366', isActive: true, order: 2,   price: 69, isFree: false },
  { id: 't5',  key: 'hasAiAgent',         label: 'Agente IA 24/7',        desc: 'IA que responde, califica prospectos y agenda citas automáticamente.',iconName: 'Bot',           color: '#8B5CF6', isActive: true, order: 3,   price: 49, isFree: false },
  { id: 't6',  key: 'hasQualityAuditor',  label: 'Auditor de Vendedores', desc: 'Analiza chats y detecta cierres perdidos con IA.',                  iconName: 'ShieldCheck',   color: '#F59E0B', isActive: true, order: 4,   price: 25, isFree: false },
  { id: 't7',  key: 'hasPaymentLinks',    label: 'Links de Pago',         desc: 'Cobra por WhatsApp con enlaces seguros de pago con tarjeta o PayPal.',iconName: 'CreditCard',   color: '#1877F2', isActive: true, order: 5,   price: 12, isFree: false },
  { id: 't8',  key: 'hasQuotes',          label: 'Cotizaciones PDF',      desc: 'Genera propuestas y cotizaciones profesionales en segundos.',        iconName: 'FileText',      color: '#0EA5E9', isActive: true, order: 6,   price: 15, isFree: false },
  { id: 't9',  key: 'hasCatalog',         label: 'Catálogo',              desc: 'Organiza productos, servicios y precios para tus cotizaciones.',     iconName: 'FolderClosed',  color: '#7C3AED', isActive: true, order: 7,   price: 27, isFree: false },
  { id: 't10', key: 'hasAgenda',          label: 'Agenda Inteligente',    desc: 'Calendario de citas con recordatorios y confirmación automática.',   iconName: 'Calendar',      color: '#10B981', isActive: true, order: 8,   price: 20, isFree: false },
];

const PayPalButton = ({ amount, onSuccess, isVisible }: { amount: number; onSuccess: () => void; isVisible: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isVisible || amount <= 0 || !containerRef.current) return;
    containerRef.current.innerHTML = '';
    if ((window as any).paypal) {
      (window as any).paypal.Buttons({
        style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
        createOrder: (_: any, actions: any) =>
          actions.order.create({ purchase_units: [{ description: 'Suscripción SmartFlow Hub', amount: { currency_code: 'USD', value: amount.toString() } }] }),
        onApprove: async (_: any, actions: any) => { await actions.order.capture(); onSuccess(); },
        onError: (err: any) => console.error('PayPal Error:', err),
      }).render(containerRef.current);
    }
  }, [amount, isVisible]);

  return <div ref={containerRef} className="w-full min-h-[150px]" />;
};

export const MarketplaceView = () => {
  const { activeMembership, user } = useAuthStore();
  const { features, updateSettings } = useSettingsStore();
  const { addToast } = useUIStore();

  const isSuperAdmin = !!user?.isSuperAdmin;

  const [tools, setTools] = useState<ToolLibraryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPayPal, setShowPayPal] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [localFeatures, setLocalFeatures] = useState<Partial<TenantFeatures> | null>(null);
  const [flyingIcons, setFlyingIcons] = useState<{ id: string; startX: number; startY: number; targetX: number; targetY: number; icon: any }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const cartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test'}&currency=USD`;
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  useEffect(() => {
    if (features && !localFeatures) setLocalFeatures(features);
  }, [features]);

  const triggerFlyAnimation = (e: React.MouseEvent, iconName: string) => {
    const Icon = (LucideIcons as any)[iconName] || LucideIcons.Package;
    const id = Math.random().toString(36).substring(2, 11);
    let targetX = window.innerWidth - 100;
    let targetY = 100;
    if (cartRef.current) {
      const rect = cartRef.current.getBoundingClientRect();
      targetX = rect.left + rect.width / 2;
      targetY = rect.top + rect.height / 2;
    }
    setFlyingIcons(prev => [...prev, { id, startX: e.clientX, startY: e.clientY, targetX, targetY, icon: Icon }]);
    setTimeout(() => setFlyingIcons(prev => prev.filter(i => i.id !== id)), 800);
  };

  const loadTools = async (force = false) => {
    if (force) setIsLoading(true);
    try {
      const dbTools = await SuperAdminService.listAvailableTools();
      const merged = TOOLS_FALLBACK.map(fallback => {
        const fromDb = dbTools.find(t => t.key === fallback.key);
        return { ...fallback, isActive: fromDb ? fromDb.isActive : fallback.isActive, price: (fromDb && fromDb.price !== undefined) ? fromDb.price : fallback.price };
      });
      setTools(merged);
    } catch {
      setTools(TOOLS_FALLBACK);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadTools(); }, []);

  const handleToggleLocal = (e: React.MouseEvent, tool: ToolLibraryRecord) => {
    if (!localFeatures) return;
    const key = tool.key as keyof TenantFeatures;
    if (!localFeatures[key]) triggerFlyAnimation(e, tool.iconName);
    setLocalFeatures(prev => prev ? { ...prev, [key]: !prev[key] } : prev);
  };

  const handleSaveSubscription = async () => {
    if (!activeMembership?.tenantId || !localFeatures) return;
    setIsSaving(true);
    try {
      await updateSettings(activeMembership.tenantId, { features: localFeatures });
      addToast('Suscripción actualizada con éxito', 'success');
    } catch {
      addToast('Error al procesar el pago', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdminTrialMode = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      const all: TenantFeatures = { hasCrm: true, hasQuotes: true, hasPackages: true, hasAgenda: true, hasAiAgent: true, hasMultiAgent: true, hasQualityAuditor: true, hasPaymentLinks: true, hasCatalog: true, hasIntegrations: true };
      await updateSettings(activeMembership.tenantId, { features: all });
      setLocalFeatures(all);
      addToast('Modo Prueba: todas las herramientas activadas.', 'success');
    } catch {
      addToast('Error al activar modo prueba', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const premiumTotal = () => {
    if (!localFeatures) return 0;
    return tools.reduce((acc, t) => localFeatures[t.key as keyof TenantFeatures] && !t.isFree && t.price > 0 ? acc + t.price : acc, 0);
  };
  const finalTotal = () => { const r = premiumTotal(); return r > 197 ? 197 : r; };
  const activeTools = () => localFeatures ? tools.filter(t => localFeatures[t.key as keyof TenantFeatures]) : [];
  const availableTools = () => tools.filter(t => t.isActive !== false && !localFeatures?.[t.key as keyof TenantFeatures] && !t.isFree && t.price > 0);

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
        <p className="text-sm text-slate-400 font-medium">Cargando módulos...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20 relative">

      {/* Flying Icons */}
      <AnimatePresence>
        {flyingIcons.map(item => (
          <motion.div
            key={item.id}
            initial={{ x: item.startX - 24, y: item.startY - 24, opacity: 1, scale: 1 }}
            animate={{ x: item.targetX - 24, y: item.targetY - 24, opacity: 0, scale: 0.2 }}
            transition={{ duration: 0.65, ease: [0.32, 0.72, 0, 1] }}
            className="fixed top-0 left-0 z-[100] pointer-events-none text-[#1877F2] bg-white rounded-full p-3 shadow-xl"
          >
            <item.icon className="w-5 h-5" />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-800 px-8 py-6 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-[#1877F2] rounded-2xl shadow-lg shadow-blue-500/25">
            <ShoppingBag className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Tienda Hub</h1>
            <p className="text-sm text-slate-500 font-medium">Activa solo los módulos que tu negocio necesita</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-200 dark:border-emerald-800">
            <div className="relative flex-shrink-0">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-ping absolute" />
              <div className="w-2 h-2 bg-emerald-400 rounded-full relative" />
            </div>
            <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-widest">CRM Gratis de por vida</span>
          </div>

          <button
            onClick={() => loadTools(true)}
            className="p-2.5 text-slate-400 hover:text-[#1877F2] hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all"
            title="Actualizar módulos"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {isSuperAdmin && (
            <button
              onClick={handleAdminTrialMode}
              disabled={isSaving}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black flex items-center gap-2 transition-all disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-white" />
              Activar Todo
            </button>
          )}
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

        {/* ── Left: Module sections ── */}
        <div className="lg:col-span-3 space-y-8">

          {/* Tu Plan Actual */}
          {activeTools().length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <h2 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Tu Plan Actual</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <AnimatePresence mode="popLayout">
                  {activeTools().map(tool => {
                    const Icon = (LucideIcons as any)[tool.iconName] || LucideIcons.Package;
                    return (
                      <motion.div
                        layout
                        key={tool.id}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm"
                      >
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${tool.color}18`, color: tool.color }}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-900 dark:text-white truncate">{tool.label}</p>
                          <p className="text-xs text-slate-400 font-medium">
                            {tool.isFree || tool.price === 0 ? 'Incluido gratis' : `$${tool.price} USD/mes`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-6 h-6 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          </div>
                          {!tool.isFree && tool.key !== 'hasCrm' && (
                            <button
                              onClick={e => handleToggleLocal(e, tool)}
                              className="w-6 h-6 text-slate-300 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full flex items-center justify-center transition-all"
                              title="Quitar módulo"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* Módulos Disponibles */}
          {availableTools().length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <Plus className="w-4 h-4 text-slate-400" />
                <h2 className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  Módulos Disponibles
                  <span className="ml-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full text-[10px] normal-case font-bold tracking-normal">
                    {availableTools().length} disponibles
                  </span>
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <AnimatePresence mode="popLayout">
                  {availableTools().map(tool => {
                    const Icon = (LucideIcons as any)[tool.iconName] || LucideIcons.Package;
                    return (
                      <motion.div
                        layout
                        key={tool.id}
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="group bg-white dark:bg-slate-800 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 hover:border-[#1877F2]/40 dark:hover:border-[#1877F2]/40 hover:shadow-lg transition-all flex flex-col gap-4"
                      >
                        {/* Icon + Price */}
                        <div className="flex items-start justify-between">
                          <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center"
                            style={{ backgroundColor: `${tool.color}15`, color: tool.color }}
                          >
                            <Icon className="w-6 h-6" />
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-black text-slate-900 dark:text-white">${tool.price}</span>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">/mes</p>
                          </div>
                        </div>

                        {/* Text */}
                        <div className="flex-1">
                          <h3 className="font-black text-slate-900 dark:text-white mb-1 text-sm">{tool.label}</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{tool.desc}</p>
                        </div>

                        {/* CTA */}
                        <button
                          onClick={e => handleToggleLocal(e, tool)}
                          className="w-full py-3 bg-[#1877F2] hover:bg-[#166fe5] text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm shadow-blue-500/20"
                        >
                          <Plus className="w-4 h-4" />
                          Agregar al plan
                        </button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </section>
          )}

          {/* Plataforma completa */}
          {availableTools().length === 0 && activeTools().length > 0 && (
            <div className="py-16 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-7 h-7 text-emerald-500" />
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-white mb-1">¡Plataforma completa!</h3>
              <p className="text-sm text-slate-400">Tienes todos los módulos activados.</p>
            </div>
          )}
        </div>

        {/* ── Right: Cart ── */}
        <div className="lg:col-span-1">
          <div ref={cartRef} className="sticky top-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

            {/* Cart header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
              <ShoppingCart className="w-5 h-5 text-[#1877F2]" />
              <h2 className="font-black text-slate-900 dark:text-white">Mi Plan</h2>
            </div>

            {/* Cart items */}
            <div className="px-6 py-4 space-y-1 max-h-60 overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {activeTools().length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">Agrega módulos para ver tu plan</p>
                ) : (
                  activeTools().map(tool => (
                    <motion.div
                      layout
                      key={tool.id}
                      initial={{ x: -8, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: 8, opacity: 0 }}
                      className="flex items-center justify-between py-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tool.color }} />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{tool.label}</span>
                      </div>
                      <span className={`text-xs font-black flex-shrink-0 ml-3 ${tool.isFree || tool.price === 0 ? 'text-emerald-500' : 'text-slate-900 dark:text-white'}`}>
                        {tool.isFree || tool.price === 0 ? 'GRATIS' : `$${tool.price}`}
                      </span>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Total + CTA */}
            <div className="px-6 py-5 border-t border-slate-100 dark:border-slate-700 space-y-5">
              {premiumTotal() > 197 && (
                <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-xl px-4 py-3 text-xs font-bold">
                  🎉 Tope máximo — el resto es gratis
                </div>
              )}

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total mensual</p>
                  <motion.p
                    key={finalTotal()}
                    initial={{ y: 4, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="text-3xl font-black text-slate-900 dark:text-white"
                  >
                    ${finalTotal()} <span className="text-sm font-bold text-slate-400">USD</span>
                  </motion.p>
                </div>
                {premiumTotal() > 197 && (
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-1.5 rounded-full">
                    Ahorras ${premiumTotal() - 197}
                  </span>
                )}
              </div>

              {!showPayPal ? (
                <div className="space-y-3">
                  {!isSuperAdmin && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={e => setTermsAccepted(e.target.checked)}
                        className="mt-0.5 rounded text-[#1877F2] shrink-0"
                      />
                      <span className="text-[10px] text-slate-500 leading-relaxed">
                        Acepto los{' '}
                        <a href="https://smartflow-suite.com/terminos" target="_blank" rel="noreferrer" className="text-[#1877F2] underline">Términos de Servicio</a>
                        {' '}y la{' '}
                        <a href="https://smartflow-suite.com/privacidad" target="_blank" rel="noreferrer" className="text-[#1877F2] underline">Política de Privacidad</a>.
                        {' '}No se ofrecen reembolsos por períodos parciales ya facturados.
                      </span>
                    </label>
                  )}
                  <button
                    onClick={() => isSuperAdmin ? handleSaveSubscription() : setShowPayPal(true)}
                    disabled={finalTotal() <= 0 || isSaving || (!isSuperAdmin && !termsAccepted)}
                    className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-white" />}
                    {isSaving ? 'Procesando...' : isSuperAdmin ? 'Activar (Admin)' : 'Confirmar y Pagar'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={() => setShowPayPal(false)}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 w-full justify-center transition-colors"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Volver a editar
                  </button>
                  <PayPalButton amount={finalTotal()} onSuccess={handleSaveSubscription} isVisible={showPayPal} />
                </div>
              )}

              <p className="text-[9px] text-slate-400 text-center leading-relaxed">
                Se activa de inmediato tras confirmar el pago.<br />
                Tarifas de mensajería de Meta pueden aplicar según consumo.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
