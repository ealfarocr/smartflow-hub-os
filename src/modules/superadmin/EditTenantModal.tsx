import { useState, useEffect } from 'react';
import {
  X, CheckCircle2, Loader2, Settings2, Save
} from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { TenantRecord, TenantFeatures, TenantPlan, ToolLibraryRecord } from '@/types';
import { SuperAdminService } from '@/services/firebase/SuperAdminService';

interface EditTenantModalProps {
  tenant: TenantRecord;
  onClose: () => void;
  onUpdated: () => void;
}

const PLANS: { value: TenantPlan; label: string; price: string }[] = [
  { value: 'starter',    label: 'Starter',    price: 'Básico' },
  { value: 'pro',        label: 'Pro',        price: 'Profesional' },
  { value: 'enterprise', label: 'Enterprise', price: 'Personalizado' },
];
export const EditTenantModal = ({ tenant, onClose, onUpdated }: EditTenantModalProps) => {
  const [activeTab, setActiveTab] = useState<'general' | 'tools' | 'branding'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [availableTools, setAvailableTools] = useState<ToolLibraryRecord[]>([]);

  // Form state
  const [plan, setPlan] = useState<TenantPlan>(tenant.plan);
  const [features, setFeatures] = useState<TenantFeatures>(tenant.features);
  const [branding, setBranding] = useState(tenant.branding || { primaryColor: '#2563eb', logoUrl: '' });

  useEffect(() => {
    SuperAdminService.listAvailableTools().then(setAvailableTools);
  }, []);

  const toggleFeature = (key: string) => {
    setFeatures(prev => ({ ...prev, [key]: !prev[key as keyof TenantFeatures] }));
  };

  const handleUpdate = async () => {
    setIsSaving(true);
    try {
      // 1. Actualizamos features y plan en el doc del tenant
      await SuperAdminService.updateTenantFeatures(tenant.id, features);
      
      // 2. Actualizamos branding en settings (aquí simplificado, idealmente usar SettingsService)
      const { db } = await import('@/lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'settings', tenant.id), { 
        branding,
        features,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setSuccess(true);
      setTimeout(() => onUpdated(), 1500);
    } catch (err) {
      console.error(err);
      alert('Error al actualizar el negocio.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-2xl rounded-3xl border border-border flex flex-col max-h-[90vh] bg-white dark:bg-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-slate-50 dark:bg-slate-800">
          <div>
            <h2 className="text-foreground font-black text-xl tracking-tight">Gestionar {tenant.name}</h2>
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-1">
              ID: {tenant.id}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-all p-2 hover:bg-muted dark:hover:bg-white/5 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-slate-50 dark:bg-slate-750 px-4">
          <button onClick={() => setActiveTab('general')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'general' ? 'border-purple-600 text-purple-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            Plan y Datos
          </button>
          <button onClick={() => setActiveTab('tools')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'tools' ? 'border-purple-600 text-purple-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            Herramientas
          </button>
          <button onClick={() => setActiveTab('branding')} className={`px-6 py-4 text-sm font-bold border-b-2 transition-all ${activeTab === 'branding' ? 'border-purple-600 text-purple-600' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            Marca Blanca
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
          {success ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              </div>
              <h3 className="text-foreground font-black text-2xl mb-2">¡Configuración Aplicada!</h3>
              <p className="text-muted-foreground text-sm">El negocio se ha actualizado según tu visión.</p>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">Plan de Suscripción</label>
                    <div className="grid grid-cols-3 gap-3">
                      {PLANS.map(p => (
                        <button
                          key={p.value}
                          onClick={() => setPlan(p.value)}
                          className={`p-4 rounded-2xl border text-left transition-all ${
                            plan === p.value
                              ? 'border-purple-600 bg-purple-500/5 dark:bg-purple-600/10 ring-2 ring-purple-500/10 shadow-md'
                              : 'border-border bg-muted/20 dark:bg-white/5 opacity-50 hover:opacity-100'
                          }`}
                        >
                          <p className={`text-sm font-bold ${plan === p.value ? 'text-purple-600 dark:text-purple-400' : 'text-foreground'}`}>{p.label}</p>
                          <p className="text-muted-foreground text-[9px] font-black uppercase tracking-widest mt-0.5">{p.price}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'tools' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest">Selección de Herramientas</label>
                    <span className="text-[10px] font-bold text-purple-600 bg-purple-500/10 px-2 py-0.5 rounded-full">
                      {Object.values(features).filter(Boolean).length} Activas
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {availableTools.map(tool => {
                      const isOn = features[tool.key as keyof TenantFeatures];
                      const Icon = (LucideIcons as any)[tool.iconName] || Settings2;
                      return (
                        <button
                          key={tool.id}
                          onClick={() => toggleFeature(tool.key)}
                          className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                            isOn
                              ? 'border-purple-500/20 bg-purple-500/5'
                              : 'border-border bg-transparent opacity-60 hover:opacity-100'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isOn ? 'bg-white dark:bg-slate-900 shadow-sm' : 'bg-muted/50'}`}>
                            <Icon className={`w-5 h-5 ${isOn ? '' : 'text-muted-foreground'}`} style={{ color: isOn ? tool.color : undefined }} />
                          </div>
                          <div className="flex-1 text-left">
                            <p className={`font-bold text-sm ${isOn ? 'text-foreground' : 'text-muted-foreground'}`}>{tool.label}</p>
                          </div>
                          <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${isOn ? 'bg-purple-600 border-purple-600' : 'border-muted-foreground/20'}`}>
                            {isOn && <LucideIcons.Check className="w-4 h-4 text-white" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeTab === 'branding' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">Color de Marca (Primario)</label>
                    <div className="flex gap-4 items-center">
                      <input
                        type="color"
                        value={branding.primaryColor}
                        onChange={e => setBranding({ ...branding, primaryColor: e.target.value })}
                        className="w-16 h-16 rounded-2xl border-2 border-border p-1 bg-white cursor-pointer shadow-sm"
                      />
                      <input
                        type="text"
                        value={branding.primaryColor}
                        onChange={e => setBranding({ ...branding, primaryColor: e.target.value })}
                        className="flex-1 bg-muted/20 dark:bg-white/5 border border-border rounded-xl px-4 py-3 text-sm font-mono focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                        placeholder="#2563eb"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-3">URL del Logo</label>
                    <input
                      type="text"
                      value={branding.logoUrl}
                      onChange={e => setBranding({ ...branding, logoUrl: e.target.value })}
                      className="w-full bg-muted/20 dark:bg-white/5 border border-border rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                      placeholder="https://ejemplo.com/logo.png"
                    />
                    {branding.logoUrl && (
                      <div className="mt-4 p-4 rounded-2xl border border-border bg-muted/20 dark:bg-white/5 flex items-center justify-center">
                        <img src={branding.logoUrl} alt="Preview" className="h-12 w-auto object-contain" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-between px-8 py-6 border-t border-border bg-slate-50 dark:bg-slate-800">
            <button onClick={onClose} className="text-muted-foreground font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-muted transition-all">
              Cancelar
            </button>
            <button
              onClick={handleUpdate}
              disabled={isSaving}
              className="flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-8 py-3 rounded-2xl text-sm font-black transition-all hover:scale-[1.02] active:scale-[0.98] shadow-xl"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSaving ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
