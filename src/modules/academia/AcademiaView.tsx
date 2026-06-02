import { GraduationCap, Sparkles, Play, BookOpen, Star, Clock, Users, Trophy, Bell, ArrowRight, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

const courses = [
  {
    icon: Play,
    color: 'text-[#1877F2]',
    bg: 'bg-[#1877F2]/10',
    border: 'border-[#1877F2]/20',
    tag: 'Ventas',
    tagColor: 'bg-[#1877F2]/10 text-[#1877F2]',
    title: 'Masterclass de Ventas',
    desc: 'Domina las técnicas de cierre más efectivas por WhatsApp y convierte más leads en clientes.',
    modules: ['Psicología del comprador', 'Técnicas de cierre', 'Manejo de objeciones', 'Seguimiento efectivo'],
    duration: '6 horas',
    level: 'Todos los niveles',
  },
  {
    icon: BookOpen,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200/60',
    tag: 'Inteligencia Artificial',
    tagColor: 'bg-violet-50 text-violet-600',
    title: 'IA para Negocios',
    desc: 'Aprende a configurar y aprovechar los agentes de IA para automatizar tu proceso de ventas.',
    modules: ['Configuración de bots', 'Flujos automáticos', 'Prompts efectivos', 'Analítica con IA'],
    duration: '4 horas',
    level: 'Intermedio',
  },
  {
    icon: Star,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200/60',
    tag: 'Certificación',
    tagColor: 'bg-amber-50 text-amber-600',
    title: 'Certificación Oficial',
    desc: 'Obtén tu certificado como experto en SmartFlow y diferénciate en el mercado digital.',
    modules: ['Examen teórico', 'Caso práctico', 'Evaluación final', 'Badge digital'],
    duration: '2 horas',
    level: 'Avanzado',
  },
];

const stats = [
  { value: '3', label: 'Cursos', icon: BookOpen },
  { value: '12+', label: 'Horas de contenido', icon: Clock },
  { value: '100%', label: 'Online y a tu ritmo', icon: Users },
];

export const AcademiaView = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="flex flex-col md:flex-row items-center gap-0">
          {/* Left content */}
          <div className="flex-1 p-8 md:p-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1877F2]/10 text-[#1877F2] rounded-full text-[10px] font-black uppercase tracking-widest mb-5">
              <Sparkles className="w-3 h-3" /> Próximamente
            </span>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight mb-3">
              SmartFlow <span className="text-[#1877F2]">Academia</span>
            </h1>
            <p className="text-slate-500 text-sm leading-relaxed mb-6 max-w-md">
              No solo te damos la herramienta — te enseñamos a dominar el mercado. Educación estratégica para dueños de negocio y equipos de ventas.
            </p>

            {/* Notify CTA */}
            <div className="flex items-center gap-2">
              <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-colors">
                <Bell className="w-4 h-4" /> Avisarme cuando esté listo
              </button>
            </div>
          </div>

          {/* Right visual */}
          <div className="w-full md:w-64 bg-gradient-to-br from-[#1877F2]/8 to-[#1877F2]/3 md:self-stretch flex items-center justify-center p-10 border-t md:border-t-0 md:border-l border-slate-100">
            <GraduationCap className="w-24 h-24 text-[#1877F2]/30" strokeWidth={1} />
          </div>
        </div>

        {/* Stats bar */}
        <div className="border-t border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
          {stats.map(({ value, label, icon: Icon }) => (
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

      {/* Section title */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-base font-black text-slate-900">Cursos disponibles</h2>
          <p className="text-xs text-slate-400 mt-0.5">Acceso completo incluido en tu plan</p>
        </div>
        <span className="px-3 py-1 bg-amber-50 text-amber-600 text-[10px] font-black rounded-full uppercase tracking-widest">
          En desarrollo
        </span>
      </div>

      {/* Course cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {courses.map((course, i) => (
          <motion.div
            key={course.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className={`bg-white border rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-all group`}
          >
            {/* Card header */}
            <div className={`px-5 pt-5 pb-4`}>
              <div className="flex items-start justify-between mb-4">
                <div className={`w-10 h-10 ${course.bg} rounded-xl flex items-center justify-center`}>
                  <course.icon className={`w-5 h-5 ${course.color}`} />
                </div>
                <span className={`px-2.5 py-1 ${course.tagColor} text-[9px] font-black rounded-full uppercase tracking-widest`}>
                  {course.tag}
                </span>
              </div>
              <h3 className="text-sm font-black text-slate-900 mb-1.5">{course.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{course.desc}</p>
            </div>

            {/* Modules list */}
            <div className="px-5 pb-4 space-y-1.5">
              {course.modules.map(mod => (
                <div key={mod} className="flex items-center gap-2">
                  <CheckCircle className="w-3 h-3 text-slate-300 shrink-0" />
                  <span className="text-[11px] text-slate-500">{mod}</span>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                  <Clock className="w-3 h-3" /> {course.duration}
                </span>
                <span className="text-[10px] text-slate-300">·</span>
                <span className="text-[10px] text-slate-400 font-medium">{course.level}</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-black text-slate-300 group-hover:text-[#1877F2] transition-colors">
                Pronto <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Bottom banner */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="bg-slate-900 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#1877F2]/20 rounded-xl flex items-center justify-center shrink-0">
            <Trophy className="w-6 h-6 text-[#1877F2]" />
          </div>
          <div>
            <h3 className="text-base font-black text-white">Certificación SmartFlow</h3>
            <p className="text-xs text-slate-400 mt-0.5">Diferénciate como experto certificado en ventas digitales con IA</p>
          </div>
        </div>
        <button className="shrink-0 inline-flex items-center gap-2 px-6 py-2.5 bg-[#1877F2] text-white text-sm font-bold rounded-xl hover:bg-blue-500 transition-colors">
          Saber más <ArrowRight className="w-4 h-4" />
        </button>
      </motion.div>

    </div>
  );
};
