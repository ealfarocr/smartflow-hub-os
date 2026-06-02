import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Building2, Briefcase, ArrowRight, 
  Rocket, Sparkles, Loader2, MessageCircle,
  Stethoscope, Home, ShoppingBag, Coffee, Laptop
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { OnboardingService } from '@/services/OnboardingService';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';

const INDUSTRIES = [
  { id: 'inmobiliaria', label: 'Bienes Raíces', icon: Home, color: 'bg-blue-500' },
  { id: 'servicios', label: 'Servicios Profesionales', icon: Briefcase, color: 'bg-indigo-500' },
  { id: 'salud', label: 'Salud / Clínicas', icon: Stethoscope, color: 'bg-emerald-500' },
  { id: 'ecommerce', label: 'Ecommerce / Ventas', icon: ShoppingBag, color: 'bg-pink-500' },
  { id: 'gastronomia', label: 'Restaurantes', icon: Coffee, color: 'bg-orange-500' },
  { id: 'tecnologia', label: 'Tecnología / SaaS', icon: Laptop, color: 'bg-slate-800' },
];

export const MagicOnboardingView = () => {
  const { user, memberships, refreshAuth } = useAuthStore();
  const { addToast } = useUIStore();
  const navigate = useNavigate();
  
  const [step, setStep] = useState(1);
  const [businessName, setBusinessName] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [magicStatus, setMagicStatus] = useState('Iniciando motores...');

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 1 && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  // Si el usuario ya tiene membresías, no debería estar aquí
  useEffect(() => {
    if (memberships.length > 0) {
      navigate('/dashboard', { replace: true });
    }
  }, [memberships, navigate]);

  const handleNext = () => {
    if (step === 1 && businessName.trim()) setStep(2);
    if (step === 2 && selectedIndustry) startMagic();
  };

  const startMagic = async (industryId?: string) => {
    const resolvedIndustry = industryId || selectedIndustry || 'General';
    setStep(3);
    setIsProcessing(true);

    // Simulación visual de tareas "mágicas"
    const tasks = [
      'Detectando moneda local...',
      'Configurando tu Pipeline inteligente...',
      'Activando Agente IA base...',
      'Inyectando leads de prueba...',
      'Preparando tu espacio de trabajo...'
    ];

    for (let i = 0; i < tasks.length; i++) {
      setMagicStatus(tasks[i]);
      setProgress(((i + 1) / tasks.length) * 100);
      await new Promise(r => setTimeout(r, 800));
    }

    try {
      // Registro real en backend
      await OnboardingService.registerNewBusiness({
        businessName,
        tradeName: businessName.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, ''),
        email: user?.email || '',
        phone: '',
        industry: resolvedIndustry,
        selectedFeatures: ['hasCrm', 'hasTasks', 'hasPackages'] // Defaults free
      });
      
      await refreshAuth(); // Recargar membresías
      setStep(4);
    } catch (error) {
      console.error(error);
      addToast('Hubo un detalle al crear tu Hub. Reintenta.', 'error');
      setStep(1);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6">
      
      {/* Background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-[#1877F2]/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <motion.div 
        layout
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden relative z-10"
      >
        <AnimatePresence mode="wait">
          
          {/* STEP 1: BUSINESS NAME */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="p-12 md:p-16 space-y-10"
            >
              <div className="space-y-4">
                <div className="w-16 h-16 bg-[#1877F2] rounded-[1.5rem] flex items-center justify-center text-white shadow-xl shadow-primary-500/20">
                  <Building2 className="w-8 h-8" />
                </div>
                <h1 className="text-4xl font-black text-slate-900 dark:text-white leading-tight">
                  ¡Hola! ¿Cómo se llama tu <span className="text-[#1877F2]">sueño</span> hoy?
                </h1>
                <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                  Comencemos con el nombre de tu negocio o proyecto.
                </p>
              </div>

              <div className="relative group">
                <input
                  ref={inputRef}
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleNext()}
                  placeholder="Ej: Inmobiliaria Sol, Café Central..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border-4 border-transparent focus:border-primary-500/20 focus:bg-white dark:focus:bg-slate-900 rounded-3xl px-8 py-6 text-2xl font-black text-slate-900 dark:text-white outline-none transition-all placeholder:text-slate-300 dark:placeholder:text-slate-700"
                />
                <AnimatePresence>
                  {businessName.trim().length > 2 && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.8, x: 20 }}
                      animate={{ opacity: 1, scale: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.8, x: 20 }}
                      onClick={handleNext}
                      className="absolute right-4 top-1/2 -translate-y-1/2 bg-[#1877F2] hover:bg-[#1877F2] text-white p-4 rounded-2xl shadow-xl shadow-primary-500/30 transition-all active:scale-95"
                    >
                      <ArrowRight className="w-6 h-6" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* STEP 2: INDUSTRY SELECTION */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="p-12 md:p-16 space-y-10"
            >
              <div className="space-y-4">
                <button 
                  onClick={() => setStep(1)}
                  className="text-xs font-black text-slate-400 hover:text-[#1877F2] uppercase tracking-widest flex items-center gap-2 mb-4"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" /> Volver
                </button>
                <h1 className="text-4xl font-black text-slate-900 dark:text-white leading-tight">
                  ¿A qué se dedica <span className="text-[#1877F2]">{businessName}</span>?
                </h1>
                <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                  Esto nos ayuda a configurar tus etapas de venta automáticamente.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind.id}
                    onClick={() => {
                      setSelectedIndustry(ind.id);
                      setTimeout(() => startMagic(ind.id), 300);
                    }}
                    className={`p-6 rounded-[2rem] border-4 transition-all text-left flex flex-col gap-4 group ${
                      selectedIndustry === ind.id 
                        ? 'border-primary-500 bg-[#1877F2]/5 shadow-2xl shadow-primary-500/10' 
                        : 'border-slate-50 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-primary-500/20'
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white ${ind.color} shadow-lg transition-transform group-hover:scale-110`}>
                      <ind.icon className="w-6 h-6" />
                    </div>
                    <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight leading-tight">
                      {ind.label}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* STEP 3: THE ENGINE (MAGIC) */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-20 flex flex-col items-center justify-center space-y-12 text-center"
            >
              <div className="relative">
                <div className="w-32 h-32 rounded-[2.5rem] bg-[#1877F2]/10 flex items-center justify-center">
                  <Loader2 className="w-16 h-16 text-[#1877F2] animate-spin" />
                </div>
                <motion.div 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute -top-4 -right-4 w-12 h-12 bg-white dark:bg-slate-900 rounded-full shadow-xl flex items-center justify-center border border-slate-100 dark:border-slate-800"
                >
                  <Sparkles className="w-6 h-6 text-amber-500" />
                </motion.div>
              </div>

              <div className="space-y-4">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-widest">
                  Haciendo el trabajo sucio...
                </h2>
                <p className="text-[#1877F2] font-bold animate-pulse uppercase tracking-tighter text-sm">
                  {magicStatus}
                </p>
              </div>

              <div className="w-full max-w-xs h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  className="h-full bg-[#1877F2] shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                />
              </div>
            </motion.div>
          )}

          {/* STEP 4: READY / THE WOW */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-16 text-center space-y-10"
            >
              <div className="flex flex-col items-center space-y-6">
                <div className="w-24 h-24 bg-emerald-500 rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-emerald-500/30 animate-bounce">
                  <Rocket className="w-12 h-12" />
                </div>
                <div className="space-y-2">
                  <h1 className="text-4xl font-black text-slate-900 dark:text-white">
                    ¡Tu Hub está <span className="text-emerald-500">Vivo</span>!
                  </h1>
                  <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
                    Hemos configurado todo para {businessName}.
                  </p>
                </div>
              </div>

              <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800 p-6 rounded-3xl flex items-center gap-4 text-left">
                <div className="p-3 bg-white dark:bg-slate-900 rounded-2xl shadow-sm">
                  <MessageCircle className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Primera Victoria</p>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Tu Agente IA ya está listo para hablar con tus clientes de {selectedIndustry}.
                  </p>
                </div>
              </div>

              <button
                onClick={() => navigate('/dashboard')}
                className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-6 rounded-[2rem] font-black text-lg uppercase tracking-widest shadow-2xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
              >
                ENTRAR A MI HUB <ArrowRight className="w-6 h-6" />
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
      
      <p className="mt-8 text-xs font-black text-slate-400 uppercase tracking-[0.3em] opacity-50">
        SmartFlow Hub OS • Onboarding Magic v1.0
      </p>
    </div>
  );
};
