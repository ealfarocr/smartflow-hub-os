import { useState, useEffect, useMemo, startTransition, useRef } from 'react';
import {
  collection,
  query,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import {
  Inbox,
  Send,
  Trash2,
  Star,
  Search,
  Archive,
  Reply as ReplyIcon,
  Forward,
  Paperclip,
  Plus,
  X,
  Loader2,
  Clock,
  Mail as MailIcon,
  MoreVertical,
  User,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useUIStore } from '@/stores/uiStore';
import { motion, AnimatePresence } from 'framer-motion';

interface Email {
  id: string;
  from: string;
  to?: string;
  subject: string;
  text: string;
  html?: string;
  timestamp: any;
  isRead: boolean;
  isStarred: boolean;
  folder: string;
  hasAttachments?: boolean;
  type?: string;
  tenantId?: string;
}

export const AdminMailView = () => {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [loading, setLoading] = useState(true);
  const { addToast } = useUIStore();

  const [isReplying, setIsReplying] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [attachment, setAttachment] = useState<{ url: string, name: string } | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeText, setComposeText] = useState('');

  useEffect(() => {
    const q = query(collection(db, 'admin_emails'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emailList = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Email[];
      setEmails(emailList.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)));
      setLoading(false);
    }, () => setLoading(false));

    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => { unsubscribe(); document.removeEventListener('mousedown', handleClickOutside); };
  }, []);

  const filteredEmails = useMemo(() => {
    return emails.filter(email => {
      const folder = email.folder || 'inbox';
      if (activeFolder === 'starred') { if (!email.isStarred) return false; }
      else if (folder !== activeFolder) return false;
      const q = searchQuery.toLowerCase();
      return (email.subject || '').toLowerCase().includes(q) ||
             (email.from || '').toLowerCase().includes(q) ||
             (email.text || '').toLowerCase().includes(q);
    });
  }, [emails, activeFolder, searchQuery]);

  const handleSelectEmail = async (email: Email) => {
    startTransition(() => { setSelectedEmail(email); setIsReplying(false); setShowMoreMenu(false); });
    if (!email.isRead) {
      try { await updateDoc(doc(db, 'admin_emails', email.id), { isRead: true }); } catch {}
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { addToast('Archivo demasiado grande (máx 10MB)', 'error'); return; }
    setUploadingFile(true);
    try {
      const snap = await uploadBytes(ref(storage, `admin_attachments/${Date.now()}_${file.name}`), file, { contentType: file.type || 'application/octet-stream' });
      setAttachment({ url: await getDownloadURL(snap.ref), name: file.name });
      addToast('Archivo listo', 'success');
    } catch { addToast('Error al subir archivo', 'error'); }
    finally { setUploadingFile(false); }
  };

  const submitReply = async () => {
    if (!selectedEmail || !replyText.trim()) return;
    setSending(true);
    try {
      await addDoc(collection(db, 'admin_emails'), {
        from: 'SMARTFLOW HUB OS <soporte@smartflow-suite.com>',
        to: extractEmail(selectedEmail.from),
        subject: `Re: ${selectedEmail.subject}`,
        text: replyText,
        timestamp: serverTimestamp(),
        isRead: true, isStarred: false, folder: 'sent',
        replyTo: selectedEmail.id,
        attachmentUrl: attachment?.url || null,
        attachmentName: attachment?.name || null,
      });
      addToast('Respuesta enviada', 'success');
      setIsReplying(false); setReplyText(''); setAttachment(null);
    } catch { addToast('Error al enviar respuesta', 'error'); }
    finally { setSending(false); }
  };

  const handleCompose = async () => {
    if (!composeTo.trim() || !composeSubject.trim() || !composeText.trim()) {
      addToast('Completa todos los campos', 'error'); return;
    }
    setSending(true);
    try {
      await addDoc(collection(db, 'admin_emails'), {
        from: 'SMARTFLOW HUB OS <master@smartflow-suite.com>',
        to: extractEmail(composeTo), subject: composeSubject, text: composeText,
        timestamp: serverTimestamp(), isRead: true, isStarred: false, folder: 'sent',
        attachmentUrl: attachment?.url || null, attachmentName: attachment?.name || null,
      });
      addToast('Correo enviado', 'success');
      setIsComposing(false); setComposeTo(''); setComposeSubject(''); setComposeText(''); setAttachment(null);
    } catch { addToast('Error al enviar correo', 'error'); }
    finally { setSending(false); }
  };

  const handleForward = (email: Email) => {
    setComposeTo(''); setComposeSubject(`Fwd: ${email.subject}`);
    setComposeText(`\n\n--- Mensaje reenviado ---\nDe: ${email.from}\nAsunto: ${email.subject}\n\n${email.text}`);
    setIsComposing(true);
  };

  const handleUpdateFolder = async (emailId: string, newFolder: string) => {
    try {
      await updateDoc(doc(db, 'admin_emails', emailId), { folder: newFolder });
      if (selectedEmail?.id === emailId) setSelectedEmail(null);
      addToast(`Movido a ${newFolder === 'trash' ? 'Papelera' : newFolder === 'archive' ? 'Archivados' : 'Recibidos'}`, 'success');
    } catch { addToast('Error al mover mensaje', 'error'); }
  };

  const toggleStar = async (email: Email) => {
    try {
      await updateDoc(doc(db, 'admin_emails', email.id), { isStarred: !email.isStarred });
    } catch {}
  };

  const markAsUnread = async (emailId: string) => {
    try {
      await updateDoc(doc(db, 'admin_emails', emailId), { isRead: false });
      setSelectedEmail(null); setShowMoreMenu(false);
      addToast('Marcado como no leído', 'success');
    } catch {}
  };

  const getInitial = (from: string) => (getNameFromEmail(from).charAt(0) || '?').toUpperCase();
  const getNameFromEmail = (fromStr: string) => {
    if (!fromStr) return 'Desconocido';
    const match = fromStr.match(/^([^<]+)/);
    return match ? match[1].trim().replace(/"/g, '') : fromStr.split('@')[0];
  };
  const extractEmail = (str: string) => {
    const match = str?.match(/<([^>]+)>/);
    return match ? match[1].trim() : (str || '').trim();
  };
  const formatDate = (ts: any) => {
    if (!ts) return '';
    const d = ts.toDate?.() || new Date(ts);
    return d.toDateString() === new Date().toDateString() ? format(d, 'HH:mm') : format(d, 'd MMM', { locale: es });
  };

  const unreadCount = emails.filter(e => (e.folder || 'inbox') === 'inbox' && !e.isRead).length;

  const folders = [
    { id: 'inbox',   label: 'Bandeja de Entrada', icon: Inbox,   badge: unreadCount, badgeColor: 'bg-red-500' },
    { id: 'sent',    label: 'Enviados',            icon: Send,    badge: 0, badgeColor: '' },
    { id: 'starred', label: 'Destacados',          icon: Star,    badge: emails.filter(e => e.isStarred).length, badgeColor: 'bg-amber-500' },
    { id: 'trash',   label: 'Papelera',            icon: Trash2,  badge: 0, badgeColor: '' },
    { id: 'archive', label: 'Archivados',          icon: Archive, badge: 0, badgeColor: '' },
  ];

  return (
    <div className="h-[calc(100vh-140px)] flex bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

      {/* ── SIDEBAR ── */}
      <aside className="w-56 border-r border-slate-100 dark:border-slate-800 flex flex-col bg-slate-50 dark:bg-slate-950/30 shrink-0">
        <div className="p-4">
          <button
            onClick={() => setIsComposing(true)}
            className="w-full bg-[#1877F2] hover:bg-[#166fe5] text-white py-3 px-4 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-[#1877F2]/20 transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" /> Redactar
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          {folders.map(({ id, label, icon: Icon, badge, badgeColor }) => (
            <button
              key={id}
              onClick={() => setActiveFolder(id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                activeFolder === id
                  ? 'bg-[#1877F2]/10 text-[#1877F2]'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </div>
              {badge > 0 && (
                <span className={`${badgeColor} text-white text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[9px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-widest text-center">SmartFlow Hub OS</p>
        </div>
      </aside>

      {/* ── LISTA DE CORREOS ── */}
      <div className="w-80 border-r border-slate-100 dark:border-slate-800 flex flex-col shrink-0">
        {/* Search */}
        <div className="p-3 border-b border-slate-100 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar correos..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 rounded-xl text-xs text-slate-700 dark:text-slate-300 outline-none border border-slate-200 dark:border-slate-700 focus:border-[#1877F2] transition-colors placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Email rows */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]/30" />
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-300 dark:text-slate-700">
              <Inbox className="w-10 h-10" />
              <p className="text-[10px] font-black uppercase tracking-widest">Carpeta vacía</p>
            </div>
          ) : (
            filteredEmails.map(email => (
              <button
                key={email.id}
                onClick={() => handleSelectEmail(email)}
                className={`w-full px-4 py-3.5 border-b border-slate-50 dark:border-slate-800/50 flex flex-col gap-1 text-left transition-all group ${
                  selectedEmail?.id === email.id
                    ? 'bg-[#1877F2]/5 border-l-2 border-l-[#1877F2]'
                    : !email.isRead
                    ? 'bg-blue-50/40 dark:bg-blue-950/10 border-l-2 border-l-[#1877F2]/40'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/30 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {!email.isRead && <div className="w-1.5 h-1.5 rounded-full bg-[#1877F2] shrink-0" />}
                    <span className={`text-xs truncate ${!email.isRead ? 'font-black text-slate-900 dark:text-white' : 'font-semibold text-slate-500 dark:text-slate-400'}`}>
                      {getNameFromEmail(email.from)}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0 ml-2">{formatDate(email.timestamp)}</span>
                </div>
                <p className={`text-xs truncate ${!email.isRead ? 'font-bold text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-500'}`}>
                  {email.subject}
                </p>
                <p className="text-[10px] text-slate-400 line-clamp-1 leading-relaxed">
                  {email.text}
                </p>
                {(email.isStarred || email.type === 'support_request') && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {email.isStarred && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />}
                    {email.type === 'support_request' && (
                      <span className="text-[8px] font-black text-[#1877F2] bg-[#1877F2]/10 px-1.5 py-0.5 rounded uppercase tracking-wider">Soporte</span>
                    )}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── PANEL DE LECTURA ── */}
      <main className="flex-1 flex flex-col bg-white dark:bg-slate-900 min-w-0">
        {selectedEmail ? (
          <>
            {/* Email header */}
            <header className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center font-black text-sm shrink-0">
                  {getInitial(selectedEmail.from)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">{selectedEmail.subject}</h2>
                  <p className="text-[10px] text-slate-400 font-medium truncate">{selectedEmail.from}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-4">
                <button
                  onClick={() => toggleStar(selectedEmail)}
                  className={`p-2 rounded-xl transition-all ${selectedEmail.isStarred ? 'text-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'text-slate-300 hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20'}`}
                >
                  <Star className={`w-4 h-4 ${selectedEmail.isStarred ? 'fill-amber-400' : ''}`} />
                </button>
                <button
                  onClick={() => setIsReplying(true)}
                  className="p-2 rounded-xl text-slate-400 hover:text-[#1877F2] hover:bg-[#1877F2]/10 transition-all"
                >
                  <ReplyIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleForward(selectedEmail)}
                  className="p-2 rounded-xl text-slate-400 hover:text-[#1877F2] hover:bg-[#1877F2]/10 transition-all"
                >
                  <Forward className="w-4 h-4" />
                </button>
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className={`p-2 rounded-xl transition-all ${showMoreMenu ? 'bg-slate-100 dark:bg-slate-800 text-[#1877F2]' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  <AnimatePresence>
                    {showMoreMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.97 }}
                        className="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 overflow-hidden z-50 p-1"
                      >
                        <button onClick={() => handleUpdateFolder(selectedEmail.id, 'archive')} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 rounded-xl transition-all">
                          <Archive className="w-3.5 h-3.5" /> Archivar
                        </button>
                        <button onClick={() => markAsUnread(selectedEmail.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-[#1877F2]/5 hover:text-[#1877F2] rounded-xl transition-all">
                          <MailIcon className="w-3.5 h-3.5" /> Marcar no leído
                        </button>
                        <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                        <button onClick={() => handleUpdateFolder(selectedEmail.id, 'trash')} className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all">
                          <Trash2 className="w-3.5 h-3.5" /> Mover a papelera
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </header>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Metadata row */}
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                <Clock className="w-3 h-3" />
                <span>{selectedEmail.timestamp ? format(selectedEmail.timestamp.toDate?.() || new Date(selectedEmail.timestamp), "d 'de' MMMM, yyyy · HH:mm", { locale: es }) : '—'}</span>
              </div>

              {/* Email content card */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 p-6">
                {selectedEmail.html ? (
                  <iframe
                    title="Email Content"
                    srcDoc={`<html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;color:#1e293b;margin:0;padding:0;font-size:14px;}p{margin-bottom:16px;}strong{color:#1877F2;font-weight:700;}</style></head><body>${selectedEmail.html}</body></html>`}
                    className="w-full min-h-[300px] border-0"
                  />
                ) : (
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {selectedEmail.text}
                  </p>
                )}
              </div>

              {/* Reply area */}
              <AnimatePresence>
                {isReplying && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="bg-white dark:bg-slate-800 rounded-2xl border border-[#1877F2]/20 shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-[#1877F2]/5">
                      <div className="flex items-center gap-2">
                        <ReplyIcon className="w-4 h-4 text-[#1877F2]" />
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Respondiendo a <span className="text-[#1877F2]">{extractEmail(selectedEmail.from)}</span></p>
                      </div>
                      <button onClick={() => setIsReplying(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Escribe tu respuesta..."
                      rows={5}
                      autoFocus
                      className="w-full px-5 py-4 bg-transparent text-sm text-slate-800 dark:text-white outline-none resize-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => document.getElementById('reply-file-input')?.click()}
                          disabled={uploadingFile}
                          className="p-2 text-slate-400 hover:text-[#1877F2] hover:bg-[#1877F2]/10 rounded-xl transition-all"
                        >
                          {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                          <input id="reply-file-input" type="file" className="hidden" onChange={handleFileChange} />
                        </button>
                        {attachment && (
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1877F2]/10 rounded-lg">
                            <span className="text-[10px] font-bold text-[#1877F2] truncate max-w-[100px]">{attachment.name}</span>
                            <button onClick={() => setAttachment(null)} className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setIsReplying(false)} className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors">
                          Cancelar
                        </button>
                        <button
                          onClick={submitReply}
                          disabled={sending || !replyText.trim()}
                          className="px-5 py-2 bg-[#1877F2] hover:bg-[#166fe5] text-white text-xs font-black rounded-xl transition-all flex items-center gap-2 disabled:opacity-50 shadow-md shadow-[#1877F2]/20"
                        >
                          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          {sending ? 'Enviando...' : 'Enviar respuesta'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Quick action buttons */}
              {!isReplying && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsReplying(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-[#166fe5] text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-[#1877F2]/20"
                  >
                    <ReplyIcon className="w-4 h-4" /> Responder
                  </button>
                  <button
                    onClick={() => handleForward(selectedEmail)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                  >
                    <Forward className="w-4 h-4" /> Reenviar
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16 space-y-5">
            <div className="w-16 h-16 bg-[#1877F2]/10 rounded-2xl flex items-center justify-center">
              <MailIcon className="w-8 h-8 text-[#1877F2]" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">Inbox Admin</h3>
              <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto leading-relaxed">
                Selecciona un correo para leerlo, o redacta un nuevo mensaje.
              </p>
            </div>
            <button
              onClick={() => setIsComposing(true)}
              className="px-6 py-2.5 bg-[#1877F2] hover:bg-[#166fe5] text-white text-xs font-bold rounded-xl shadow-md shadow-[#1877F2]/20 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Redactar mensaje
            </button>
          </div>
        )}
      </main>

      {/* ── MODAL REDACTAR ── */}
      <AnimatePresence>
        {isComposing && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsComposing(false)}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-[#1877F2]/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[#1877F2]/10 rounded-xl">
                    <Plus className="w-4 h-4 text-[#1877F2]" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-900 dark:text-white">Redactar mensaje</p>
                    <p className="text-[10px] text-slate-400 font-medium">desde master@smartflow-suite.com</p>
                  </div>
                </div>
                <button onClick={() => setIsComposing(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Fields */}
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <User className="w-3 h-3 text-[#1877F2]" /> Destinatario
                    </label>
                    <input
                      type="email"
                      value={composeTo}
                      onChange={e => setComposeTo(e.target.value)}
                      placeholder="cliente@dominio.com"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-[#1877F2] transition-colors placeholder:text-slate-300 dark:placeholder:text-slate-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                      <MailIcon className="w-3 h-3 text-[#1877F2]" /> Asunto
                    </label>
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={e => setComposeSubject(e.target.value)}
                      placeholder="Tema del mensaje"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm text-slate-800 dark:text-white outline-none focus:border-[#1877F2] transition-colors placeholder:text-slate-300 dark:placeholder:text-slate-600"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensaje</label>
                  <textarea
                    value={composeText}
                    onChange={e => setComposeText(e.target.value)}
                    placeholder="Escribe el contenido aquí..."
                    rows={8}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-white outline-none focus:border-[#1877F2] transition-colors resize-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
                  />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => document.getElementById('compose-file-input')?.click()}
                      disabled={uploadingFile}
                      className="p-2 text-slate-400 hover:text-[#1877F2] hover:bg-[#1877F2]/10 rounded-xl transition-all"
                    >
                      {uploadingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      <input id="compose-file-input" type="file" className="hidden" onChange={handleFileChange} />
                    </button>
                    {attachment ? (
                      <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1877F2]/10 rounded-lg">
                        <span className="text-[10px] font-bold text-[#1877F2] truncate max-w-[120px]">{attachment.name}</span>
                        <button onClick={() => setAttachment(null)}><X className="w-3 h-3 text-red-400" /></button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-300 dark:text-slate-600 font-medium">Sin adjuntos</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setIsComposing(false); setComposeTo(''); setComposeSubject(''); setComposeText(''); }}
                      className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleCompose}
                      disabled={sending}
                      className="px-6 py-2.5 bg-[#1877F2] hover:bg-[#166fe5] text-white text-xs font-black rounded-xl flex items-center gap-2 shadow-md shadow-[#1877F2]/20 disabled:opacity-50 transition-all"
                    >
                      {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      {sending ? 'Enviando...' : 'Enviar mensaje'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
