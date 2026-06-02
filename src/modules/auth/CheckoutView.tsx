import { useState, useEffect } from 'react';
import {
  Check, ChevronLeft, ShieldCheck, Rocket, ArrowRight,
  Lock, Zap, Building2, Globe, Briefcase, AlertCircle
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { SuperAdminService } from '../../services/firebase/SuperAdminService';
import { OnboardingService } from '../../services/OnboardingService';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

const TOOLS = [
  { id: 't2', key: 'hasMultiAgent',      emoji: '💬', label: 'WhatsApp Coexistente', desc: 'CRM profesional multi-agente con conexión oficial de WhatsApp API y 300 créditos de reactivación.', price: 69 },
  { id: 't3', key: 'hasAiAgent',         emoji: '🤖', label: 'Agente IA',      desc: 'IA que responde, califica y agenda citas automáticamente en el chat.', price: 49 },
  { id: 't4', key: 'hasQualityAuditor',  emoji: '🛡️', label: 'Auditor IA',   desc: 'Audita chats, evalúa asesores y detecta cierres perdidos con IA.',     price: 25 },
  { id: 't5', key: 'hasPaymentLinks',    emoji: '💳', label: 'Links de pago',        desc: 'Genera enlaces de pago y cobro seguro por WhatsApp con tarjeta o PayPal.',      price: 12 },
  { id: 't6', key: 'hasQuotes',          emoji: '📄', label: 'Cotizaciones',     desc: 'Genera cotizaciones y propuestas PDF profesionales en segundos.',    price: 15 },
  { id: 't7', key: 'hasCatalog',         emoji: '📁', label: 'Catálogo',    desc: 'Organiza productos, servicios y precios para tus cotizaciones.',       price: 27 },
  { id: 't9', key: 'hasAgenda',          emoji: '🗓️', label: 'Agenda inteligente',  desc: 'Calendario para agendar citas con recordatorios y confirmación automática.', price: 20 },
];

const PACK_CONFIG: Record<string, { label: string; tools: string[]; price: number; originalPrice: number }> = {
  esencial: { label: 'Pack Esencial',  tools: ['hasMultiAgent', 'hasAiAgent'],                                                                         price: 100, originalPrice: 118 },
  equipo:   { label: 'Pack Equipo',    tools: ['hasMultiAgent', 'hasAiAgent', 'hasQuotes'],                                                             price: 113, originalPrice: 133 },
  completo: { label: 'Stack Completo', tools: ['hasMultiAgent', 'hasAiAgent', 'hasQualityAuditor', 'hasPaymentLinks', 'hasQuotes', 'hasCatalog', 'hasAgenda'], price: 167, originalPrice: 197 },
};

export const CheckoutView = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const packParam = searchParams.get('pack') ?? '';
  const packConfig = PACK_CONFIG[packParam] ?? null;
  const isPackMode = !!packConfig;

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  useEffect(() => {
    if (packConfig) setSelectedTools(packConfig.tools);
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isCheckingTradeName, setIsCheckingTradeName] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  const [formData, setFormData] = useState({
    businessName: '',
    tradeName: '',
    industry: 'Inmobiliaria',
    whatsapp: '',
    adminEmail: '',
    password: '',
    currency: 'USD'
  });

  const steps = [{ title: 'Tu Negocio' }, { title: 'Herramientas' }, { title: 'Confirmar' }];

  const toggleTool = (key: string) =>
    setSelectedTools(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

  const totalRaw = selectedTools.reduce((acc, key) => {
    const t = TOOLS.find(t => t.key === key);
    return acc + (t?.price ?? 0);
  }, 0);
  const total = totalRaw > 197 ? 197 : totalRaw;
  const isCapped = totalRaw > 197;
  const effectiveTotal = packConfig ? packConfig.price : total;

  const slugify = (name: string) =>
    name.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
      .substring(0, 20);

  const handleBusinessNameChange = (value: string) => {
    const auto = slugify(value);
    setFormData(prev => ({
      ...prev,
      businessName: value,
      tradeName: prev.tradeName === '' || prev.tradeName === slugify(prev.businessName) ? auto : prev.tradeName
    }));
  };

  const handleNext = async () => {
    setError('');
    if (currentStep === 0) {
      if (!formData.businessName || !formData.adminEmail || !formData.password) {
        setError('Por favor completa los campos obligatorios (*).');
        return;
      }
      if (formData.password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres.');
        return;
      }
      let tradeName = formData.tradeName || slugify(formData.businessName);
      try {
        setIsCheckingTradeName(true);
        const available = await SuperAdminService.isTenantNameAvailable(tradeName);
        if (!available) tradeName = tradeName + Math.floor(Math.random() * 900 + 100);
        setFormData(prev => ({ ...prev, tradeName }));
      } catch (err) {
        console.error('Error checking trade name:', err);
      } finally {
        setIsCheckingTradeName(false);
      }
    }
    if (currentStep < steps.length - 1) {
      const nextStep = (currentStep === 0 && isPackMode) ? 2 : currentStep + 1;
      setCurrentStep(nextStep);
      window.scrollTo(0, 0);
    } else if (effectiveTotal === 0 || paymentSuccess) {
      handleFinalize();
    }
  };

  const handleFinalize = async () => {
    try {
      setIsSubmitting(true);
      const tradeName = formData.tradeName || slugify(formData.businessName);
      await OnboardingService.registerNewBusiness({
        businessName: formData.businessName,
        tradeName,
        email: formData.adminEmail,
        password: formData.password,
        phone: formData.whatsapp,
        industry: formData.industry,
        selectedFeatures: selectedTools
      });
      setTimeout(() => navigate('/login', {
        state: { message: '¡Tu Hub ha sido creado! Ya puedes iniciar sesión.' }
      }), 2000);
    } catch (err: any) {
      setError(err.message || 'Hubo un error al crear tu cuenta.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inp = "w-full bg-[#F0F5FF] border-2 border-transparent focus:border-[#1877F2] rounded-2xl outline-none transition-all text-sm font-semibold text-slate-900 py-4 px-6";
  const inpIcon = "w-full pl-12 pr-4 bg-[#F0F5FF] border-2 border-transparent focus:border-[#1877F2] rounded-2xl outline-none transition-all text-sm font-semibold text-slate-900 py-4";
  const lbl = "text-[10px] font-black text-slate-400 uppercase tracking-widest";

  return (
    <PayPalScriptProvider options={{ clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || '' }}>
      <div className="min-h-screen bg-[#EEF4FF] flex flex-col">

        {/* Nav */}
        <nav className="h-16 bg-white border-b border-blue-50 px-6 flex items-center justify-between sticky top-0 z-50 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#1877F2] rounded-lg flex items-center justify-center shadow-md shadow-[#1877F2]/30">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className="font-black text-xl tracking-tight text-slate-900">
              SmartFlow <span className="text-[#1877F2]">Hub OS</span>
            </span>
          </div>
          <div className="hidden md:flex items-center gap-1 bg-[#F0F5FF] p-1 rounded-full">
            {steps.map((s, idx) => {
              const isDone = idx < currentStep || (isPackMode && idx === 1 && currentStep === 2);
              return (
              <div key={idx} className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all flex items-center gap-2 ${
                idx === currentStep ? 'bg-white text-[#1877F2] shadow-sm'
                  : isDone ? 'text-emerald-500' : 'text-slate-400'
              }`}>
                {isDone ? <Check className="w-3 h-3" /> : <span>{idx + 1}</span>}
                {s.title}
              </div>
              );
            })}
          </div>
          <span className="text-xs font-bold text-slate-300">AYUDA</span>
        </nav>

        <main className="flex-1 flex items-center justify-center p-4 md:p-8">
          <div className="w-full max-w-5xl bg-white rounded-[2rem] shadow-2xl shadow-blue-100/50 border border-blue-50 flex overflow-hidden" style={{ minHeight: 560 }}>

            {/* Sidebar azul */}
            <div className="w-64 bg-[#1877F2] p-8 hidden lg:flex flex-col justify-between flex-shrink-0">
              <div>
                <p className="text-[10px] font-black text-white/50 uppercase tracking-widest mb-8">Beneficios Hub</p>
                <div className="space-y-7">
                  {[
                    { title: 'CRM Vitalicio', desc: 'Sin límites desde el inicio.', icon: ShieldCheck },
                    { title: 'Escalabilidad', desc: 'Activa lo que necesitas.', icon: Rocket },
                    { title: 'Soporte', desc: 'Expertos a tu lado.', icon: Briefcase }
                  ].map((b, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center text-white flex-shrink-0">
                        <b.icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-tight">{b.title}</p>
                        <p className="text-xs text-white/55 mt-0.5">{b.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-white/10 border border-white/20 p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-white/80 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-black uppercase tracking-wider">Pago Seguro</span>
                </div>
                <p className="text-[10px] text-white/50 leading-relaxed">Encriptación AES-256 de grado bancario.</p>
              </div>
            </div>

            {/* Contenido */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto p-8 md:p-12">

                {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="font-semibold">{error}</p>
                  </div>
                )}


                {/* STEP 0: Datos del negocio */}
                {currentStep === 0 && (
                  <div className="space-y-8">
                    <div>
                      <h2 className="text-3xl font-black text-slate-900 mb-2">Tu Transformación Digital</h2>
                      <p className="text-slate-400 text-sm">Comencemos con los detalles de tu negocio.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="space-y-1.5">
                        <label className={lbl}>Nombre del Negocio *</label>
                        <div className="relative">
                          <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="text" placeholder="Ej: Solar Power MX" className={inpIcon}
                            value={formData.businessName} onChange={(e) => handleBusinessNameChange(e.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className={lbl}>Subdominio (Hub ID)</label>
                        <div className="relative">
                          <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="text" placeholder="ej: solarpower" className={inpIcon}
                            value={formData.tradeName}
                            onChange={(e) => setFormData({ ...formData, tradeName: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })} />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className={lbl}>WhatsApp</label>
                        <input type="tel" placeholder="+52 1 55..." className={inp}
                          value={formData.whatsapp} onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <label className={lbl}>Moneda Principal</label>
                        <select 
                          className={inp}
                          value={formData.currency || 'USD'}
                          onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                        >
                          <option value="USD">🇺🇸 USD - Dólar Estadounidense</option>
                          <option value="MXN">🇲🇽 MXN - Peso Mexicano</option>
                          <option value="CRC">🇨🇷 CRC - Colón Costarricense</option>
                          <option value="COP">🇨🇴 COP - Peso Colombiano</option>
                          <option value="PEN">🇵🇪 PEN - Sol Peruano</option>
                          <option value="CLP">🇨🇱 CLP - Peso Chileno</option>
                          <option value="ARS">🇦🇷 ARS - Peso Argentino</option>
                          <option value="GTQ">🇬🇹 GTQ - Quetzal Guatemalteco</option>
                          <option value="HNL">🇭🇳 HNL - Lempira Hondureña</option>
                          <option value="NIO">🇳🇮 NIO - Córdoba Nicaragüense</option>
                          <option value="SVC">🇸🇻 SVC - Colón Salvadoreño</option>
                          <option value="PAB">🇵🇦 PAB - Balboa Panameño</option>
                          <option value="DOP">🇩🇴 DOP - Peso Dominicano</option>
                          <option value="BOB">🇧🇴 BOB - Boliviano</option>
                          <option value="PYG">🇵🇾 PYG - Guaraní Paraguayo</option>
                          <option value="UYU">🇺🇾 UYU - Peso Uruguayo</option>
                          <option value="EUR">🇪🇺 EUR - Euro</option>
                          <option value="GBP">🇬🇧 GBP - Libra Esterlina</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className={lbl}>Email del Administrador *</label>
                        <input type="email" placeholder="admin@tuempresa.com" className={inp}
                          value={formData.adminEmail} onChange={(e) => setFormData({ ...formData, adminEmail: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <label className={lbl}>Contraseña *</label>
                        <div className="relative">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                          <input type="password" placeholder="Mínimo 6 caracteres" className={inpIcon}
                            value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* STEP 1: Herramientas */}
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-3xl font-black text-slate-900 mb-1">Arma tu Suite Premium</h2>
                        <p className="text-slate-400 text-sm">CRM Base incluido gratis. Elige tus herramientas avanzadas.</p>
                      </div>
                      {total > 0 && (
                        <div className="text-right flex-shrink-0 bg-[#EEF4FF] px-4 py-3 rounded-2xl border border-[#1877F2]/15">
                          <p className="text-[9px] font-black text-[#1877F2] uppercase tracking-widest">Total mensual</p>
                          <p className="text-2xl font-black text-slate-900">
                            {formData.currency === 'CRC' ? '₡' : '$'}
                            {(total * (formData.currency === 'CRC' ? 520 : 1)).toLocaleString()}
                            <span className="text-xs text-slate-400 ml-1">{formData.currency}</span>
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {/* SLOT 1: CRM Base (Siempre Incluido) */}
                      <div className="relative group p-4 rounded-3xl border-2 border-emerald-100 bg-emerald-50/30 flex flex-col items-center text-center transition-all h-full min-h-[140px]">
                        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg mb-3">
                          <Rocket className="w-5 h-5" />
                        </div>
                        <p className="text-[10px] font-black text-emerald-800 uppercase tracking-tight">CRM Base</p>
                        <p className="text-[8px] text-emerald-600 font-bold mt-1 leading-tight px-1">Núcleo Central</p>
                        <div className="mt-auto pt-2">
                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Incluido</span>
                        </div>
                      </div>

                      {/* SLOTS 2-8: Herramientas Seleccionables */}
                      {TOOLS.map((tool) => {
                        const active = selectedTools.includes(tool.key);
                        return (
                          <button
                            key={tool.id}
                            onClick={() => toggleTool(tool.key)}
                            className={`relative group p-4 rounded-3xl border-2 transition-all flex flex-col items-center text-center min-h-[140px] ${
                              active
                                ? 'border-[#1877F2] bg-[#EEF4FF]/50 ring-4 ring-[#1877F2]/5'
                                : 'bg-white border-slate-100 hover:border-[#1877F2]/40 opacity-70 grayscale hover:grayscale-0'
                            }`}
                          >
                            <div className="text-2xl mb-2 transition-transform duration-300 group-hover:scale-110">
                              {tool.emoji}
                            </div>
                            <p className={`text-[10px] font-black uppercase tracking-tight leading-none ${active ? 'text-[#1877F2]' : 'text-slate-900'}`}>
                              {tool.label}
                            </p>
                            <div className="mt-auto pt-2 flex flex-col items-center">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${active ? 'text-[#1877F2]' : 'text-slate-500'}`}>
                                ${tool.price}/m
                              </span>
                              {active && (
                                <div className="absolute top-2 right-2 w-4 h-4 bg-[#1877F2] rounded-full flex items-center justify-center shadow-lg">
                                  <Check className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="text-center pt-3 border-t border-slate-50">
                      <button
                        onClick={() => { setSelectedTools([]); setCurrentStep(2); window.scrollTo(0, 0); }}
                        className="text-sm text-slate-400 hover:text-[#1877F2] transition-colors font-semibold"
                      >
                        No, gracias — Comenzar solo con el CRM Gratis →
                      </button>
                    </div>
                  </div>
                )}

                {/* STEP 2: Confirmar / Checkout */}
                {currentStep === 2 && (
                  <div className="space-y-6">
                    {!isPackMode && (
                      <div>
                        <h2 className="text-3xl font-black text-slate-900 mb-2">
                          {effectiveTotal === 0 ? '¡Listo para empezar!' : '¡Un paso más!'}
                        </h2>
                        <p className="text-slate-400 text-sm">
                          {effectiveTotal === 0
                            ? 'Tu CRM está listo. Gratis, sin tarjeta, para siempre.'
                            : 'Revisa tu selección y completa el pago.'}
                        </p>
                      </div>
                    )}

                    {isPackMode && packConfig && (
                      <div className="bg-gradient-to-br from-[#1877F2] via-[#1565D8] to-[#0D47A1] rounded-3xl p-7 text-white shadow-2xl shadow-[#1877F2]/40 relative overflow-hidden">
                        {/* fondo decorativo */}
                        <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/5 rounded-full" />
                        <div className="absolute -bottom-10 -left-10 w-52 h-52 bg-white/5 rounded-full" />

                        <div className="relative z-10">
                          <div className="flex items-center gap-3 mb-4 flex-wrap">
                            <span className="bg-yellow-400 text-yellow-900 text-[11px] font-black px-3 py-1 rounded-full uppercase tracking-wider">🔥 Oferta exclusiva</span>
                            <span className="text-white/70 text-[11px] font-bold">Solo en esta página · Solo una vez</span>
                          </div>

                          <div className="flex items-end justify-between gap-4">
                            <div>
                              <p className="text-white/80 text-base font-bold mb-1">{packConfig.label}</p>
                              <p className="text-white/50 text-2xl font-black line-through leading-none">${packConfig.originalPrice}<span className="text-base">/mes</span></p>
                              <div className="flex items-end gap-2 mt-1">
                                <p className="text-6xl font-black leading-none">${packConfig.price}</p>
                                <p className="text-xl font-bold text-white/80 mb-1">/mes</p>
                              </div>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <div className="bg-yellow-400 text-yellow-900 font-black text-3xl px-5 py-3 rounded-2xl shadow-lg">
                                15% OFF
                              </div>
                              <p className="text-white/60 text-xs mt-2">Ahorras ${packConfig.originalPrice - packConfig.price}/mes</p>
                            </div>
                          </div>

                          <p className="text-white/50 text-xs mt-5 pt-4 border-t border-white/10">
                            ⚡ Si sales y vuelves al checkout normal esta oferta ya no estará disponible
                          </p>
                        </div>
                      </div>
                    )}

                    {effectiveTotal === 0 ? (
                      /* ── PATH GRATIS ── */
                      <div className="max-w-md mx-auto text-center space-y-5">
                        <div className="bg-gradient-to-br from-[#EEF4FF] to-[#F0F9FF] rounded-3xl p-10 border-2 border-[#1877F2]/15">
                          <div className="text-5xl mb-4">🚀</div>
                          <h3 className="text-xl font-black text-slate-900 mb-1">CRM Completo Incluido</h3>
                          <div className="text-5xl font-black text-[#1877F2] my-3 tracking-tight">GRATIS</div>
                          <p className="text-xs text-slate-400 mb-6">Para siempre. Sin tarjeta de crédito requerida.</p>
                          <ul className="text-left space-y-2.5 mb-8">
                            {['CRM Kanban ilimitado', 'Usuarios ilimitados', 'Dashboard en tiempo real', 'Historial de conversaciones'].map(f => (
                              <li key={f} className="flex items-center gap-3 text-sm text-slate-600">
                                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                </span>
                                {f}
                              </li>
                            ))}
                          </ul>
                          <div className="flex items-start gap-3 text-left mb-6 bg-white/50 p-3 rounded-xl border border-[#1877F2]/10">
                            <input 
                              type="checkbox" 
                              id="legalConfirmFree"
                              checked={legalAccepted}
                              onChange={(e) => setLegalAccepted(e.target.checked)}
                              className="mt-1 w-4 h-4 rounded border-slate-300 text-[#1877F2] focus:ring-[#1877F2]"
                            />
                            <label htmlFor="legalConfirmFree" className="text-[10px] text-slate-500 leading-tight">
                              He leído y acepto los <a href="https://smartflow-hub-landing.web.app/terminos.html" target="_blank" className="text-[#1877F2] font-bold">Términos de Servicio</a> y la <a href="https://smartflow-hub-landing.web.app/privacidad.html" target="_blank" className="text-[#1877F2] font-bold">Política de Privacidad</a>*.
                            </label>
                          </div>
                          <button
                            onClick={() => handleFinalize()}
                            disabled={isSubmitting || !legalAccepted}
                            className="w-full bg-[#1877F2] text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-[#1877F2]/20 hover:bg-[#1565D8] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            {isSubmitting ? 'CREANDO TU HUB...' : (
                              <><span>CREAR MI HUB GRATIS</span><ArrowRight className="w-4 h-4" /></>
                            )}
                          </button>
                        </div>
                        <button onClick={() => setCurrentStep(1)} className="text-xs text-slate-400 hover:text-[#1877F2] transition-colors font-semibold">
                          ← Volver y agregar herramientas
                        </button>
                      </div>
                    ) : (
                      /* ── PATH PAGO ── */
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Resumen */}
                        <div className="space-y-4">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Tu Selección</h4>
                          <div className="bg-[#F8FAFF] rounded-3xl border border-blue-50 p-5 space-y-2.5">
                            <div className="flex justify-between items-center pb-2.5 border-b border-blue-50">
                              <span className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                📊 CRM Core Hub
                              </span>
                              <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full">GRATIS</span>
                            </div>
                            {selectedTools.map(key => {
                              const tool = TOOLS.find(t => t.key === key);
                              return tool ? (
                                <div key={key} className="flex justify-between items-center">
                                  <span className="text-sm text-slate-600 flex items-center gap-2">
                                    {tool.emoji} {tool.label}
                                  </span>
                                  <span className="text-sm font-bold text-slate-900">${tool.price}/mes</span>
                                </div>
                              ) : null;
                            })}
                            {isCapped && (
                              <div className="bg-gradient-to-r from-[#1877F2]/10 to-[#10B981]/10 border border-[#1877F2]/20 p-3.5 rounded-2xl flex items-center justify-between text-[#1877F2] text-xs font-bold animate-pulse">
                                <span className="flex items-center gap-1.5">🚀 Tope Stack Completo</span>
                                <span className="bg-[#10B981] text-white text-[9px] font-black px-2 py-0.5 rounded-full uppercase">Capped $197/mes</span>
                              </div>
                            )}
                            <div className="pt-2.5 border-t border-blue-100 flex justify-between items-center">
                              <span className="text-sm font-black text-slate-900">Total mensual</span>
                              <div className="text-right">
                                {isPackMode && packConfig && (
                                  <p className="text-xs text-slate-400 line-through">${packConfig.originalPrice}/mes</p>
                                )}
                                <span className="text-xl font-black text-[#1877F2]">
                                  {formData.currency === 'CRC' ? '₡' : '$'}
                                  {(effectiveTotal * (formData.currency === 'CRC' ? 520 : 1)).toLocaleString()} {formData.currency}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Legal Disclaimer for WhatsApp */}
                          {selectedTools.includes('hasMultiAgent') && (
                            <div className="mt-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex gap-3">
                              <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                              <div className="text-[10px] text-amber-800 leading-relaxed font-semibold">
                                <strong>Nota Legal:</strong> La activación de WhatsApp API requiere aprobación de Meta (24-72h). 
                                Tu suscripción se activará técnicamente una vez verificada la línea. Los costos oficiales de mensajería de WhatsApp/Meta pueden aplicar según consumo y tipo de mensaje.
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => setSelectedTools([])}
                            className="text-xs text-slate-400 hover:text-[#1877F2] transition-colors font-semibold"
                          >
                            → Prefiero solo el CRM Gratis (sin herramientas)
                          </button>
                        </div>

                        {/* PayPal */}
                        <div className="space-y-4">
                          {paymentSuccess ? (
                            <div className="bg-emerald-50 p-8 rounded-3xl border-2 border-emerald-200 text-center space-y-4">
                              <div className="w-14 h-14 bg-emerald-500 text-white rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-200">
                                <Check className="w-7 h-7" />
                              </div>
                              <p className="text-base font-black text-emerald-600">¡Pago Confirmado!</p>
                              <p className="text-xs text-slate-400">Creando tu Hub...</p>
                            </div>
                          ) : (
                            <>
                              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Pago con PayPal</h4>
                              <div className="bg-[#F8FAFF] p-6 rounded-3xl border border-blue-50">
                                <div className="mb-4 flex items-start gap-3 text-left bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                                  <input 
                                    type="checkbox" 
                                    id="legalConfirmPaid"
                                    checked={legalAccepted}
                                    onChange={(e) => setLegalAccepted(e.target.checked)}
                                    className="mt-1 w-4 h-4 rounded border-slate-300 text-[#1877F2] focus:ring-[#1877F2]"
                                  />
                                  <label htmlFor="legalConfirmPaid" className="text-[10px] text-slate-500 leading-tight font-medium">
                                    Confirmo que soy mayor de edad y acepto los <a href="https://smartflow-hub-landing.web.app/terminos.html" target="_blank" className="text-[#1877F2] font-bold">Términos de Servicio</a>, incluyendo la política de activación de WhatsApp (24-72h)*.
                                  </label>
                                </div>

                                <div className={!legalAccepted ? 'opacity-40 pointer-events-none grayscale' : ''}>
                                  <PayPalButtons
                                    style={{ layout: "vertical", shape: "pill", color: "blue" }}
                                    disabled={!legalAccepted}
                                    createOrder={(_data, actions) => actions.order.create({
                                      intent: "CAPTURE",
                                      purchase_units: [{
                                        amount: { currency_code: 'USD', value: effectiveTotal.toString() },
                                        description: 'SmartFlow Hub OS'
                                      }]
                                    })}
                                    onApprove={async (data, _actions) => {
                                      try {
                                        setIsSubmitting(true);
                                        const fns = getFunctions();
                                        const verify = httpsCallable(fns, 'verifyPaypalOrder');
                                        const result = await verify({ orderId: data.orderID });
                                        if ((result.data as any).success) {
                                          setPaymentSuccess(true);
                                          setTimeout(() => handleFinalize(), 1500);
                                        } else {
                                          setError('El pago no pudo verificarse. Contacta soporte.');
                                        }
                                      } catch (err: any) {
                                        setError(err.message || 'Error al verificar el pago con PayPal.');
                                      } finally {
                                        setIsSubmitting(false);
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>

              {/* Footer */}
              <div className="px-8 md:px-12 py-5 bg-white border-t border-blue-50 flex items-center justify-between flex-shrink-0">
                <button
                  onClick={() => currentStep > 0 && setCurrentStep(prev => prev - 1)}
                  disabled={currentStep === 0 || isSubmitting}
                  className={`flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-colors ${
                    currentStep === 0 || isSubmitting ? 'opacity-0 pointer-events-none' : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" /> Volver
                </button>

                {currentStep < 2 && (
                  <button
                    onClick={handleNext}
                    disabled={
                      isSubmitting || isCheckingTradeName ||
                      (currentStep === 0 && (!formData.businessName || !formData.adminEmail || !formData.password))
                    }
                    className={`h-11 px-8 rounded-full font-black text-xs uppercase tracking-widest transition-all flex items-center gap-2 ${
                      isSubmitting || isCheckingTradeName ||
                      (currentStep === 0 && (!formData.businessName || !formData.adminEmail || !formData.password))
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-[#1877F2] text-white hover:bg-[#1565D8] shadow-lg shadow-[#1877F2]/20 hover:scale-105 active:scale-95'
                    }`}
                  >
                    {isCheckingTradeName ? 'VALIDANDO...' : isSubmitting ? 'PROCESANDO...' : 'CONTINUAR'}
                    {!isCheckingTradeName && !isSubmitting && <ArrowRight className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </PayPalScriptProvider>
  );
};
