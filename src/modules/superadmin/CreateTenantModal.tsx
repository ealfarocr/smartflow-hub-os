import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, CheckCircle2, Loader2, Building2, Mail, Briefcase } from 'lucide-react';
import { TenantFeatures, TenantPlan } from '@/types';
import { SuperAdminService, CreateTenantInput } from '@/services/firebase/SuperAdminService';
import { useAuthStore } from '@/stores/authStore';

interface CreateTenantModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const INDUSTRIES = ['Solar', 'Inmobiliaria', 'Salud / Clínica', 'Retail / Comercio', 'Servicios', 'Educación', 'Otro'];
const PLANS: { value: TenantPlan; label: string; desc: string; price: string }[] = [
  { value: 'starter',    label: 'Starter',       desc: 'Hasta 6 usuarios',    price: 'SaaS Base' },
  { value: 'pro',        label: 'Pro',           desc: 'Hasta 12 usuarios',   price: 'SaaS Pro' },
  { value: 'enterprise', label: 'Buffet',        desc: 'Ilimitado + Todo',    price: 'SaaS Master' },
];

export const CreateTenantModal = ({ onClose, onCreated }: CreateTenantModalProps) => {
  const { user, setActiveTenant } = useAuthStore();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [industry, setIndustry] = useState('Solar');
  const [plan, setPlan] = useState<TenantPlan>('starter');

  const handleCreate = async () => {
    if (!user?.id) return;
    setIsSaving(true);
    try {
      const features: TenantFeatures = {
        hasCrm: true,
        hasQuotes: false,
        hasPackages: false,
        hasAgenda: false,
        hasIntegrations: false,
        hasAiAgent: false,
        hasMultiAgent: false,
        hasQualityAuditor: false,
        hasPaymentLinks: false,
        hasTasks: true,
      };

      const input: CreateTenantInput = {
        name,
        ownerEmail,
        plan,
        industry,
        features,
        createdBy: user.id,
      };
      const newTenantId = await SuperAdminService.createTenant(input);

      setSuccess(true);
      setTimeout(async () => {
        await setActiveTenant(newTenantId);
        navigate('/dashboard');
        onCreated();
      }, 1500);
    } catch (err) {
      console.error(err);
      alert('Error al crear el negocio. Revisa la consola.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-xl rounded-[2.5rem] bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header con el Azul Facebook */}
        <div className="bg-[#1877F2] px-8 py-8 text-white relative">
          <button 
            onClick={onClose} 
            className="absolute right-6 top-6 p-2 hover:bg-white/10 rounded-xl transition-colors text-white/70 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-2xl">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight leading-none">Configurar Negocio</h2>
              <p className="text-white/70 text-[10px] font-black uppercase tracking-[0.2em] mt-2">Provisionamiento de nuevo Tenant</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 py-8 overflow-y-auto max-h-[70vh] custom-scrollbar">
          {success ? (
            <div className="flex flex-col items-center justify-center py-12 text-center animate-in zoom-in duration-500">
              <div className="w-24 h-24 rounded-[2rem] bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 flex items-center justify-center mb-6 shadow-inner">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">¡Negocio listo!</h3>
              <p className="text-slate-500 font-medium mt-2 max-w-xs mx-auto">
                Accediendo automáticamente al entorno de <span className="text-[#1877F2] font-black">{name}</span>...
              </p>
            </div>
          ) : (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-300">
              {/* Información Básica */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-[#1877F2] uppercase tracking-[0.2em] ml-1">Información del Negocio</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nombre Comercial</label>
                    <div className="relative">
                      <Briefcase className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        required
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full pl-11 pr-4 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl text-sm font-black text-slate-900 dark:text-white transition-all outline-none"
                        placeholder="Ej: Solar Pro MX"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Email Principal</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        required
                        type="email"
                        value={ownerEmail}
                        onChange={e => setOwnerEmail(e.target.value)}
                        className="w-full pl-11 pr-4 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl text-sm font-black text-slate-900 dark:text-white transition-all outline-none"
                        placeholder="owner@empresa.com"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Industria */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-[#1877F2] uppercase tracking-[0.2em] ml-1">Industria y Mercado</h4>
                <div className="flex flex-wrap gap-2">
                  {INDUSTRIES.map(ind => (
                    <button 
                      key={ind} 
                      onClick={() => setIndustry(ind)} 
                      className={`px-5 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all border-2 ${
                        industry === ind 
                          ? 'bg-[#1877F2] text-white border-[#1877F2] shadow-lg shadow-[#1877F2]/20 scale-105' 
                          : 'bg-white text-slate-400 border-slate-100 hover:border-[#1877F2]/30 hover:text-slate-600'
                      }`}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plan de Servicio */}
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-[#1877F2] uppercase tracking-[0.2em] ml-1">Suscripción SaaS</h4>
                <div className="grid grid-cols-3 gap-3">
                  {PLANS.map(p => (
                    <button 
                      key={p.value} 
                      onClick={() => setPlan(p.value)} 
                      className={`p-4 rounded-3xl border-2 text-left transition-all relative overflow-hidden group ${
                        plan === p.value 
                          ? 'border-[#1877F2] bg-blue-50/30 ring-4 ring-[#1877F2]/5' 
                          : 'border-slate-100 bg-slate-50/50 grayscale hover:grayscale-0'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg w-fit mb-3 ${plan === p.value ? 'bg-[#1877F2] text-white' : 'bg-slate-200 text-slate-400'}`}>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </div>
                      <p className={`text-xs font-black uppercase tracking-widest ${plan === p.value ? 'text-[#1877F2]' : 'text-slate-900'}`}>{p.label}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{p.price}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Info box */}
              <div className="p-5 rounded-3xl bg-blue-50 dark:bg-blue-900/10 border-2 border-blue-100 dark:border-blue-900/30 flex gap-4">
                <div className="p-2 bg-white dark:bg-slate-800 rounded-xl h-fit shadow-sm">
                  <Building2 className="w-4 h-4 text-[#1877F2]" />
                </div>
                <p className="text-[11px] font-bold text-slate-500 dark:text-blue-300 leading-relaxed">
                  Se creará un entorno dedicado con <span className="text-[#1877F2] font-black">CRM y Herramientas Nativas</span> activas por defecto.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="px-8 py-6 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-4">
            <button
              onClick={onClose}
              className="text-slate-400 font-black text-[10px] uppercase tracking-[0.2em] px-6 py-4 rounded-2xl hover:bg-slate-100 transition-all active:scale-95"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={isSaving || !name.trim() || !ownerEmail.trim()}
              className="flex-1 max-w-[200px] flex items-center justify-center gap-3 bg-[#1877F2] hover:bg-[#166fe5] text-white disabled:opacity-30 disabled:cursor-not-allowed py-4 rounded-[1.5rem] text-[11px] font-black uppercase tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-[#1877F2]/20"
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Building2 className="w-5 h-5" />}
              {isSaving ? 'Creando...' : 'Crear Negocio'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
