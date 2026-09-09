import { X, User, Tag, Copy, CheckCircle2, Send, ExternalLink, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { PaymentService, PaymentMethod } from '@/services/firebase/PaymentService';
import { useConversationStore } from '@/stores/conversationStore';

interface CreatePaymentLinkModalProps {
  onClose: () => void;
  initialCustomerName?: string;
  conversationId?: string;
  initialConcept?: string;
  initialAmount?: string | number;
  initialCurrency?: string;
}

const getSymbol = (curr: string) => {
  switch (curr) {
    case 'CRC': return '₡';
    case 'PEN': return 'S/';
    case 'GTQ': return 'Q';
    case 'HNL': return 'L';
    default: return '$';
  }
};

// PayPal en standby — solo se ofrecen instrucciones de pago locales (SINPE /
// transferencia bancaria). Para estos métodos SmartFlow NO procesa ni
// custodia el dinero: solo organiza y presenta las instrucciones de cobro
// del propio negocio, el pago va directo del cliente a la cuenta del
// negocio. Por eso el flujo NO se llama "generar link de pago" — se arman
// instrucciones y se envían directo por WhatsApp (evita un paso de más).
export const CreatePaymentLinkModal = ({
  onClose,
  initialCustomerName = '',
  conversationId,
  initialConcept = '',
  initialAmount = '',
  initialCurrency
}: CreatePaymentLinkModalProps) => {
  const [formData, setFormData] = useState({
    customer: initialCustomerName,
    concept: initialConcept,
    amount: initialAmount ? String(initialAmount) : ''
  });
  const [sent, setSent] = useState(false);
  const [publicLinkUrl, setPublicLinkUrl] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { addToast } = useUIStore();
  const {
    commercial, updateSettings, company, branding,
    sinpePhone, sinpeOwner, sinpeId, bankAccounts,
  } = useSettingsStore();
  const { activeMembership } = useAuthStore();
  const { sendMessage } = useConversationStore();

  const [currencyCode, setCurrencyCode] = useState(initialCurrency || commercial?.currency || 'USD');
  const currencySymbol = getSymbol(currencyCode);

  // El asesor elige EXACTAMENTE qué incluir en ESTA instrucción puntual —
  // nunca todo lo configurado en /pagos por default silencioso.
  const [includeSinpe, setIncludeSinpe] = useState(!!sinpePhone);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    (bankAccounts || []).map(a => a.id)
  );
  const toggleAccount = (id: string) => {
    setSelectedAccountIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const hasAnyConfigured = !!sinpePhone || (bankAccounts && bankAccounts.length > 0);
  const hasAnySelected = includeSinpe || selectedAccountIds.length > 0;

  const businessName = company?.tradeName || company?.legalName || 'SmartFlow Hub';

  // Arma el texto formateado con las instrucciones — esto es lo que se manda
  // directo por WhatsApp (Opción A: evita el paso extra de abrir un link).
  const buildInstructionsText = () => {
    const selectedAccounts = (bankAccounts || []).filter(a => selectedAccountIds.includes(a.id));
    const lines: string[] = [];
    lines.push(`*${businessName}*`);
    lines.push(`Monto a pagar: ${currencySymbol}${Number(formData.amount || 0).toLocaleString()} ${currencyCode}`);
    if (formData.concept) lines.push(`Concepto: ${formData.concept}`);
    lines.push('');
    if (includeSinpe && sinpePhone) {
      lines.push('*SINPE Móvil*');
      lines.push(sinpePhone);
      if (sinpeOwner) lines.push(sinpeOwner);
      lines.push('');
    }
    for (const acc of selectedAccounts) {
      lines.push(`*${acc.bankName || 'Cuenta bancaria'}*`);
      lines.push(acc.accountNumber);
      if (acc.owner) lines.push(acc.owner);
      lines.push('');
    }
    lines.push('Después de realizar el pago, envía el comprobante por este WhatsApp.');
    return lines.join('\n');
  };

  const handleCurrencyChange = async (newCurrency: string) => {
    setCurrencyCode(newCurrency);
    if (activeMembership?.tenantId) {
      try {
        await updateSettings(activeMembership.tenantId, {
          commercial: { ...commercial, currency: newCurrency }
        });
      } catch (e) {
        console.error("Error updating currency", e);
      }
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId) return;
    if (!hasAnySelected) {
      addToast('Elegí al menos un método de pago para incluir', 'warning');
      return;
    }

    setIsSending(true);
    try {
      const selectedAccounts = (bankAccounts || []).filter(a => selectedAccountIds.includes(a.id));
      const enabledMethods: PaymentMethod[] = [
        ...(includeSinpe ? ['sinpe' as PaymentMethod] : []),
        ...(selectedAccounts.length > 0 ? ['bank' as PaymentMethod] : []),
      ];

      // Token no predecible — un link de pago público necesita el mismo
      // estándar que cualquier token de acceso.
      const randomId = crypto.randomUUID();

      // Se sigue guardando el registro (payment_requests/public_payment_links)
      // para historial y para poder confirmar el pago después — pero la
      // ficha pública /pay/{id} queda como respaldo opcional, no como el
      // canal principal (ver PublicPaymentView.tsx).
      await PaymentService.createRequest({
        id: randomId,
        tenantId: activeMembership.tenantId,
        customer: formData.customer,
        concept: formData.concept,
        amount: Number(formData.amount),
        currency: currencyCode,
        status: 'pending',
        paypalEmail: '',
        enabledMethods,
      }, {
        enabledMethods,
        businessName,
        businessLogo: branding?.logoUrl || '',
        whatsappPhone: company?.phone || '',
        ...(includeSinpe ? { sinpePhone: sinpePhone || '', sinpeOwner: sinpeOwner || '', sinpeId: sinpeId || '' } : {}),
        ...(selectedAccounts.length > 0 ? { bankAccounts: selectedAccounts } : {}),
      });

      const link = `https://hub.smartflow-suite.com/pay/${randomId}`;
      setPublicLinkUrl(link);

      const message = buildInstructionsText();

      if (conversationId && activeMembership?.tenantId) {
        // Opción A: mandar las instrucciones directo al chat, sin paso extra.
        await sendMessage(conversationId, message, 'advisor', activeMembership.tenantId);
        addToast('Instrucciones de pago enviadas', 'success');
      } else {
        // Sin conversación activa (ej. desde /pagos): abrir WhatsApp con el
        // texto ya armado, el asesor elige a quién enviarlo.
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
      }

      setSent(true);
    } catch (error: any) {
      console.error("Error sending payment instructions", error);
      const msg = error?.code || error?.message || 'Error desconocido';
      addToast(`Error al enviar instrucciones: ${msg}`, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(publicLinkUrl);
    addToast('Enlace copiado', 'success');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 duration-300">

        {/* Header */}
        <div className="bg-[#1877F2] p-8 text-white relative">
          <button
            onClick={onClose}
            className="absolute right-6 top-6 p-2 hover:bg-white/10 rounded-xl transition-colors"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>

          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-2xl">
              <Send className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Enviar Instrucciones de Pago</h3>
              <p className="text-white/70 text-[10px] font-bold uppercase tracking-[0.2em]">SmartFlow solo organiza tus datos de cobro</p>
            </div>
          </div>
        </div>

        <div className="p-8">
          {!sent ? (
            <form onSubmit={handleSend} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nombre del Cliente</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      required
                      type="text"
                      placeholder="Ej: Eduardo Alfaro"
                      value={formData.customer}
                      onChange={(e) => setFormData({...formData, customer: e.target.value})}
                      className="w-full pl-11 pr-4 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl outline-none transition-all font-medium text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Concepto del Pago</label>
                  <div className="relative">
                    <Tag className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      required
                      type="text"
                      placeholder="Ej: Anticipo Instalación Paneles"
                      value={formData.concept}
                      onChange={(e) => setFormData({...formData, concept: e.target.value})}
                      className="w-full pl-11 pr-4 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl outline-none transition-all font-medium text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monto a Pagar</label>
                    <select
                      value={currencyCode}
                      onChange={(e) => handleCurrencyChange(e.target.value)}
                      className="bg-transparent text-[10px] font-black text-[#1877F2] uppercase tracking-widest outline-none cursor-pointer hover:underline"
                    >
                      <option value="CRC">CRC (Costa Rica)</option>
                      <option value="MX">MX (México)</option>
                      <option value="USD">USD (Dólar)</option>
                      <option value="COP">COP (Colombia)</option>
                      <option value="PEN">PEN (Perú)</option>
                      <option value="EUR">EUR (Euro)</option>
                    </select>
                  </div>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1877F2] font-black flex items-center justify-center">{currencySymbol}</div>
                    <input
                      required
                      type="number"
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={(e) => setFormData({...formData, amount: e.target.value})}
                      className="w-full pl-11 pr-4 py-4 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/20 focus:bg-white rounded-2xl outline-none transition-all font-black text-slate-900 dark:text-white text-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Qué incluir en estas instrucciones</label>
                  {!hasAnyConfigured ? (
                    <div className="flex items-start gap-2.5 p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/20 rounded-2xl">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                        Todavía no configuraste ningún método de pago local. Andá a <strong>Cobros</strong> y cargá tu SINPE Móvil o una cuenta bancaria antes de enviar instrucciones.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {sinpePhone && (
                        <label className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                          <input type="checkbox" checked={includeSinpe} onChange={() => setIncludeSinpe(v => !v)}
                            className="w-4 h-4 text-[#1877F2] rounded focus:ring-[#1877F2]/30" />
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">SINPE Móvil ({sinpePhone})</span>
                        </label>
                      )}
                      {(bankAccounts || []).map(acc => (
                        <label key={acc.id} className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                          <input type="checkbox" checked={selectedAccountIds.includes(acc.id)} onChange={() => toggleAccount(acc.id)}
                            className="w-4 h-4 text-[#1877F2] rounded focus:ring-[#1877F2]/30" />
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{acc.bankName || 'Cuenta bancaria'} ({acc.accountNumber})</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={!hasAnySelected || isSending}
                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-[#1877F2]/20 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                {isSending ? 'Enviando...' : conversationId ? 'Enviar al Chat' : 'Enviar por WhatsApp'}
              </button>
            </form>
          ) : (
            <div className="space-y-6 animate-in zoom-in-95 duration-300">
              <div className="flex flex-col items-center text-center space-y-4 py-4">
                <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-[2rem] flex items-center justify-center shadow-inner">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                    {conversationId ? 'Instrucciones enviadas' : 'Instrucciones listas'}
                  </h4>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    {conversationId ? 'Ya están en el chat con el cliente' : 'Se abrió WhatsApp con el mensaje listo'}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 relative group">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Ficha de respaldo (opcional)</p>
                <p className="text-xs font-medium text-slate-500 break-all pr-12">
                  {publicLinkUrl}
                </p>
                <button
                  onClick={copyLink}
                  className="absolute right-3 bottom-3 p-3 bg-white dark:bg-slate-800 text-[#1877F2] rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:scale-110 transition-all"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => window.open(publicLinkUrl, '_blank')}
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Ver ficha
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-4 bg-[#1877F2] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[#166fe5] transition-all"
                >
                  Finalizar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
