import { useState } from 'react';
import { X, Copy, Check, Link as LinkIcon, MessageSquareText } from 'lucide-react';
import type { VendorAccessData } from './vendorAccessHelpers';
import { ACCESS_STATUS_LABEL, copyToClipboard, buildFullMessage } from './vendorAccessHelpers';

type CopyTarget = 'link' | 'pin' | 'message' | null;

// Reemplaza el alert() nativo (texto no seleccionable de forma práctica, sin
// botones de copiar) por una herramienta operativa real: Owner/Admin ve o
// genera el acceso y desde acá mismo copia enlace/PIN/mensaje completo para
// mandarlo por WhatsApp. El PIN (cuando está presente) solo vive en el
// estado de este componente — nunca se loguea, nunca se persiste en otro
// lado, desaparece al cerrar.
export const VendorAccessModal = ({ data, onClose }: { data: VendorAccessData; onClose: () => void }) => {
  const [copied, setCopied] = useState<CopyTarget>(null);

  const handleCopy = async (target: Exclude<CopyTarget, null>, text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(target);
      setTimeout(() => setCopied((c) => (c === target ? null : c)), 2000);
    }
  };

  const statusLabel = data.accessStatus ? ACCESS_STATUS_LABEL[data.accessStatus] || data.accessStatus : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-black text-slate-900 dark:text-white">
            {data.pin ? 'Acceso generado para' : 'Acceso de'} {data.name}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2.5">
            {data.pin
              ? 'Compartí esto por WhatsApp. El PIN solo se muestra acá — no queda guardado en ningún otro lado.'
              : 'Por seguridad, el PIN actual no se puede mostrar de nuevo — solo se ve una vez, cuando se genera. Si hace falta, usá "Generar nuevo PIN" (esto invalida el anterior).'}
          </p>

          <div className="flex items-start justify-between gap-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Usuario</label>
              <p className="text-sm font-bold text-slate-900 dark:text-white select-all break-all">{data.loginHandle}</p>
            </div>
            {statusLabel && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                {statusLabel}
              </span>
            )}
          </div>

          {data.pin && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">PIN</label>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-2xl font-black tracking-[0.3em] text-slate-900 dark:text-white select-all">{data.pin}</p>
                <button
                  onClick={() => handleCopy('pin', data.pin!)}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
                >
                  {copied === 'pin' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied === 'pin' ? 'Copiado' : 'Copiar PIN'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Enlace de acceso</label>
            <div className="flex items-center gap-2">
              <p className="flex-1 min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300 select-all break-all bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                {data.link}
              </p>
              <button
                onClick={() => handleCopy('link', data.link)}
                className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"
              >
                {copied === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <LinkIcon className="w-3.5 h-3.5" />}
                {copied === 'link' ? 'Copiado' : 'Copiar enlace'}
              </button>
            </div>
          </div>

          <button
            onClick={() => handleCopy('message', buildFullMessage(data))}
            className="w-full flex items-center justify-center gap-2 text-sm font-black py-3.5 rounded-xl text-white shadow-lg active:scale-[0.98] transition-all"
            style={{ backgroundColor: 'var(--primary)' }}
          >
            {copied === 'message' ? <Check className="w-4 h-4" /> : <MessageSquareText className="w-4 h-4" />}
            {copied === 'message' ? 'Mensaje copiado' : 'Copiar mensaje de acceso (para WhatsApp)'}
          </button>
        </div>
      </div>
    </div>
  );
};
