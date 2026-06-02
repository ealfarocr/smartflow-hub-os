import { Handshake, ShieldCheck, Globe, Trophy, ArrowRight, CheckCircle, Star, Zap, Users } from 'lucide-react';
import { motion } from 'framer-motion';

const affiliateBenefits = [
  'Comisión recurrente por cada negocio referido',
  'Panel de seguimiento de referidos en tiempo real',
  'Materiales de venta y capacitación incluidos',
  'Soporte prioritario para partners activos',
];

const sealBenefits = [
  'Badge oficial verificado en tu perfil y web',
  'Listado en el directorio de Partners SmartFlow',
  'Acceso anticipado a nuevas funcionalidades',
  'Credencial digital compartible en LinkedIn',
];

export const PartnersView = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="flex flex-col md:flex-row items-center">
          <div className="flex-1 p-8 md:p-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1877F2]/10 text-[#1877F2] rounded-full text-[10px] font-black uppercase tracking-widest mb-5">
              <Trophy className="w-3 h-3" /> Sello de Calidad
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight mb-3">
              Ecosistema de <span className="text-[#1877F2]">Partners</span>
            </h1>
            <p className="text-slate-500 text-sm leading-relaxed max-w-md">
              Una red exclusiva de expertos y agencias que utilizan SmartFlow para escalar negocios. El sello que garantiza excelencia operativa.
            </p>
          </div>
          <div className="w-full md:w-56 bg-gradient-to-br from-[#1877F2]/8 to-[#1877F2]/3 md:self-stretch flex items-center justify-center p-10 border-t md:border-t-0 md:border-l border-slate-100">
            <Globe className="w-20 h-20 text-[#1877F2]/25" strokeWidth={1} />
          </div>
        </div>

        {/* Stats bar */}
        <div className="border-t border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
          {[
            { value: 'Red', label: 'exclusiva de partners', icon: Users },
            { value: '100%', label: 'Verificado por SmartFlow', icon: ShieldCheck },
            { value: 'Global', label: 'Alcance internacional', icon: Globe },
          ].map(({ value, label, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 px-6 py-4">
              <div className="p-2 bg-slate-50 rounded-xl">
                <Icon className="w-4 h-4 text-slate-400" />
              </div>
              <div>
                <p className="text-base font-black text-slate-900">{value}</p>
                <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Section label */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-base font-black text-slate-900">Programas disponibles</h2>
          <p className="text-xs text-slate-400 mt-0.5">Únete a la red de partners más activa de Latinoamérica</p>
        </div>
        <span className="px-3 py-1 bg-amber-50 text-amber-600 text-[10px] font-black rounded-full uppercase tracking-widest">
          Próximamente
        </span>
      </div>

      {/* Program cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Afiliados */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-all"
        >
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 bg-[#1877F2]/10 rounded-xl flex items-center justify-center">
                <Handshake className="w-5 h-5 text-[#1877F2]" />
              </div>
              <span className="px-2.5 py-1 bg-[#1877F2]/10 text-[#1877F2] text-[9px] font-black rounded-full uppercase tracking-widest">
                Afiliados
              </span>
            </div>
            <h3 className="text-base font-black text-slate-900 mb-1.5">Programa de Afiliados</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Recomienda SmartFlow y obtén beneficios recurrentes mientras ayudas a otras empresas a digitalizarse.
            </p>
          </div>
          <div className="p-6 space-y-2.5">
            {affiliateBenefits.map(b => (
              <div key={b} className="flex items-start gap-2.5">
                <CheckCircle className="w-3.5 h-3.5 text-[#1877F2] shrink-0 mt-0.5" />
                <span className="text-xs text-slate-600">{b}</span>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Disponible pronto</span>
            </div>
            <button className="flex items-center gap-1 text-[10px] font-black text-slate-300 hover:text-[#1877F2] transition-colors">
              Notificarme <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </motion.div>

        {/* Sello */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.16 }}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-all"
        >
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[9px] font-black rounded-full uppercase tracking-widest">
                Certificación
              </span>
            </div>
            <h3 className="text-base font-black text-slate-900 mb-1.5">Sello SmartFlow</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Obtén la certificación oficial que avala que tu negocio utiliza tecnología de vanguardia para la atención al cliente.
            </p>
          </div>
          <div className="p-6 space-y-2.5">
            {sealBenefits.map(b => (
              <div key={b} className="flex items-start gap-2.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span className="text-xs text-slate-600">{b}</span>
              </div>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Disponible pronto</span>
            </div>
            <button className="flex items-center gap-1 text-[10px] font-black text-slate-300 hover:text-emerald-600 transition-colors">
              Notificarme <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </motion.div>
      </div>

      {/* Bottom CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.24 }}
        className="bg-slate-900 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#1877F2]/20 rounded-xl flex items-center justify-center shrink-0">
            <Star className="w-6 h-6 text-[#1877F2]" />
          </div>
          <div>
            <h3 className="text-base font-black text-white">¿Quieres ser Partner SmartFlow?</h3>
            <p className="text-xs text-slate-400 mt-0.5">Escríbenos y te contactamos en cuanto el programa esté disponible</p>
          </div>
        </div>
        <button className="shrink-0 inline-flex items-center gap-2 px-6 py-2.5 bg-[#1877F2] text-white text-sm font-bold rounded-xl hover:bg-blue-500 transition-colors">
          Contactar <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>

    </div>
  );
};
