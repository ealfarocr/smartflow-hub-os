import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Smartphone, Globe, CheckCircle2, Zap, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadFacebookSdk, launchWhatsappEmbeddedSignup } from '@/utils/facebookSdk';
import { WhatsappIntegrationService } from '@/services/firebase/WhatsappIntegrationService';

interface ConnectionType {
  id: 'api' | 'coexistent';
  title: string;
  subtitle: string;
  desc: string;
  icon: any;
  color: string;
  isRecommended?: boolean;
}

const types: ConnectionType[] = [
  {
    id: 'api',
    title: 'WhatsApp Business API',
    subtitle: 'Oficial / Corporativo',
    desc: 'Conexión multi-agente masiva, plantillas verificadas y soporte oficial de Meta. Requiere verificación de negocio.',
    icon: Globe,
    color: 'blue',
    isRecommended: true
  },
  {
    id: 'coexistent',
    title: 'WhatsApp Business App',
    subtitle: 'Coexistente / QR',
    desc: 'Usa tu aplicación de WhatsApp Business actual. No requiere verificación compleja. Ideal para equipos pequeños.',
    icon: Smartphone,
    color: 'emerald'
  }
];

type FlowStatus = 'idle' | 'loading-sdk' | 'waiting-popup' | 'saving' | 'success' | 'error';

export const WhatsappConnectionModal = ({ onClose, tenantId }: { onClose: () => void; tenantId: string }) => {
  const [selected, setSelected] = useState<'api' | 'coexistent' | null>(null);
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<FlowStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [connectedInfo, setConnectedInfo] = useState<{ displayPhoneNumber: string | null; verifiedName: string | null } | null>(null);
  const activeRunRef = useRef(0);

  const runEmbeddedSignup = useCallback(async (connectionType: 'api' | 'coexistent') => {
    const runId = ++activeRunRef.current;
    const isStale = () => activeRunRef.current !== runId;

    setStatus('loading-sdk');
    setErrorMessage('');
    try {
      await loadFacebookSdk();
      if (isStale()) return;
      setStatus('waiting-popup');
      const result = await launchWhatsappEmbeddedSignup(connectionType);
      if (isStale()) return;
      setStatus('saving');
      const response = await WhatsappIntegrationService.completeEmbeddedSignup({
        code: result.code,
        tenantId,
        wabaId: result.wabaId,
        phoneNumberId: result.phoneNumberId,
        connectionType,
      });
      if (isStale()) return;
      setConnectedInfo({ displayPhoneNumber: response.displayPhoneNumber, verifiedName: response.verifiedName });
      setStatus('success');
    } catch (err: any) {
      if (isStale()) return;
      setErrorMessage(err?.message || 'No se pudo completar la conexión con WhatsApp');
      setStatus('error');
    }
  }, [tenantId]);

  useEffect(() => {
    if (step === 2 && selected) {
      runEmbeddedSignup(selected);
    }
  }, [step, selected, runEmbeddedSignup]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/20 animate-in fade-in duration-300">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white dark:bg-slate-800 w-full max-w-2xl rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
      >
        <div className="p-8 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-emerald-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 dark:text-white text-xl">Conectar WhatsApp</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Configuración de Canal</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 p-4 rounded-2xl flex gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
                    Selecciona el tipo de conexión que deseas utilizar. Si ya tienes mensajes en tu celular, la opción <b>Coexistente</b> te permite mantenerlos.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {types.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelected(t.id)}
                      className={`relative p-6 rounded-[2rem] border-2 transition-all duration-300 text-left group ${
                        selected === t.id
                          ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
                          : 'bg-white border-slate-100 dark:bg-slate-900 dark:border-slate-700 hover:border-emerald-500/30'
                      }`}
                    >
                      {t.isRecommended && (
                        <span className="absolute -top-3 right-6 bg-emerald-500 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">
                          Recomendado
                        </span>
                      )}
                      <div className={`p-3 rounded-2xl mb-4 w-fit transition-colors ${
                        selected === t.id ? 'bg-white/10 text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 group-hover:text-emerald-500'
                      }`}>
                        <t.icon className="w-6 h-6" />
                      </div>
                      <h4 className="font-black text-base mb-1">{t.title}</h4>
                      <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${selected === t.id ? 'opacity-60' : 'text-slate-400'}`}>
                        {t.subtitle}
                      </p>
                      <p className={`text-xs leading-relaxed ${selected === t.id ? 'opacity-80' : 'text-slate-500'}`}>
                        {t.desc}
                      </p>
                    </button>
                  ))}
                </div>

                <button
                  disabled={!selected}
                  onClick={() => setStep(2)}
                  className="w-full bg-[#1877F2] text-white py-5 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-600/20 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:grayscale"
                >
                  Continuar con {selected === 'api' ? 'API Oficial' : 'App Business'}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="text-center space-y-8 py-4"
              >
                <div className="flex justify-center">
                  {status === 'success' ? (
                    <CheckCircle2 className="w-20 h-20 text-emerald-500" />
                  ) : status === 'error' ? (
                    <AlertCircle className="w-20 h-20 text-red-500" />
                  ) : (
                    <div className="relative">
                      <div className="w-32 h-32 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <h4 className="text-xl font-black text-slate-900 dark:text-white">
                    {status === 'loading-sdk' && 'Cargando conexión con Meta'}
                    {status === 'waiting-popup' && 'Esperando autorización'}
                    {status === 'saving' && 'Guardando tu conexión'}
                    {status === 'success' && '¡WhatsApp conectado!'}
                    {status === 'error' && 'No se pudo conectar'}
                  </h4>
                  <p className="text-sm font-medium text-slate-500 max-w-sm mx-auto leading-relaxed">
                    {status === 'loading-sdk' && 'Preparando el inicio de sesión seguro de Meta.'}
                    {status === 'waiting-popup' && 'Completa el proceso en la ventana emergente de Facebook. No la cierres.'}
                    {status === 'saving' && 'Estamos vinculando tu número con tu Hub.'}
                    {status === 'success' && connectedInfo?.displayPhoneNumber && `Número conectado: ${connectedInfo.displayPhoneNumber}${connectedInfo.verifiedName ? ` (${connectedInfo.verifiedName})` : ''}`}
                    {status === 'error' && errorMessage}
                  </p>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    onClick={() => {
                      activeRunRef.current++; // invalida cualquier intento en curso, evita que pise un reintento nuevo
                      setStep(1);
                      setStatus('idle');
                      setErrorMessage('');
                    }}
                    className="flex-1 py-4 text-slate-400 font-black text-xs uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >
                    {status === 'error' ? 'Reintentar' : 'Volver'}
                  </button>
                  <button
                    onClick={onClose}
                    disabled={status === 'loading-sdk' || status === 'waiting-popup' || status === 'saving'}
                    className="flex-1 bg-slate-900 dark:bg-white dark:text-slate-900 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:scale-[1.02] transition-transform disabled:opacity-40"
                  >
                    Cerrar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
