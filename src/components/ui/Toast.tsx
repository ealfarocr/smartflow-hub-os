import { useUIStore, ToastMessage } from '@/stores/uiStore';
import { CheckCircle, AlertCircle, Info, XCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export const ToastContainer = () => {
  const { toasts, removeToast } = useUIStore();

  const getIcon = (type: ToastMessage['type']) => {
    switch (type) {
      case 'success': return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertCircle className="w-5 h-5 text-orange-500" />;
      case 'info': return <Info className="w-5 h-5 text-blue-500" />;
    }
  };

  // En el teléfono los avisos iban abajo a la derecha, ENCIMA del micrófono y del
  // botón de enviar del chat: durante 3 s esos botones no respondían (el QA local
  // lo detectó: el toque del micrófono lo recibía el texto del aviso). Ahora en
  // pantallas chicas salen arriba, bajo la barra superior, y además el aviso deja
  // pasar los toques — solo la X recibe el dedo. En escritorio, como antes.
  return (
    <div data-toasts className="fixed z-[60] top-[4.5rem] inset-x-3 sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg rounded-lg p-4 flex items-start gap-3 sm:min-w-[300px]"
          >
            <div className="flex-shrink-0 mt-0.5">{getIcon(toast.type)}</div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{toast.message}</p>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              aria-label="Cerrar aviso"
              className="flex-shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors pointer-events-auto"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
