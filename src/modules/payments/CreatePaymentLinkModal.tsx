import { X, User, Tag, Link as LinkIcon, Copy, CheckCircle2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { PaymentService } from '@/services/firebase/PaymentService';
import { useConversationStore } from '@/stores/conversationStore';

interface CreatePaymentLinkModalProps {
  onClose: () => void;
  initialCustomerName?: string;
  conversationId?: string;
  initialConcept?: string;
  initialAmount?: string | number;
  initialCurrency?: string;
}

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
  const [generatedLink, setGeneratedLink] = useState('');
  const { addToast } = useUIStore();
  const { commercial, updateSettings, paypalEmail: storePaypalEmail } = useSettingsStore();
  const { activeMembership } = useAuthStore();
  const { sendMessage } = useConversationStore();

  const [currencyCode, setCurrencyCode] = useState(initialCurrency || commercial?.currency || 'USD');
  const currencySymbol = currencyCode === 'CRC' ? '₡' : '$';

  const handleCurrencyChange = async (newCurrency: string) => {
    setCurrencyCode(newCurrency);
    if (activeMembership?.tenantId) {
      try {
        await updateSettings(activeMembership.tenantId, {
          commercial: { ...commercial, currency: newCurrency }
        });
        addToast(`Moneda actualizada a ${newCurrency}`, 'success');
      } catch (e) {
        console.error("Error updating currency", e);
      }
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId) return;

    try {
      const randomId = Math.random().toString(36).substring(7);
      
      await PaymentService.createRequest({
        id: randomId,
        tenantId: activeMembership.tenantId,
        customer: formData.customer,
        concept: formData.concept,
        amount: Number(formData.amount),
        currency: currencyCode,
        status: 'pending',
        paypalEmail: storePaypalEmail || ''
      });

      setGeneratedLink(`https://hub.smartflow-suite.com/pay/${randomId}`);
      addToast('Link de pago generado con éxito', 'success');
    } catch (error: any) {
      console.error("Error generating payment link", error);
      const msg = error?.code || error?.message || 'Error desconocido';
      addToast(`Error al generar link: ${msg}`, 'error');
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink);
    addToast('Enlace copiado al portapapeles', 'success');
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
              <LinkIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">Nuevo Link de Pago</h3>
              <p className="text-white/70 text-[10px] font-bold uppercase tracking-[0.2em]">Generador Nativo SmartFlow</p>
            </div>
          </div>
        </div>

        <div className="p-8">
          {!generatedLink ? (
            <form onSubmit={handleGenerate} className="space-y-6">
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
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monto de Cobro</label>
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
              </div>

              <button 
                type="submit"
                className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-[#1877F2]/20 transition-all active:scale-95"
              >
                Generar Enlace de Cobro
              </button>
            </form>
          ) : (
            <div className="space-y-6 animate-in zoom-in-95 duration-300">
              <div className="flex flex-col items-center text-center space-y-4 py-4">
                <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-[2rem] flex items-center justify-center shadow-inner">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <div>
                  <h4 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">¡Enlace Listo!</h4>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Envíalo por WhatsApp a tu cliente</p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 relative group">
                <p className="text-xs font-medium text-slate-500 break-all pr-12">
                  {generatedLink}
                </p>
                <button 
                  onClick={copyToClipboard}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-white dark:bg-slate-800 text-[#1877F2] rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:scale-110 transition-all"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-3">
                <button 
                  onClick={() => setGeneratedLink('')}
                  className="flex-1 py-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  Nuevo Link
                </button>
                <button 
                  onClick={async () => {
                    const message = `Hola ${formData.customer || 'cliente'}, te comparto el link para realizar el pago de ${formData.concept || 'tu solicitud'}: ${generatedLink}`;
                    
                    if (conversationId && activeMembership?.tenantId) {
                      try {
                        await sendMessage(conversationId, message, 'advisor', activeMembership.tenantId);
                        addToast('Link enviado al chat', 'success');
                        onClose();
                      } catch (e) {
                        console.error(e);
                        addToast('Error al enviar al chat', 'error');
                      }
                    } else {
                      const text = encodeURIComponent(message);
                      window.open(`https://wa.me/?text=${text}`, '_blank');
                    }
                  }}
                  className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all flex items-center justify-center gap-2"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {conversationId ? 'Enviar al Chat' : 'Enviar WhatsApp'}
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
