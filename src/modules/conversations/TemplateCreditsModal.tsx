import { X, Zap, CreditCard, Loader2, ChevronLeft, ShieldCheck, Globe } from 'lucide-react';
import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';

interface TemplateCreditsModalProps {
  onClose: () => void;
  tenantId: string;
}

export const TemplateCreditsModal = ({ onClose }: Omit<TemplateCreditsModalProps, 'tenantId'>) => {
  const [step, setStep] = useState<'package' | 'payment'>('package');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedPack, setSelectedPack] = useState<number | null>(100);
  const { addToast } = useUIStore();

  const packs = [
    { id: 50, amount: 50, price: 5, description: 'Ideal para pruebas rápidas' },
    { id: 100, amount: 100, price: 9, description: 'El más popular para equipos' },
    { id: 500, amount: 500, price: 35, description: 'Ahorro máximo por volumen' },
  ];

  const currentPack = packs.find(p => p.id === selectedPack);

  const handlePayment = async (method: 'paypal' | 'card') => {
    setIsProcessing(true);
    // Aquí se integraría el SDK de Stripe o PayPal
    setTimeout(() => {
      setIsProcessing(false);
      addToast(`Pago con ${method === 'paypal' ? 'PayPal' : 'Tarjeta'} procesado. Créditos añadidos.`, 'success');
      onClose();
    }, 2500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 w-full max-w-xl rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 duration-300">
        
        {/* Header */}
        <div className="bg-slate-900 p-8 text-white relative">
          <div className="flex items-center justify-between">
            {step === 'payment' && (
              <button 
                onClick={() => setStep('package')}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors flex items-center gap-2 text-xs font-bold text-slate-400"
              >
                <ChevronLeft className="w-4 h-4" /> Volver
              </button>
            )}
            <button 
              onClick={onClose}
              className="absolute right-6 top-6 p-2 hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
          
          <div className="flex items-center gap-4 mt-4">
            <div className="p-3 bg-blue-500 rounded-2xl shadow-lg shadow-blue-500/20">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-black tracking-tight">{step === 'package' ? 'Cargar Créditos' : 'Finalizar Pago'}</h3>
              <p className="text-blue-300 text-[10px] font-black uppercase tracking-[0.2em]">WhatsApp Reactivaciones API</p>
            </div>
          </div>
        </div>

        <div className="p-8">
          {step === 'package' ? (
            <>
              <div className="mb-8">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 ml-1">1. Selecciona tu paquete</h4>
                <div className="grid grid-cols-1 gap-3">
                  {packs.map((pack) => (
                    <button
                      key={pack.id}
                      onClick={() => setSelectedPack(pack.id)}
                      className={`flex items-center justify-between p-5 rounded-3xl border-2 transition-all duration-300 text-left ${
                        selectedPack === pack.id 
                          ? 'bg-blue-50 border-blue-500 dark:bg-blue-900/20 shadow-lg shadow-blue-500/10 scale-[1.02]' 
                          : 'bg-white border-slate-100 dark:bg-slate-800 dark:border-slate-700 hover:border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl transition-colors ${selectedPack === pack.id ? 'bg-blue-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
                          <Zap className="w-5 h-5" />
                        </div>
                        <div>
                          <h5 className="font-black text-slate-900 dark:text-white text-lg">{pack.amount} Reactivaciones</h5>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{pack.description}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-slate-900 dark:text-white">${pack.price}</span>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">USD</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 mb-8">
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Total a Pagar</span>
                  <span className="text-3xl font-black text-blue-600 dark:text-blue-400">${currentPack?.price}.00</span>
                </div>
              </div>

              <button
                onClick={() => setStep('payment')}
                className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-[1.5rem] font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-slate-900/20 transition-all flex items-center justify-center gap-3 active:scale-95"
              >
                Continuar al Pago <ChevronLeft className="w-4 h-4 rotate-180" />
              </button>
            </>
          ) : (
            <div className="animate-in slide-in-from-right-4 duration-300">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 ml-1">2. Elige tu método de pago</h4>
              
              <div className="space-y-4 mb-8">
                {/* PayPal Button */}
                <button
                  onClick={() => handlePayment('paypal')}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-between p-6 bg-[#FFC439] hover:bg-[#f2b930] rounded-3xl transition-all group active:scale-95 disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-white p-2 rounded-xl shadow-sm">
                       <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_37x23.jpg" alt="PayPal" className="h-6" />
                    </div>
                    <span className="font-black text-[#003087] uppercase tracking-widest text-xs">Pagar con PayPal</span>
                  </div>
                  <Globe className="w-5 h-5 text-[#003087] opacity-50" />
                </button>

                {/* Credit Card Button */}
                <button
                  onClick={() => handlePayment('card')}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-between p-6 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 rounded-3xl transition-all group active:scale-95 disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="bg-slate-100 dark:bg-slate-700 p-2 rounded-xl shadow-sm">
                       <CreditCard className="w-6 h-6 text-slate-600 dark:text-slate-300" />
                    </div>
                    <span className="font-black text-slate-900 dark:text-white uppercase tracking-widest text-xs">Tarjeta de Crédito / Débito</span>
                  </div>
                  <ShieldCheck className="w-5 h-5 text-emerald-500 opacity-50" />
                </button>
              </div>

              <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-3xl border border-blue-100 dark:border-blue-800/50 flex items-start gap-4">
                <div className="p-2 bg-blue-500 text-white rounded-xl">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-100">Pago 100% Seguro</p>
                  <p className="text-[10px] text-blue-700 dark:text-blue-300 mt-1">Tu información está protegida por encriptación bancaria de 256 bits.</p>
                </div>
              </div>
            </div>
          )}
          
          <p className="text-center text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mt-8 flex items-center justify-center gap-2">
            <Globe className="w-3 h-3 text-emerald-500" /> Transacción internacional segura
          </p>
        </div>
      </div>

      {isProcessing && (
        <div className="fixed inset-0 z-[110] bg-slate-900/80 backdrop-blur-xl flex flex-col items-center justify-center text-white p-8">
          <div className="relative">
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Zap className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <h3 className="text-2xl font-black mt-8 tracking-tighter">Procesando Pago Seguro</h3>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-[0.3em] mt-2">No cierres esta ventana</p>
        </div>
      )}
    </div>
  );
};
