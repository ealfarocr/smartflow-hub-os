import { useState, useRef, useEffect } from 'react';
import { Send, X, MessageSquare, Loader2, User, Bot, Sparkles, Headset, Lightbulb, CreditCard, HelpCircle, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';

type MessageTag = 'SOPORTE' | 'MEJORA' | 'FACTURA' | 'CONSULTA';

const TAG_CONFIG: Record<MessageTag, { label: string; color: string; bg: string; icon: React.ElementType; subject: string }> = {
  SOPORTE:  { label: 'Soporte Técnico', color: 'text-red-600',    bg: 'bg-red-50',    icon: AlertCircle,  subject: 'SOPORTE' },
  MEJORA:   { label: 'Sugerencia',      color: 'text-violet-600', bg: 'bg-violet-50', icon: Lightbulb,    subject: 'MEJORA' },
  FACTURA:  { label: 'Facturación',     color: 'text-amber-600',  bg: 'bg-amber-50',  icon: CreditCard,   subject: 'FACTURA' },
  CONSULTA: { label: 'Consulta',        color: 'text-[#1877F2]',  bg: 'bg-blue-50',   icon: HelpCircle,   subject: 'CONSULTA' },
};

function classifyMessage(text: string): MessageTag {
  const q = text.toLowerCase();
  if (q.match(/mejora|mejorar|sugerencia|agregar|añadir|nueva.func|feature|implementar|sería.bueno|idea|propuesta|podrían|podrías/))
    return 'MEJORA';
  if (q.match(/factura|cobro|cargo|suscripci[oó]n|cancelar|cancelaci[oó]n|reembolso|plan|precio|costo|pagar|pago|cobran/))
    return 'FACTURA';
  if (q.match(/error|bug|falla|no.funciona|problema|humano|persona|soporte|ayuda.real|no.puedo|roto|caído|ca[íi]do/))
    return 'SOPORTE';
  return 'CONSULTA';
}

const SupportAgent: React.FC = () => {
  const { company } = useSettingsStore();
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [mode, setMode] = useState<'ia' | 'human'>('ia');
  const [sendingHuman, setSendingHuman] = useState(false);

  const [messages, setMessages] = useState([
    { text: `¡Hola! Soy el asistente de **SmartFlow Hub OS** asignado a **${company?.tradeName || 'tu negocio'}**. ¿En qué puedo ayudarte hoy?`, type: 'ai' }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendToAdmin = async (text: string, tag?: MessageTag) => {
    setSendingHuman(true);
    const resolvedTag = tag || classifyMessage(text);
    const cfg = TAG_CONFIG[resolvedTag];
    try {
      await addDoc(collection(db, 'admin_emails'), {
        from: `${user?.name || 'Usuario'} <${user?.email || 'desconocido@smartflow.com'}>`,
        subject: `${cfg.subject}: ${company?.tradeName || 'Negocio'} — ${user?.name || 'Usuario'}`,
        text,
        timestamp: serverTimestamp(),
        isRead: false,
        isStarred: false,
        folder: 'inbox',
        tenantId: activeMembership?.tenantId || 'global',
        type: 'support_request',
        tag: resolvedTag,
      });

      const confirmMsg: Record<MessageTag, string> = {
        SOPORTE:  'Entendido. Enviamos tu reporte al equipo técnico. Te responderemos a la brevedad.',
        MEJORA:   '¡Gracias por tu sugerencia! La registramos para el equipo de producto. Valoramos mucho el feedback.',
        FACTURA:  'Recibido. Enviamos tu consulta de facturación al equipo. Te contactamos pronto.',
        CONSULTA: 'Consulta recibida. Nuestro equipo la revisará y te responde en breve.',
      };

      addToast(`Mensaje enviado · ${cfg.label}`, 'success');
      setMessages(prev => [...prev, { text: confirmMsg[resolvedTag], type: 'ai' }]);
      setMode('human');
    } catch (err) {
      console.error(err);
      addToast('Error al contactar soporte', 'error');
    } finally {
      setSendingHuman(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { text: userMsg, type: 'user' }]);
    setInput('');

    if (mode === 'human') {
      await sendToAdmin(userMsg);
      return;
    }

    const tag = classifyMessage(userMsg);

    // If clearly needs human routing, send immediately
    if (tag === 'SOPORTE' && userMsg.toLowerCase().match(/humano|persona|soporte|ayuda.real/)) {
      await sendToAdmin(userMsg, 'SOPORTE');
      return;
    }
    if (tag === 'MEJORA') {
      await sendToAdmin(userMsg, 'MEJORA');
      return;
    }
    if (tag === 'FACTURA') {
      await sendToAdmin(userMsg, 'FACTURA');
      return;
    }

    setIsTyping(true);
    setTimeout(() => {
      const q = userMsg.toLowerCase();
      let response = `Como experto en la plataforma para **${company?.tradeName || 'tu negocio'}**, puedo ayudarte. ¿Deseas ayuda con tus conexiones o herramientas?`;

      if (q.includes('whatsapp') || q.includes('api')) {
        response = `Para conectar WhatsApp usamos la **API oficial**. Cuesta **$69/mes** y requiere verificación con Meta (24-72h). Permite que todo tu equipo comparta la línea de forma legal y segura.`;
      } else if (q.includes('pago') || q.includes('paypal') || q.includes('tarjeta')) {
        response = `Puedes cobrar con **tarjeta o PayPal** vía Links de Pago ($12/mes). Solo vincula tu cuenta y el dinero llega directo a ti.`;
      } else if (q.includes('crm') || q.includes('gratis')) {
        response = `El **CRM Kanban** es gratuito para siempre. Gestiona todos tus leads y ventas sin pagar licencias por usuario.`;
      } else if (q.match(/\bia\b/) || (q.includes('agente') && !q.includes('soporte'))) {
        response = `El **Agente IA 24/7** ($49/mes) responde mensajes y califica leads automáticamente. Se integra directo en WhatsApp.`;
      } else if (q.includes('branding') || q.includes('logo') || q.includes('color')) {
        response = `Para cambiar colores y logotipo ve a **Configuración → Branding**. Puedes personalizar tu paleta y el encabezado de cotizaciones.`;
      } else if (q.includes('cotizaci') || q.includes('pdf')) {
        response = `Las **Cotizaciones PDF** ($15/mes) generan propuestas profesionales en segundos. Van con tu logo, colores de marca y se pueden enviar por WhatsApp.`;
      }

      setMessages(prev => [...prev, { text: response, type: 'ai' }]);
      setIsTyping(false);
    }, 1000);
  };

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-8 right-8 z-[9999] w-14 h-14 bg-[#1877F2] text-white rounded-2xl flex items-center justify-center shadow-2xl hover:scale-110 transition-all active:scale-90"
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X size={22} />
            </motion.div>
          ) : (
            <motion.div key="open" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="relative">
              <MessageSquare size={24} />
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 border-2 border-[#1877F2] rounded-full animate-pulse" />
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Chat Window */}
      <div className={`fixed bottom-28 right-8 z-[9999] w-96 h-[600px] max-h-[80vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700 transition-all duration-300 origin-bottom-right ${isOpen ? 'scale-100 opacity-100' : 'scale-90 opacity-0 pointer-events-none translate-y-4'}`}>

        {/* Header */}
        <div className="bg-[#1877F2] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center text-base">
              {mode === 'ia' ? '🤖' : '👩‍💼'}
            </div>
            <div>
              <h3 className="font-black text-sm leading-none">Soporte Hub</h3>
              <span className="text-[10px] font-bold opacity-80 flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                {mode === 'ia' ? 'Asistente IA activo' : 'Soporte humano'}
              </span>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-white/60 hover:text-white transition-colors p-1">
            <X size={18} />
          </button>
        </div>

        {/* Tag legend */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 flex items-center gap-1.5 shrink-0 overflow-x-auto">
          {(Object.entries(TAG_CONFIG) as [MessageTag, typeof TAG_CONFIG[MessageTag]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <span key={key} className={`inline-flex items-center gap-1 px-2 py-0.5 ${cfg.bg} ${cfg.color} rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap`}>
                <Icon className="w-2.5 h-2.5" /> {cfg.label}
              </span>
            );
          })}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50 dark:bg-slate-950 flex flex-col gap-3">
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: m.type === 'ai' ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              className={`max-w-[88%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                m.type === 'ai'
                  ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 self-start rounded-bl-none border border-slate-100 dark:border-slate-700'
                  : 'bg-[#1877F2] text-white self-end rounded-br-none'
              }`}
            >
              <div className="flex items-start gap-2">
                {m.type === 'ai' && <Bot size={12} className="text-[#1877F2] shrink-0 mt-0.5" />}
                <span>
                  {m.text.split(/\*\*(.*?)\*\*/g).map((part, idx) =>
                    idx % 2 === 1 ? <strong key={idx}>{part}</strong> : <span key={idx}>{part}</span>
                  )}
                </span>
                {m.type === 'user' && <User size={12} className="shrink-0 mt-0.5 opacity-70" />}
              </div>
            </motion.div>
          ))}

          {isTyping && (
            <div className="bg-white dark:bg-slate-800 self-start px-4 py-2.5 rounded-2xl rounded-bl-none border border-slate-100 dark:border-slate-700 flex items-center gap-2 text-xs text-slate-400 font-medium">
              <Loader2 size={13} className="animate-spin text-[#1877F2]" /> Escribiendo...
            </div>
          )}
          {sendingHuman && (
            <div className="bg-blue-50 dark:bg-blue-900/20 self-start px-4 py-2.5 rounded-2xl rounded-bl-none border border-blue-100 flex items-center gap-2 text-xs text-[#1877F2] font-bold">
              <Loader2 size={13} className="animate-spin" /> Enviando mensaje...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Human CTA */}
        {mode === 'ia' && !isTyping && !sendingHuman && (
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex justify-center shrink-0">
            <button
              onClick={() => sendToAdmin('Solicito ayuda de un humano para mi negocio.', 'SOPORTE')}
              className="text-[10px] font-black text-[#1877F2] uppercase tracking-widest bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 border border-blue-100 dark:border-slate-700"
            >
              <Headset size={12} /> Hablar con soporte humano
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder={mode === 'ia' ? '¿En qué puedo ayudarte?' : 'Escribe a soporte...'}
            className="flex-1 bg-slate-100 dark:bg-slate-950 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#1877F2]/20"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendingHuman}
            className="w-10 h-10 bg-[#1877F2] text-white rounded-xl flex items-center justify-center hover:bg-blue-600 transition-colors disabled:opacity-30"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
};

export default SupportAgent;
