import { Zap, ShoppingCart, Info } from 'lucide-react';
import { WhatsappQuota } from '@/types';

interface WhatsappUsageStatsProps {
  quota: WhatsappQuota;
  onUpgrade?: () => void;
}

export const WhatsappUsageStats = ({ quota, onUpgrade }: WhatsappUsageStatsProps) => {
  const dailyUsed = quota.dailyTemplatesUsed;
  const dailyTotal = quota.dailyTemplatesTotal;
  const monthlyUsed = quota.monthlyTemplatesUsed;
  const monthlyTotal = quota.monthlyTemplatesTotal;

  const dailyRemaining = Math.max(0, dailyTotal - dailyUsed);
  const monthlyRemaining = Math.max(0, monthlyTotal - monthlyUsed);

  const dailyPercent = (dailyUsed / dailyTotal) * 100;
  const monthlyPercent = (monthlyUsed / monthlyTotal) * 100;
  const slotsPercent = (quota.currentTemplateSlots / quota.maxTemplateSlots) * 100;

  return (
    <div className="bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 p-4 space-y-4 animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500 fill-current" />
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Estado de Cuotas WhatsApp</h4>
        </div>
        <button 
          onClick={onUpgrade}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all hover:scale-105 active:scale-95 shadow-md shadow-[#1877F2]/20"
        >
          <ShoppingCart className="w-3 h-3" />
          Ampliar Cupo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Reactivaciones Diarias */}
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Reactivaciones Diarias</span>
            <span className="text-xs font-black text-[#1877F2]">QUEDAN {dailyRemaining} DE {dailyTotal}</span>
          </div>
          <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-1000 shadow-sm ${dailyPercent > 80 ? 'bg-rose-500' : 'bg-[#1877F2]'}`} 
              style={{ width: `${Math.min(dailyPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Reactivaciones Mensuales */}
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Reactivaciones Mensuales</span>
            <span className="text-xs font-black text-emerald-500">QUEDAN {monthlyRemaining} DE {monthlyTotal}</span>
          </div>
          <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
            <div 
              className={`h-full transition-all duration-1000 shadow-sm ${monthlyPercent > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
              style={{ width: `${Math.min(monthlyPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Espacios de Plantillas */}
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Espacios Disponibles</span>
            <span className="text-xs font-black text-purple-500">{quota.maxTemplateSlots - quota.currentTemplateSlots} LIBRES</span>
          </div>
          <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full bg-purple-500 transition-all duration-1000 shadow-sm" 
              style={{ width: `${Math.min(slotsPercent, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Info className="w-3 h-3 text-slate-400" />
        <p className="text-[9px] text-slate-400 italic font-medium">
          Las reactivaciones se reinician diariamente a las 00:00 UTC. Tienes {dailyRemaining} reactivaciones disponibles para hoy.
        </p>
      </div>
    </div>
  );
};
