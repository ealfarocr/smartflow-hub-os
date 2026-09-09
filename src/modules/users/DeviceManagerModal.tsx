import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, type Timestamp } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db } from '@/lib/firebase';
import { useUIStore } from '@/stores/uiStore';
import { X, Smartphone, Pencil, Ban, Loader2 } from 'lucide-react';

interface TrustedDevice {
  id: string;
  label: string;
  status: 'active' | 'revoked';
  registeredAt?: Timestamp;
  lastSeenAt?: Timestamp;
}

// Panel Owner/Admin para ver/renombrar/revocar los dispositivos confiables
// de UN vendedor (LOOP Fase 12). Todas las escrituras pasan por Cloud
// Functions (renameDevice/revokeDevice) — este componente solo lee
// trusted_devices en vivo, nunca escribe el documento directo.
export const DeviceManagerModal = ({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) => {
  const { addToast } = useUIStore();
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'trusted_devices'), where('userId', '==', userId));
    const unsub = onSnapshot(q, (snap) => {
      setDevices(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrustedDevice)));
      setIsLoading(false);
    });
    return () => unsub();
  }, [userId]);

  const formatDate = (ts?: Timestamp) => {
    if (!ts) return '—';
    return ts.toDate().toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const handleRename = async (deviceId: string, currentLabel: string) => {
    const label = window.prompt('Nuevo nombre del dispositivo:', currentLabel);
    if (!label?.trim() || label === currentLabel) return;
    setBusyId(deviceId);
    try {
      await httpsCallable(getFunctions(), 'renameDevice')({ deviceId, label: label.trim() });
      addToast('Dispositivo renombrado', 'success');
    } catch {
      addToast('Error al renombrar el dispositivo', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (deviceId: string, label: string) => {
    if (!window.confirm(`¿Revocar "${label}"?\n\nLa próxima vez que se use, va a pedir enrolarse de nuevo con un link + PIN.`)) return;
    setBusyId(deviceId);
    try {
      await httpsCallable(getFunctions(), 'revokeDevice')({ deviceId });
      addToast('Dispositivo revocado', 'success');
    } catch {
      addToast('Error al revocar el dispositivo', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-black text-slate-900 dark:text-white">Dispositivos de {userName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Todavía no registró ningún dispositivo.</p>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="border-2 border-slate-100 dark:border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Smartphone className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{d.label}</span>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider shrink-0 ${
                    d.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {d.status === 'active' ? 'Activo' : 'Revocado'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mb-3">Última vez: {formatDate(d.lastSeenAt)}</p>
                {d.status === 'active' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRename(d.id, d.label)}
                      disabled={busyId === d.id}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Renombrar
                    </button>
                    <button
                      onClick={() => handleRevoke(d.id, d.label)}
                      disabled={busyId === d.id}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 text-red-600 disabled:opacity-40"
                    >
                      <Ban className="w-3.5 h-3.5" /> Revocar
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
