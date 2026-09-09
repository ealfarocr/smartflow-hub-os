import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PublicPaymentLink } from '@/services/firebase/PaymentService';
import { normalizeBankAccounts } from '@/services/firebase/SettingsService';
import { Loader2, CheckCircle2, AlertCircle, Lock, Copy, Check, Wallet, Building2, Clock } from 'lucide-react';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Ficha pública de INSTRUCCIONES DE PAGO — sin autenticación. Lee ÚNICAMENTE
// public_payment_links (snapshot mínimo y sanitizado, ver PaymentService.ts),
// nunca payment_requests (privado, requiere isAuthenticated()) ni settings
// del tenant (que traería aiAgentConfig, tokens, y datos de otros módulos).
//
// IMPORTANTE — concepto (para SINPE/transferencia/IBAN locales): SmartFlow
// NO procesa, custodia ni garantiza estos pagos. Esta página únicamente
// organiza y presenta las instrucciones de cobro que el propio negocio
// configuró — el dinero va directo del cliente a la cuenta del negocio. Por
// eso el protagonista visual es el negocio (logo/nombre), nunca SmartFlow,
// y el copy nunca debe sugerir que SmartFlow interviene en el dinero.
// PayPal es la única excepción real: ahí sí hay un procesador de pago de
// terceros de por medio (PayPal mismo), así que esa sección mantiene su
// propio copy de "procesamiento seguro" — pero PayPal está en standby
// (ninguna Cloud Function de captura está desplegada todavía).
export const PublicPaymentView = () => {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<PublicPaymentLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const handleCopy = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    if (!id) return; // sin id no hay nada que suscribir — el render de abajo ya cubre este caso
    const docRef = doc(db, 'public_payment_links', id);
    const unsub = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setRequest(snapshot.data() as PublicPaymentLink);
          setError(null);
        } else {
          setError('Esta instrucción de pago no existe o ya no está disponible.');
        }
        setLoading(false);
      },
      (err) => {
        console.error('[PublicPaymentView] Error al leer public_payment_links:', err);
        setError('Error al cargar la información de pago.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id]);

  // Orden y captura 100% server-side (solo PayPal, en standby) — el
  // navegador nunca decide ni afirma un amount/currency. Ver
  // functions/src/index.ts. No aplica a SINPE/transferencia, que no tienen
  // captura automática — esos se confirman manualmente (ver markAsPaid).
  const handleCreatePaypalOrder = async (): Promise<string> => {
    if (!id) throw new Error('missing paymentRequestId');
    const functions = getFunctions();
    const createOrderFn = httpsCallable(functions, 'createPaymentRequestPaypalOrder');
    const result = await createOrderFn({ paymentRequestId: id });
    const data = result.data as { orderId: string };
    return data.orderId;
  };

  const handlePaypalApprove = async (orderID: string) => {
    if (!id) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      const functions = getFunctions();
      const capture = httpsCallable(functions, 'capturePaymentRequestPaypalOrder');
      const result = await capture({ orderId: orderID, paymentRequestId: id });
      const data = result.data as { success: boolean; status: string };
      if (!data.success) {
        setCaptureError('No pudimos confirmar tu pago. Si el cargo se realizó, contactá al negocio.');
      }
      // El status='paid' llega solo por el listener de onSnapshot de arriba
      // (lo escribe el backend) — no lo seteamos optimistamente acá.
    } catch (err) {
      console.error('[PublicPaymentView] Error al verificar pago con PayPal:', err);
      setCaptureError('No pudimos confirmar tu pago. Si el cargo se realizó, contactá al negocio.');
    } finally {
      setIsCapturing(false);
    }
  };

  if (loading && id) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-slate-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-medium">Cargando instrucciones de pago...</p>
        </div>
      </div>
    );
  }

  if (!id || error || !request) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-red-100">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">¡Ups! Algo salió mal</h1>
          <p className="text-slate-500 mb-8">{!id ? 'Enlace inválido.' : error}</p>
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
  const methods = request.enabledMethods || [];
  const showSinpe = methods.includes('sinpe') && !!request.sinpePhone;
  // request.bankAccounts puede venir en formato legacy (string libre, una
  // cuenta por línea) para links viejos — normalizeBankAccounts soporta
  // ambos formatos y nunca devuelve algo distinto de un array, así que
  // .map() de abajo no puede volver a crashear con datos legacy.
  const bankAccounts = normalizeBankAccounts(request.bankAccounts, request.sinpeOwner);
  const showBank = methods.includes('bank') && bankAccounts.length > 0;
  // PayPal solo se ofrece si el link está en USD — política de seguridad:
  // sin una fuente de tipo de cambio server-side confiable, calcular una
  // conversión en el navegador es un dato que un atacante podría manipular.
  // El backend (createPaymentRequestPaypalOrder) rechaza igual cualquier
  // moneda que no sea USD; esto solo evita ofrecer un botón que va a fallar.
  const showPaypal = methods.includes('paypal') && request.currency === 'USD';
  const paypalDisabledByCurrency = methods.includes('paypal') && request.currency !== 'USD';
  const businessName = request.businessName || 'Este negocio';

  // Ya pagado o expirado — no mostrar las instrucciones, para no invitar a
  // un doble pago ni a pagar una instrucción muerta.
  if (request.status === 'paid') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-emerald-100">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-6" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">Este pago ya fue completado</h1>
          <p className="text-slate-500">
            {currencySymbol}{request.amount.toLocaleString()} {request.currency} · {request.concept}
          </p>
          <p className="text-xs text-slate-400 mt-4">Si tenés dudas, contactá directamente a {businessName}.</p>
        </div>
      </div>
    );
  }
  if (request.status === 'expired') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-amber-100">
          <Clock className="w-16 h-16 text-amber-500 mx-auto mb-6" />
          <h1 className="text-2xl font-black text-slate-900 mb-2">Esta instrucción ya no está disponible</h1>
          <p className="text-slate-500">Pedile a {businessName} que te comparta instrucciones nuevas.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center py-12 px-4">
      <div className="max-w-[500px] w-full bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] overflow-hidden border border-slate-100">

        {/* Identidad del negocio primero — SmartFlow no es el protagonista */}
        <div className="bg-slate-900 p-8 text-center text-white relative">
          {request.businessLogo ? (
            <img src={request.businessLogo} alt={businessName}
              className="w-16 h-16 rounded-2xl object-cover mx-auto mb-3 border-2 border-white/20" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-3">
              <Building2 className="w-8 h-8 text-white/70" />
            </div>
          )}
          <h1 className="text-xl font-black tracking-tight">{businessName}</h1>
          <p className="text-slate-400 text-xs font-medium mt-1">{request.concept}</p>

          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 text-slate-400">Total a Pagar</p>
            <div className="flex items-center justify-center gap-1">
              <span className="text-2xl font-black opacity-60">{currencySymbol}</span>
              <span className="text-6xl font-black tracking-tighter">
                {request.amount.toLocaleString()}
              </span>
              <span className="text-lg font-black opacity-60 ml-1">{request.currency}</span>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div className="p-8 space-y-8">
          <div className="bg-slate-50/50 rounded-3xl p-5 border border-slate-100 flex items-center justify-between">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</p>
            <span className="text-sm font-black text-slate-900">{request.customer}</span>
          </div>

          {/* Payment Options */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-[2px] flex-1 bg-slate-100" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cómo pagar</span>
              <div className="h-[2px] flex-1 bg-slate-100" />
            </div>

            {!showSinpe && !showBank && !showPaypal && (
              <p className="text-center text-sm text-slate-400 italic py-6">
                {paypalDisabledByCurrency
                  ? `PayPal no está disponible para pagos en ${request.currency}. Contactá a ${businessName} para coordinar otro método.`
                  : `${businessName} todavía no configuró métodos de pago para esta instrucción.`}
              </p>
            )}

            {/* SINPE Móvil — tarjeta propia, separada de las cuentas bancarias */}
            {showSinpe && (
              <div className="bg-white border-2 border-slate-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-wide">SINPE Móvil</span>
                  <div className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Cero Comisiones</div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xl font-black text-slate-900 font-mono tracking-wide">{request.sinpePhone}</p>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">{request.sinpeOwner}</p>
                    {request.sinpeId && (
                      <p className="text-[9px] text-slate-400 font-medium">Cédula: {request.sinpeId}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleCopy(request.sinpePhone || '', 'sinpe')}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                  >
                    {copiedField === 'sinpe' ? (<><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado</>) : (<><Copy className="w-3.5 h-3.5" /> Copiar</>)}
                  </button>
                </div>
              </div>
            )}

            {/* Cada cuenta bancaria es su propia tarjeta, con su propio botón
                de copiar — nunca un solo bloque de texto con varias cuentas */}
            {showBank && bankAccounts.map((acc) => (
              <div key={acc.id} className="bg-white border-2 border-slate-100 rounded-2xl p-4 space-y-3">
                <span className="text-xs font-black text-slate-900 uppercase tracking-wide">{acc.bankName || 'Cuenta bancaria'}</span>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 font-mono tracking-wide break-all">{acc.accountNumber}</p>
                    {acc.owner && <p className="text-xs text-slate-500 font-semibold mt-0.5">{acc.owner}</p>}
                  </div>
                  <button
                    onClick={() => handleCopy(acc.accountNumber, acc.id)}
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                  >
                    {copiedField === acc.id ? (<><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado</>) : (<><Copy className="w-3.5 h-3.5" /> Copiar</>)}
                  </button>
                </div>
              </div>
            ))}

            {(showSinpe || showBank) && (
              <div className="bg-blue-50/60 border border-blue-100 p-4 rounded-2xl text-xs text-blue-800 leading-relaxed font-bold text-center">
                💡 Después de realizar el pago, envía el comprobante por WhatsApp{request.whatsappPhone ? ` al ${request.whatsappPhone}` : ` a ${businessName}`}.
              </div>
            )}

            {/* PayPal — en standby, único método donde SÍ hay un procesador
                de terceros real de por medio */}
            {showPaypal && (
              <>
                {(showSinpe || showBank) && (
                  <div className="flex items-center gap-3 my-6">
                    <div className="h-[1px] flex-1 bg-slate-100" />
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">O pagar con Tarjeta / PayPal</span>
                    <div className="h-[1px] flex-1 bg-slate-100" />
                  </div>
                )}

                {captureError && (
                  <div className="mb-4 p-3.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700 font-medium">
                    {captureError}
                  </div>
                )}

                <PayPalScriptProvider options={{
                  clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test',
                  currency: 'USD',
                  components: "buttons",
                  enableFunding: "card,paylater"
                }}>
                  <div className="space-y-4">
                    <PayPalButtons
                      style={{ layout: 'vertical', color: 'blue', shape: 'pill', label: 'pay' }}
                      disabled={isCapturing}
                      createOrder={async () => {
                        try {
                          return await handleCreatePaypalOrder();
                        } catch (err) {
                          console.error('[PublicPaymentView] Error al crear orden PayPal:', err);
                          setCaptureError('No pudimos iniciar el pago. Intenta de nuevo.');
                          throw err;
                        }
                      }}
                      onApprove={async (data) => {
                        await handlePaypalApprove(data.orderID);
                      }}
                    />
                  </div>
                </PayPalScriptProvider>

                <div className="flex items-center justify-center gap-2 text-slate-400 pt-4">
                  <Lock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Procesamiento Seguro vía PayPal</span>
                </div>
              </>
            )}
          </div>

          {/* Footer Info */}
          <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest mb-1">Referencia</p>
              <p className="text-[10px] font-mono text-slate-400">{request.id}</p>
            </div>
            {showPaypal && (
              <div className="flex items-center gap-3 grayscale opacity-30">
                <Wallet className="w-4 h-4" />
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-8 text-[9px] font-bold text-slate-300 uppercase tracking-widest">
        Gestionado con SmartFlow Hub
      </p>
    </div>
  );
};
