import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PaymentService, PaymentRequest } from '@/services/firebase/PaymentService';
import { Loader2, CheckCircle2, AlertCircle, Lock, Copy, MessageSquare, Check, ExternalLink, Wallet } from 'lucide-react';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export const PublicPaymentView = () => {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    if (!request?.tenantId) return;
    const docRef = doc(db, 'settings', request.tenantId);
    const unsub = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data());
      }
    });
    return () => unsub();
  }, [request?.tenantId]);

  useEffect(() => {
    const loadRequest = async () => {
      if (!id) return;
      try {
        const data = await PaymentService.getRequest(id);
        if (data) {
          setRequest(data);
        } else {
          setError('La solicitud de pago no existe o ha expirado.');
        }
      } catch (err) {
        console.error(err);
        setError('Error al cargar la información de pago.');
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-[#1877F2] animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Cargando plataforma de pago...</p>
        </div>
      </div>
    );
  }

  if (error || !request) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-red-100">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">¡Ups! Algo salió mal</h1>
          <p className="text-slate-500 mb-8">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
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
  const currencySymbol = getSymbol(request.currency);
  const isCostaRica = request.currency === 'CRC';
  const localPaymentTitle = isCostaRica ? "Transferencia Local (Costa Rica)" : "Transferencia o Pago Móvil Local";
  const localPaymentSub = isCostaRica ? "SINPE Móvil & Cuentas IBAN" : "Datos de Transferencia Bancaria";
  const localPaymentMethodLabel = isCostaRica ? "SINPE Móvil" : "Pago Móvil / Identificación";
  const whatsappReportText = isCostaRica 
    ? `Hola, acabo de realizar mi pago de ₡${request.amount.toLocaleString()} por el concepto "${request.concept}" mediante SINPE/Transferencia bancaria. Adjunto el comprobante de pago.`
    : `Hola, acabo de realizar mi pago de ${currencySymbol}${request.amount.toLocaleString()} ${request.currency} por el concepto "${request.concept}" mediante transferencia bancaria/pago local. Adjunto el comprobante de pago.`;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center py-12 px-4">
      {/* Brand Header */}
      <div className="mb-12 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-2xl font-black text-[#1877F2] tracking-tighter italic">SMARTFLOW</span>
          <span className="text-2xl font-black text-slate-900 tracking-tighter">HUB</span>
        </div>
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Plataforma de Pagos Seguros</p>
      </div>

      <div className="max-w-[500px] w-full bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden border border-slate-100">
        {/* Amount Header */}
        <div className="bg-[#1877F2] p-10 text-center text-white relative">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400/20 to-transparent pointer-events-none" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 opacity-80">Concepto de Pago</p>
          <h2 className="text-2xl font-black mb-10 tracking-tight uppercase">{request.concept}</h2>
          
          <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 opacity-80">Total a Pagar</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-3xl font-black opacity-60 mb-4">{currencySymbol}</span>
            <span className="text-7xl font-black tracking-tighter">
              {request.amount.toLocaleString()}
            </span>
            <span className="text-xl font-black opacity-60 mb-8 ml-1">{request.currency}</span>
          </div>
        </div>

        {/* Payment Details */}
        <div className="p-10 space-y-10">
          <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100 relative group transition-all hover:bg-slate-50">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cliente</p>
            <div className="flex items-center justify-between">
              <span className="text-lg font-black text-slate-900">{request.customer}</span>
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-slate-100 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-blue-500" />
              </div>
            </div>
          </div>

          {/* Payment Options */}
          <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-[2px] flex-1 bg-slate-100" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opciones de Pago</span>
              <div className="h-[2px] flex-1 bg-slate-100" />
            </div>

            {/* Costa Rica SINPE & Bank Transfer Card */}
            {(settings?.sinpePhone || settings?.bankAccounts) && (
              <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border-2 border-blue-100/80 rounded-3xl p-6 space-y-5 shadow-sm animate-in fade-in duration-300">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[#1877F2] text-white rounded-xl shadow-md">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-slate-900 tracking-tight">Transferencia Local (Costa Rica)</h4>
                    <p className="text-[9px] text-blue-600 font-bold uppercase tracking-widest font-mono">SINPE Móvil & Cuentas IBAN</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {settings.sinpePhone && (
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">SINPE Móvil</span>
                        <div className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Cero Comisiones</div>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xl font-black text-[#1877F2] font-mono tracking-wide">{settings.sinpePhone}</p>
                          <p className="text-xs text-slate-500 font-semibold mt-0.5">{settings.sinpeOwner}</p>
                          {settings.sinpeId && (
                            <p className="text-[9px] text-slate-400 font-medium">Cédula: {settings.sinpeId}</p>
                          )}
                        </div>
                        <button 
                          onClick={() => handleCopy(settings.sinpePhone, 'sinpe')}
                          className="px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                        >
                          {copiedField === 'sinpe' ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copiar Tel
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {settings.bankAccounts && (
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-2.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Cuentas Bancarias / IBAN</span>
                      <div className="text-xs font-semibold text-slate-700 whitespace-pre-wrap leading-relaxed font-mono bg-slate-50 p-3 rounded-xl border border-slate-100">
                        {settings.bankAccounts}
                      </div>
                      <button 
                        onClick={() => handleCopy(settings.bankAccounts, 'bank')}
                        className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 active:scale-95"
                      >
                        {copiedField === 'bank' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-500" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copiar Cuentas
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  <div className="bg-blue-100/40 border border-blue-200/50 p-4 rounded-2xl text-[10px] text-blue-800 leading-relaxed font-bold">
                    💡 <b>¿Cómo reportar tu pago?</b> Realiza la transferencia por SINPE o banco, y repórtalo directamente a nuestro chat presionando el botón de abajo.
                  </div>

                  <a 
                    href={`https://wa.me/${settings?.company?.phone?.replace(/\D/g, '') || '50688888888'}?text=${encodeURIComponent(
                      `Hola, acabo de realizar mi pago de ₡${request.amount.toLocaleString()} por el concepto "${request.concept}" mediante SINPE/Transferencia bancaria. Adjunto el comprobante de pago.`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                  >
                    <MessageSquare className="w-4.5 h-4.5 fill-current" /> Reportar Pago por WhatsApp
                  </a>
                </div>
              </div>
            )}

            {/* Alternativa de pago internacional si aplica */}
            {(settings?.sinpePhone || settings?.bankAccounts) && (
              <div className="flex items-center gap-3 my-6">
                <div className="h-[1px] flex-1 bg-slate-100" />
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">O pagar con Tarjeta / PayPal</span>
                <div className="h-[1px] flex-1 bg-slate-100" />
              </div>
            )}

            <PayPalScriptProvider options={{ 
              clientId: "test", 
              currency: request.currency === 'MX' ? 'MXN' : (request.currency === 'CRC' ? 'USD' : request.currency),
              components: "buttons",
              enableFunding: "card,paylater"
            }}>
              <div className="space-y-4">
                <PayPalButtons 
                  style={{ 
                    layout: 'vertical',
                    color: 'blue',
                    shape: 'pill',
                    label: 'pay'
                  }}
                  createOrder={(_, actions) => {
                    const amountInPaypalCurrency = request.currency === 'CRC' 
                      ? (request.amount / 525).toFixed(2) // Rough conversion for demo
                      : request.amount.toString();

                    return actions.order.create({
                      intent: "CAPTURE",
                      purchase_units: [{
                        amount: {
                          currency_code: request.currency === 'MX' ? 'MXN' : (request.currency === 'CRC' ? 'USD' : request.currency),
                          value: amountInPaypalCurrency,
                        },
                        description: request.concept,
                        payee: {
                          email_address: request.paypalEmail
                        }
                      }]
                    });
                  }}
                  onApprove={async (_, actions) => {
                    if (actions.order) {
                      const details = await actions.order.capture();
                      alert(`Pago completado por ${details.payer?.name?.given_name}`);
                    }
                  }}
                />
              </div>
            </PayPalScriptProvider>
            
            <div className="flex items-center justify-center gap-2 text-slate-400 pt-4">
              <Lock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Procesamiento Seguro vía PayPal</span>
            </div>
          </div>

          {/* Footer Info */}
          <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest mb-1">ID de Transacción</p>
              <p className="text-[10px] font-mono text-slate-400">{request.id}</p>
            </div>
            <div className="flex items-center gap-3 grayscale opacity-30">
              <img src="https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg" alt="PayPal" className="h-3" />
              <div className="w-[1px] h-4 bg-slate-200" />
              <img src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Visa_Inc._logo.svg" alt="Visa" className="h-2" />
              <img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" alt="Mastercard" className="h-4" />
            </div>
          </div>
        </div>
      </div>
      
      <p className="mt-8 text-[10px] font-black text-slate-400 uppercase tracking-widest opacity-50">
        Powered by SmartFlow Technology
      </p>
    </div>
  );
};
