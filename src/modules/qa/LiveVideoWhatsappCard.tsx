import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Send } from 'lucide-react';
import { ConversationService } from '@/services/firebase/ConversationService';
import {
  WA_QA_CONVERSATION_ID, WA_QA_FILENAME, WA_QA_TENANT_ID, WA_QA_TENANT_LABEL, WA_QA_VIDEO_LABEL, WA_QA_VIDEO_PATH,
  buildWaQaFailure, isWindow24hActive, type WaQaFailure,
} from './liveVideoWhatsapp';

// Envío MANUAL del video QA ya validado a la conversación de prueba. Solo se envía al
// pulsar el botón; reutiliza ConversationService.sendMessage -> sendWhatsappMessage.
type Result = { kind: 'success' } | { kind: 'failed'; failure: WaQaFailure };

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3 text-xs py-0.5"><span className="text-slate-500">{k}</span><span className="font-bold text-slate-800 dark:text-slate-100 text-right break-all">{v}</span></div>
);

export const LiveVideoWhatsappCard = () => {
  const [windowActive, setWindowActive] = useState<boolean | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const checkWindow = useCallback(async () => {
    setCheckError(null);
    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const { db } = await import('@/lib/firebase');
      const snap = await getDoc(doc(db, 'conversations', WA_QA_CONVERSATION_ID));
      const data = snap.data();
      if (!snap.exists() || data?.tenantId !== WA_QA_TENANT_ID) {
        setWindowActive(false);
        setCheckError('La conversación de prueba no existe o no pertenece al tenant QA.');
        return;
      }
      const ts = data.lastInboundDate;
      const ms = ts && typeof ts.toMillis === 'function' ? (ts.toMillis() as number) : null;
      setWindowActive(isWindow24hActive(ms, Date.now()));
    } catch (e) {
      setWindowActive(false);
      setCheckError(`No se pudo leer la ventana: ${(e as Error).message}`);
    }
  }, []);

  useEffect(() => { void checkWindow(); }, [checkWindow]);

  const send = async () => {
    if (sending || windowActive !== true) return;
    setSending(true);
    setResult(null);
    try {
      const { ref, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('@/lib/firebase');
      const mediaUrl = await getDownloadURL(ref(storage, WA_QA_VIDEO_PATH));
      const r = await ConversationService.sendMessage(
        WA_QA_CONVERSATION_ID, '', 'advisor', WA_QA_TENANT_ID, mediaUrl, WA_QA_FILENAME,
      );
      if (r?.success) { setResult({ kind: 'success' }); return; }
      // La función NO lanza cuando Meta rechaza: el detalle estructurado queda en el mensaje fallido.
      let meta = null;
      if (r?.messageId) {
        try {
          const { doc, getDoc } = await import('firebase/firestore');
          const { db } = await import('@/lib/firebase');
          const m = await getDoc(doc(db, 'conversations', WA_QA_CONVERSATION_ID, 'messages', r.messageId));
          meta = m.data()?.metaError ?? null;
        } catch { /* sin detalle estructurado */ }
      }
      setResult({ kind: 'failed', failure: buildWaQaFailure(r?.errorMessage ?? 'Meta rechazó el envío', meta) });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setResult({ kind: 'failed', failure: buildWaQaFailure(err.message, { type: err.code ?? null }) });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800 space-y-2">
      <h2 className="text-sm font-black text-slate-900 dark:text-white">Compatibilidad WhatsApp — video QA</h2>
      <div>
        <Row k="Tenant" v={WA_QA_TENANT_LABEL} />
        <Row k="Ventana 24h" v={windowActive === null ? 'Verificando…' : windowActive ? 'Activa' : 'Inactiva'} />
        <Row k="Video" v={WA_QA_VIDEO_LABEL} />
      </div>
      {windowActive === false && (
        <p className="text-xs text-amber-600">{checkError ?? 'Ventana cerrada: enviá "hola" desde el WhatsApp de prueba y pulsá Actualizar.'}</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={send} disabled={sending || windowActive !== true}
          className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-black disabled:opacity-50 flex items-center justify-center gap-2">
          {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando video QA...</> : <><Send className="w-4 h-4" /> Enviar video QA a WhatsApp</>}
        </button>
        <button type="button" onClick={() => void checkWindow()} disabled={sending} aria-label="Actualizar ventana 24h"
          className="h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-600"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {result?.kind === 'success' && <p className="text-sm font-black text-emerald-600">SUCCESS</p>}
      {result?.kind === 'failed' && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 p-2">
          <p className="text-sm font-black text-rose-600">FAILED</p>
          <Row k="HTTP" v={result.failure.http} />
          <Row k="code" v={result.failure.code} />
          <Row k="subcode" v={result.failure.subcode} />
          <Row k="type" v={result.failure.type} />
          <Row k="message" v={result.failure.message} />
          <Row k="fbtrace_id" v={result.failure.fbtraceId} />
        </div>
      )}
    </div>
  );
};
