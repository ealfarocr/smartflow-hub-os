import { useState, useEffect, useRef } from 'react';
import { Bell, Calendar, DollarSign, Check, UserPlus } from 'lucide-react';
import {
  collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt?: any;
}

const timeAgo = (ts: any): string => {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'ahora';
    if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
    if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
    return `hace ${Math.floor(s / 86400)} d`;
  } catch { return ''; }
};

export const NotificationBell = () => {
  const { activeMembership } = useAuthStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const tenantId = activeMembership?.tenantId;

  useEffect(() => {
    if (!tenantId) return;
    const q = query(
      collection(db, 'notifications'),
      where('tenantId', '==', tenantId),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => { /* sin permiso / sin datos: silencioso */ });
    return unsub;
  }, [tenantId]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const unread = items.filter((i) => !i.read).length;

  const markAllRead = async () => {
    await Promise.all(
      items.filter((i) => !i.read)
        .map((i) => updateDoc(doc(db, 'notifications', i.id), { read: true }).catch(() => {})),
    );
  };

  const clickItem = (n: Notif) => {
    if (!n.read) updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {});
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const iconFor = (t: string) => {
    if (t === 'venta_cerrada') return <DollarSign className="w-4 h-4 text-emerald-500" />;
    if (t === 'nuevo_lead') return <UserPlus className="w-4 h-4 text-violet-500" />;
    return <Calendar className="w-4 h-4 text-blue-500" />;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { const n = !open; setOpen(n); if (n && unread > 0) markAllRead(); }}
        className="relative p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        title="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-black">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <span className="text-sm font-black text-slate-700 dark:text-slate-200">Notificaciones</span>
            {items.some((i) => !i.read) && (
              <button onClick={markAllRead} className="text-[11px] font-bold text-blue-500 hover:underline flex items-center gap-1">
                <Check className="w-3 h-3" /> Marcar leídas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">Sin notificaciones</div>
            ) : items.map((n) => (
              <button
                key={n.id}
                onClick={() => clickItem(n)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition-colors border-b border-slate-50 dark:border-slate-700/40 ${!n.read ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''}`}
              >
                <div className="mt-0.5 shrink-0">{iconFor(n.type)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{n.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{n.body}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
