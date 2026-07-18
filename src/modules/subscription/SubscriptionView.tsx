import { useNavigate } from 'react-router-dom';
import { Check, ShoppingBag, Zap, ExternalLink } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';

const TOOLS = [
  { key: 'hasMultiAgent',     emoji: '💬', label: 'WhatsApp Coexistente', price: 69 },
  { key: 'hasAiAgent',        emoji: '🤖', label: 'Agente IA',            price: 49 },
  { key: 'hasQualityAuditor', emoji: '🛡️', label: 'Auditor IA',           price: 25 },
  { key: 'hasPaymentLinks',   emoji: '💳', label: 'Links de Pago',        price: 12 },
  { key: 'hasQuotes',         emoji: '📄', label: 'Cotizaciones',         price: 15 },
  { key: 'hasCatalog',        emoji: '📁', label: 'Catálogo',             price: 27 },
  { key: 'hasAgenda',         emoji: '🗓️', label: 'Agenda Inteligente',   price: 20 },
];

const FREE_TOOLS = [
  { emoji: '📊', label: 'CRM Core Hub' },
  { emoji: '✅', label: 'Gestor de Tareas' },
  { emoji: '📦', label: 'Paquetes Comerciales' },
];

export const SubscriptionView = () => {
  const navigate = useNavigate();
  const { features } = useSettingsStore();
  const { activeMembership } = useAuthStore();

  const activeTools = TOOLS.filter(t => (features as any)[t.key]);
  const rawTotal = activeTools.reduce((sum, t) => sum + t.price, 0);
  const total = rawTotal > 197 ? 197 : rawTotal;
  const isCapped = rawTotal > 197;
  const inactiveTools = TOOLS.filter(t => !(features as any)[t.key]);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Mi Suscripción</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Herramientas activas en <span className="font-semibold text-[#1877F2]">{activeMembership?.tenantName || activeMembership?.tenantId}</span>
        </p>
      </div>

      {/* Herramientas incluidas gratis */}
      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-2xl p-5">
        <p className="text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-3">Incluido siempre · Gratis</p>
        <div className="space-y-2">
          {FREE_TOOLS.map(t => (
            <div key={t.label} className="flex items-center gap-3">
              <span className="w-7 h-7 bg-emerald-100 dark:bg-emerald-800 rounded-lg flex items-center justify-center text-sm">{t.emoji}</span>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t.label}</span>
              <span className="ml-auto text-xs font-black text-emerald-500">GRATIS</span>
            </div>
          ))}
        </div>
      </div>

      {/* Herramientas de pago activas */}
      <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Herramientas Premium Activas</p>
        {activeTools.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm mb-4">No tienes herramientas premium activas.</p>
            <button
              onClick={() => navigate('/tienda')}
              className="inline-flex items-center gap-2 bg-[#1877F2] text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-blue-600 transition-colors"
            >
              <ShoppingBag className="w-4 h-4" /> Explorar herramientas
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTools.map(t => (
              <div key={t.key} className="flex items-center gap-3 py-2 border-b border-slate-50 dark:border-slate-800 last:border-0">
                <div className="w-7 h-7 bg-[#EEF4FF] dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-sm">{t.emoji}</div>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex-1">{t.label}</span>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">${t.price}/mes</span>
                </div>
              </div>
            ))}

            {/* Total */}
            <div className="pt-3 mt-1 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <span className="text-sm font-black text-slate-900 dark:text-white">Total mensual</span>
              <div className="text-right">
                {isCapped && (
                  <p className="text-xs text-slate-400 line-through">${rawTotal}/mes</p>
                )}
                <span className="text-xl font-black text-[#1877F2]">${total}/mes</span>
                {isCapped && (
                  <p className="text-xs text-emerald-500 font-bold">Stack Completo — precio tope</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Herramientas disponibles para agregar */}
      {inactiveTools.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Disponibles para agregar</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {inactiveTools.map(t => (
              <div key={t.key} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl opacity-60">
                <span className="text-lg">{t.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate">{t.label}</p>
                  <p className="text-xs text-slate-400">${t.price}/mes</p>
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/tienda')}
            className="w-full flex items-center justify-center gap-2 bg-[#1877F2] text-white py-3 rounded-xl font-black text-sm hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/20"
          >
            <ShoppingBag className="w-4 h-4" />
            Agregar herramientas en la Tienda
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Info de plan */}
      <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl">
        <div className="w-9 h-9 bg-[#1877F2] rounded-xl flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-white fill-current" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-black text-slate-900 dark:text-white">Plan SmartFlow Hub OS</p>
          <p className="text-xs text-slate-400">Facturación mensual · Cancela cuando quieras</p>
        </div>
        <span className="text-[10px] font-black text-emerald-500 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-1 rounded-full uppercase tracking-widest">Activo</span>
      </div>
    </div>
  );
};
