import { useEffect, useRef, useState } from 'react';
import { isToday, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useConversationStore } from '@/stores/conversationStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLeadStore } from '@/stores/leadStore';
import { MessageSquare } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useWhatsappWindow } from '@/hooks/useWhatsappWindow';
import {
  Search, Send, Phone, MoreVertical, UserCircle,
  MessageSquareText, Loader2, CheckCheck, AlertCircle,
  LayoutTemplate, ArrowLeft, Zap, CreditCard,
  Camera, Globe, Sparkles, UserPlus, Package,
  FileText, Download, X, Bot, Settings2, Paperclip, Mic, Play, Trash2,
} from 'lucide-react';
import { VoiceRecorder } from '@/utils/audioRecorder';
import { useTeam } from '@/hooks/useTeam';
import { CreatePaymentLinkModal } from '@/modules/payments/CreatePaymentLinkModal';
import { WhatsappWindowBadge } from './WhatsappWindowBadge';
import { WhatsappWindowBanner, WhatsappWindowHint } from './WhatsappWindowBanner';
import { TemplateSelector, TemplateComponent } from './TemplateSelector';
import { WhatsappUsageStats } from './WhatsappUsageStats';
import { TemplateCreditsModal } from './TemplateCreditsModal';
import { WhatsappTemplate, TenantRecord, WhatsappQuota, CatalogItem } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { TenantService } from '@/services/firebase/TenantService';
import { WhatsappConnectionModal } from './WhatsappConnectionModal';
import { CatalogService } from '@/services/firebase/CatalogService';

// Hoy: solo hora (como antes). Otro día: día + mes + hora, para no confundir
// mensajes de distintos días cuando solo se mostraba la hora.
function formatChatTimestamp(iso: string): string {
  const d = new Date(iso);
  return isToday(d) ? format(d, 'HH:mm') : format(d, "d MMM, HH:mm", { locale: es });
}

export const ConversationsPageView = () => {
  const {
    conversations, activeConversation, activeMessages,
    setActiveConversation, subscribeInbox, subscribeMessages,
    sendMessage, markAsRead, assignAgent, toggleBot, isLoadingInbox
  } = useConversationStore();
  const { activeMembership } = useAuthStore();
  const { whatsappTemplates, templates: quickTemplates, company } = useSettingsStore();
  const { leads } = useLeadStore();
  const [showQuickTemplates, setShowQuickTemplates] = useState(false);
  const { addToast } = useUIStore();

  const [inputText, setInputText]   = useState('');
  const [isSending, setIsSending]   = useState(false);
  const messagesEndRef               = useRef<HTMLDivElement>(null);
  const [searchParams]               = useSearchParams();
  const navigate                     = useNavigate();
  const leadIdQuery                  = searchParams.get('leadId');
  const draftMessageQuery            = searchParams.get('draftMessage');
  const mediaUrlQuery                = searchParams.get('mediaUrl');
  const mediaFilenameQuery           = searchParams.get('mediaFilename');
  const hasLoadedDraft               = useRef(false);
  const [mediaUrl, setMediaUrl]             = useState<string | null>(null);
  const [mediaFilename, setMediaFilename]   = useState<string | null>(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showConnectionModal, setShowConnectionModal]   = useState(false);
  const [tenantData, setTenantData]                     = useState<TenantRecord | null>(null);
  const [search, setSearch]                             = useState('');

  const defaultQuota: WhatsappQuota = {
    dailyTemplatesTotal: 10, dailyTemplatesUsed: 0,
    monthlyTemplatesTotal: 300, monthlyTemplatesUsed: 0,
    maxTemplateSlots: 10, currentTemplateSlots: 0,
  };
  const activeQuota = tenantData?.whatsappQuota || defaultQuota;

  const { team }     = useTeam(activeMembership?.tenantId);
  const windowInfo   = useWhatsappWindow(activeMessages);
  const isWindowExpired = windowInfo.status === 'expired';

  const [showCreditsModal, setShowCreditsModal]   = useState(false);
  const [showPaymentModal, setShowPaymentModal]   = useState(false);
  const [showCatalogDrawer, setShowCatalogDrawer] = useState(false);
  const [catalogItems, setCatalogItems]           = useState<CatalogItem[]>([]);
  const [catalogSearch, setCatalogSearch]         = useState('');
  const [selectedCatalogItemForPayment, setSelectedCatalogItemForPayment] = useState<CatalogItem | null>(null);
  const [isUploading, setIsUploading]             = useState(false);
  const fileInputRef                              = useRef<HTMLInputElement>(null);

  // Grabación de notas de voz estilo WhatsApp (MP3 compatible con WhatsApp)
  const [isRecording, setIsRecording]   = useState(false);
  const [isLocked, setIsLocked]         = useState(false);
  const [slideCancel, setSlideCancel]   = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef                     = useRef<VoiceRecorder | null>(null);
  const recordTimerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStartRef                  = useRef<{ x: number; y: number; time: number } | null>(null);
  const lockedRef                       = useRef(false);

  useEffect(() => {
    if (!activeMembership?.tenantId) return;
    const u1 = CatalogService.subscribeToCatalog(activeMembership.tenantId, setCatalogItems);
    const u2 = TenantService.subscribeToTenant(activeMembership.tenantId, setTenantData);
    return () => { u1(); u2(); };
  }, [activeMembership?.tenantId]);

  useEffect(() => {
    if (leadIdQuery && conversations.length > 0 && !isLoadingInbox) {
      const conv = conversations.find(c => c.leadId === leadIdQuery);
      if (conv && conv.id !== activeConversation) setActiveConversation(conv.id);
    }
  }, [leadIdQuery, conversations, activeConversation, setActiveConversation, isLoadingInbox]);

  const activeChat = conversations.find(c => c.id === activeConversation);

  useEffect(() => {
    if (draftMessageQuery && activeChat && !hasLoadedDraft.current) {
      setInputText(draftMessageQuery);
      if (mediaUrlQuery)    setMediaUrl(mediaUrlQuery);
      if (mediaFilenameQuery) setMediaFilename(mediaFilenameQuery);
      hasLoadedDraft.current = true;
    }
  }, [draftMessageQuery, mediaUrlQuery, mediaFilenameQuery, activeChat]);

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const u = subscribeInbox(activeMembership.tenantId);
      return () => u();
    }
  }, [activeMembership?.tenantId, subscribeInbox]);

  useEffect(() => {
    if (!activeConversation) return;
    const u = subscribeMessages(activeConversation);
    const cur = conversations.find(c => c.id === activeConversation);
    if (cur && cur.unreadCount > 0) markAsRead(activeConversation);
    return () => u();
  }, [activeConversation, subscribeMessages, conversations, markAsRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation || !activeMembership?.tenantId || isSending) return;
    const cleanText = inputText.replace(/[​-‍﻿]/g, '').replace(/\r\n/g, '\n').trim();
    if (!cleanText && !mediaUrl) return;
    setIsSending(true);
    try {
      await sendMessage(activeConversation, cleanText, 'advisor', activeMembership.tenantId, mediaUrl, mediaFilename);
      setInputText(''); setMediaUrl(null); setMediaFilename(null);
    } catch { addToast('Error al enviar mensaje', 'error'); }
    finally { setIsSending(false); }
  };

  const handleSendTemplate = async (template: WhatsappTemplate, components: TemplateComponent[]) => {
    if (!activeConversation || !activeMembership?.tenantId) return;
    await sendMessage(activeConversation, `[Plantilla: ${template.name}]`, 'advisor',
      activeMembership.tenantId, null, null, template.metaTemplateName, template.languageCode, components);
  };

  const uploadToStorage = async (file: File): Promise<string> => {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('@/lib/firebase');
    const path = `chat-attachments/${activeMembership!.tenantId}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  };

  const handleFileUpload = async (file: File) => {
    if (!activeMembership?.tenantId) return;
    // WhatsApp acepta video/documento hasta 16MB. Evita subir algo que luego rechaza.
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|3gp|webm)$/i.test(file.name);
    if (file.size > 16 * 1024 * 1024) {
      addToast(`El archivo pesa ${(file.size / 1048576).toFixed(1)}MB. WhatsApp acepta máximo 16MB${isVideo ? ' para video' : ''}.`, 'error');
      return;
    }
    setIsUploading(true);
    try {
      const url = await uploadToStorage(file);
      setMediaUrl(url);
      setMediaFilename(file.name);
    } catch {
      addToast('Error al subir archivo', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // ── Grabación estilo WhatsApp ──────────────────────────────
  const clearRecordTimer = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
  };

  const startRecording = async () => {
    if (isRecording) return;
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setRecordSeconds(0);
      setSlideCancel(false);
      setIsRecording(true);
      recordTimerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch {
      recordStartRef.current = null;
      addToast('No se pudo acceder al micrófono. Revisá los permisos.', 'error');
    }
  };

  const cancelRecording = () => {
    clearRecordTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    lockedRef.current = false;
    recordStartRef.current = null;
    setIsRecording(false); setIsLocked(false); setSlideCancel(false); setRecordSeconds(0);
  };

  const finishRecordingAndSend = async () => {
    if (!recorderRef.current || !activeConversation || !activeMembership?.tenantId) { cancelRecording(); return; }
    clearRecordTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    lockedRef.current = false;
    setIsRecording(false); setIsLocked(false); setSlideCancel(false);
    setIsUploading(true);
    try {
      const file = await recorder.stop();
      if (file.size < 1200) { addToast('La nota de voz quedó muy corta.', 'info'); return; }
      const url = await uploadToStorage(file);
      await sendMessage(activeConversation, '', 'advisor', activeMembership.tenantId, url, file.name);
    } catch {
      addToast('Error al enviar la nota de voz.', 'error');
    } finally {
      setIsUploading(false);
      setRecordSeconds(0);
    }
  };

  // Gestos: mantener para grabar · deslizar ← cancela · deslizar ↑ bloquea · soltar envía
  const SLIDE_CANCEL_PX = 90;
  const SLIDE_LOCK_PX   = 90;

  const onMicPointerDown = (e: React.PointerEvent) => {
    if (isUploading || isRecording) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    recordStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
    lockedRef.current = false;
    startRecording();
  };

  const onMicPointerMove = (e: React.PointerEvent) => {
    const start = recordStartRef.current;
    if (!start || lockedRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dy < -SLIDE_LOCK_PX) {
      lockedRef.current = true;
      setIsLocked(true); setSlideCancel(false);
      return;
    }
    setSlideCancel(dx < -SLIDE_CANCEL_PX);
  };

  const onMicPointerUp = (e: React.PointerEvent) => {
    if (lockedRef.current) return; // modo bloqueado: sigue grabando hasta tocar enviar/cancelar
    const start = recordStartRef.current;
    recordStartRef.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dur = Date.now() - start.time;
    if (dx < -SLIDE_CANCEL_PX) { cancelRecording(); return; }
    if (dur < 600) { cancelRecording(); addToast('Mantené presionado para grabar 🎤', 'info'); return; }
    finishRecordingAndSend();
  };

  // Liberar el micrófono si el componente se desmonta mientras graba
  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    recorderRef.current?.cancel();
  }, []);

  const getSourceIcon = (source: string) => {
    if (source === 'instagram') return <Camera className="w-3.5 h-3.5 text-pink-500" />;
    if (source === 'facebook')  return <Globe className="w-3.5 h-3.5 text-blue-600" />;
    return (
      <div className="flex items-center gap-1">
        <Phone className="w-3.5 h-3.5 text-emerald-500" />
        <span className="text-[9px] font-black bg-emerald-500/10 text-emerald-600 px-1 rounded uppercase tracking-tighter">WA</span>
      </div>
    );
  };

  const scoreColor = (s: number) => s > 70 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : s > 30 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-red-600 bg-red-50 border-red-200';

  const filteredConvs = conversations.filter(c =>
    c.contactName?.toLowerCase().includes(search.toLowerCase()) ||
    c.lastMessage?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-[calc(100dvh-4rem)] md:h-[calc(100vh-8rem)] flex overflow-hidden rounded-2xl shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">

      {/* ── Sidebar ── */}
      <div className={`${activeChat ? 'hidden md:flex' : 'flex'} w-full md:w-72 flex-col border-r border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900`}>

        {/* Sidebar header */}
        <div className="px-4 pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">WhatsApp Business</span>
            </div>
            <button onClick={() => setShowConnectionModal(true)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Configurar">
              <Settings2 className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar conversación..."
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:border-[#1877F2]/50 transition-colors"
            />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {isLoadingInbox && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-[#1877F2] animate-spin" />
            </div>
          )}
          {filteredConvs.length === 0 && !isLoadingInbox && (
            <div className="px-4 py-10 text-center">
              <MessageSquareText className="w-8 h-8 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Sin conversaciones</p>
            </div>
          )}
          {filteredConvs.map(conv => {
            const unread = (conv.unreadCount || 0) > 0;
            const lead = leads.find(l => l.id === conv.leadId);
            const leadStage = lead?.stage || '';
            const isSeguimiento = leadStage === 'Seguimiento';
            const isAgendado = leadStage === 'Agendado';
            return (
            <div key={conv.id} onClick={() => setActiveConversation(conv.id)}
              className={`px-4 py-3 cursor-pointer border-b border-slate-100 dark:border-slate-700/50 transition-all ${
                activeConversation === conv.id
                  ? 'bg-[#1877F2]/8 border-l-2 border-l-[#1877F2]'
                  : unread
                    ? 'bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 border-l-2 border-l-[#1877F2]'
                    : 'hover:bg-white dark:hover:bg-slate-800 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="relative shrink-0 mt-0.5">
                  <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <UserCircle className="w-5 h-5 text-slate-400" />
                  </div>
                  {conv.aiSentiment && (
                    <span className="absolute -top-1 -right-1 text-[10px] leading-none">
                      {conv.aiSentiment === 'positive' ? '😊' : conv.aiSentiment === 'critical' ? '😡' : '😐'}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-sm truncate max-w-[38%] sm:max-w-[115px] ${
                      unread
                        ? 'font-black text-slate-900 dark:text-white'
                        : 'font-medium text-slate-500 dark:text-slate-400'
                    }`}>{conv.contactName}</span>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {unread && (
                        <span className="min-w-[18px] h-[18px] px-1 bg-[#1877F2] text-white text-[10px] font-black rounded-full flex items-center justify-center">
                          {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        {conv.lastMessageDate ? formatChatTimestamp(conv.lastMessageDate) : ''}
                      </span>
                    </div>
                  </div>
                  <p className={`text-xs truncate leading-relaxed ${
                    unread ? 'text-slate-700 dark:text-slate-200 font-semibold' : 'text-slate-400'
                  }`}>{conv.lastMessage || 'Nuevo chat'}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <WhatsappWindowBadge lastInboundDate={conv.lastInboundDate || (conv.lastMessageSender === 'lead' ? conv.lastMessageDate : null)} />
                      {isSeguimiento && (
                        <span className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                          Seguimiento
                        </span>
                      )}
                      {isAgendado && (
                        <span className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
                          Agendado
                        </span>
                      )}
                    </div>
                    {conv.advisorId && (
                      <span className="text-[9px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full shrink-0">
                        {team.find(m => m.userId === conv.advisorId)?.name?.split(' ')[0] || 'Agente'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className={`${!activeChat ? 'hidden md:flex' : 'flex'} flex-1 flex-col bg-[#f0f2f5] dark:bg-[#0b141a] w-full md:w-auto overflow-hidden`}>
        {activeChat ? (
          <>
            {/* Chat header */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 px-5 py-3 shrink-0 shadow-sm">
              <div className="flex items-center gap-4">
                <button onClick={() => setActiveConversation('')} className="md:hidden text-slate-400 hover:text-slate-600">
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {/* Avatar + info */}
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                    <UserCircle className="w-7 h-7 text-slate-300" />
                  </div>
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white dark:border-slate-800 rounded-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-black text-slate-900 dark:text-white text-sm truncate">{activeChat.contactName}</h2>
                    {getSourceIcon(activeChat.source)}
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {activeChat.source === 'whatsapp' ? activeChat.phoneE164 : activeChat.source === 'instagram' ? 'Instagram DM' : 'Messenger'}
                  </p>
                </div>

                {/* Assign agent — oculto en móvil */}
                <div className="hidden md:flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl shrink-0">
                  <UserPlus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={activeChat.advisorId || ''}
                    onChange={e => assignAgent(activeChat.id, e.target.value)}
                    className="bg-transparent text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none cursor-pointer max-w-[90px]"
                  >
                    <option value="">Sin asignar</option>
                    {team.map(m => (
                      <option key={m.userId} value={m.userId || ''}>{m.name || m.email}</option>
                    ))}
                  </select>
                </div>

                {/* Lead Score — oculto en móvil */}
                <div className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black shrink-0 ${scoreColor(activeChat.aiScore || 0)}`}>
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>{activeChat.aiScore || 0}</span>
                </div>

                {/* Window badge — oculto en móvil */}
                <div className="hidden md:block"><WhatsappWindowBanner windowInfo={windowInfo} /></div>

                {/* Action buttons */}
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 ml-auto md:ml-0">
                  <button
                    onClick={() => {
                      const phone = activeChat.phoneRaw || activeChat.phoneE164;
                      phone ? window.open(`tel:${phone}`, '_self') : addToast('Sin número válido', 'error');
                    }}
                    className="flex flex-col items-center gap-0.5 w-11 h-11 justify-center rounded-xl hover:bg-blue-50 text-[#1877F2] transition-colors" title="Llamar">
                    <Phone className="w-4 h-4" />
                    <span className="text-[9px] font-black hidden sm:block">Llamar</span>
                  </button>
                  <button
                    onClick={async () => {
                      const on = !(activeChat as any).botEnabled;
                      await toggleBot(activeChat.id, on);
                      addToast(on ? '🤖 Bot activado' : '👤 Bot desactivado', 'success');
                    }}
                    className={`flex flex-col items-center gap-0.5 w-11 h-11 justify-center rounded-xl transition-colors ${
                      (activeChat as any).botEnabled ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-slate-100 text-slate-400'
                    }`} title="Bot IA">
                    <Bot className="w-4 h-4" />
                    <span className="text-[9px] font-black hidden sm:block">{(activeChat as any).botEnabled ? 'Bot ON' : 'Bot OFF'}</span>
                  </button>
                  <button
                    onClick={() => addToast(`${activeChat.contactName} · ${activeChat.phoneE164 || 'Sin número'}`, 'info')}
                    className="flex flex-col items-center gap-0.5 w-10 h-11 justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors" title="Opciones">
                    <MoreVertical className="w-4 h-4" />
                    <span className="text-[9px] font-black hidden sm:block">Más</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-3 scrollbar-hide">
              {activeMessages.map(msg => (
                <div key={msg.id} className={`flex flex-col ${msg.sender === 'advisor' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] md:max-w-[72%] rounded-2xl px-3 md:px-4 py-3 shadow-sm ${
                    msg.sender === 'advisor'
                      ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-slate-900 dark:text-white rounded-tr-none'
                      : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-tl-none'
                  }`}>
                    {msg.type === 'audio' ? (
                      msg.mediaUrl ? (
                        <div className="mb-1 w-full">
                          <audio controls preload="metadata" className="w-full rounded-xl" style={{ height: '42px' }}>
                            <source src={msg.mediaUrl} type="audio/ogg; codecs=opus" />
                            <source src={msg.mediaUrl} type="audio/mp4" />
                            <source src={msg.mediaUrl} type="audio/mpeg" />
                            <source src={msg.mediaUrl} />
                          </audio>
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 hover:text-[#1877F2] transition-colors">
                            <Download className="w-3 h-3" /> Descargar audio
                          </a>
                        </div>
                      ) : (
                        <div className="mb-1 flex items-center gap-2 bg-slate-100 dark:bg-slate-700 rounded-xl px-3 py-2 min-w-[160px]">
                          <div className="w-7 h-7 rounded-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center shrink-0">
                            <Mic className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Mensaje de voz</p>
                            <p className="text-[10px] text-slate-400">procesando...</p>
                          </div>
                        </div>
                      )
                    ) : msg.mediaUrl && (msg.type === 'image' || msg.text?.includes('[Imagen Enviada]')) ? (
                      <div className="mb-2 rounded-xl overflow-hidden max-h-56 border border-black/5">
                        <img src={msg.mediaUrl} alt="adjunto" className="w-full h-full object-cover cursor-pointer"
                          onClick={() => window.open(msg.mediaUrl, '_blank')} />
                      </div>
                    ) : msg.mediaUrl && (msg.type === 'video' || /\.(mp4|mov|3gp|webm)($|\?)/i.test(msg.mediaUrl) || msg.text?.includes('[Video Enviado]')) ? (
                      <div className="mb-2 rounded-xl overflow-hidden max-h-64 border border-black/5">
                        <video src={msg.mediaUrl} controls preload="metadata" className="w-full max-h-64 rounded-xl bg-black" />
                      </div>
                    ) : msg.mediaUrl ? (
                      <div className="mb-2 flex items-center gap-2 p-2.5 bg-black/5 dark:bg-white/5 rounded-xl">
                        <FileText className="w-4 h-4 text-red-500 shrink-0" />
                        <p className="text-xs font-bold flex-1 truncate">Documento adjunto</p>
                        <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 bg-white dark:bg-slate-700 rounded-lg shadow-sm">
                          <Download className="w-3.5 h-3.5 text-slate-500" />
                        </a>
                      </div>
                    ) : null}
                    {(msg.type !== 'audio' || !msg.mediaUrl) && (
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.text?.replace(/^\[Imagen Enviada\]\n/, '').replace(/^\[Documento Enviado:.*?\]\n/, '').replace(/^\[Error al enviar.*?\]\n/, '')}
                      </p>
                    )}
                    <div className="flex justify-end items-center gap-1 mt-1.5 opacity-40">
                      <span className="text-[10px]">
                        {msg.timestamp ? formatChatTimestamp(msg.timestamp) : '...'}
                      </span>
                      {msg.sender === 'advisor' && <CheckCheck className="w-3.5 h-3.5 text-[#1877F2]" />}
                    </div>
                  </div>
                  {msg.aiCoachingTip && (
                    <div className="mt-1 flex items-center gap-1.5 px-3 py-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 rounded-full">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400">{msg.aiCoachingTip}</span>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* AI suggested reply */}
            {activeChat.aiSuggestedReply && !isWindowExpired && (
              <div className="px-5 py-3 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 flex items-center gap-3">
                <div className="p-2 bg-[#1877F2]/10 rounded-xl shrink-0">
                  <Sparkles className="w-4 h-4 text-[#1877F2]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-black text-[#1877F2] uppercase tracking-widest mb-0.5">Sugerencia IA</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic truncate">"{activeChat.aiSuggestedReply}"</p>
                </div>
                <button onClick={() => setInputText(activeChat.aiSuggestedReply || '')}
                  className="px-3 py-1.5 bg-[#1877F2] text-white text-[10px] font-black rounded-xl hover:bg-blue-600 transition-colors shrink-0">
                  Usar
                </button>
              </div>
            )}

            {/* Input area */}
            <div className="bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0">
              {isWindowExpired && <WhatsappUsageStats quota={activeQuota} onUpgrade={() => setShowCreditsModal(true)} />}
              <div className="px-4 py-3">
                <WhatsappWindowHint status={windowInfo.status} />

                {/* Action shortcuts */}
                {!isWindowExpired && (
                  <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                    {/* Quick templates dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setShowQuickTemplates(v => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1877F2]/10 hover:bg-[#1877F2]/20 rounded-xl text-xs font-bold text-[#1877F2] transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Plantillas
                      </button>
                      {showQuickTemplates && (
                        <div className="absolute bottom-full left-0 mb-2 w-[calc(100vw-2rem)] sm:w-72 max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-30 overflow-hidden">
                          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Plantillas rápidas</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">Se rellenan con el nombre del cliente automáticamente</p>
                          </div>
                          {[
                            { label: 'Bienvenida', text: quickTemplates.welcomeMessage },
                            { label: 'Envío de Cotización', text: quickTemplates.quoteMessage },
                            { label: 'Recordatorio de Reunión', text: quickTemplates.meetingReminder },
                            { label: 'Seguimiento', text: quickTemplates.followUpMessage },
                          ].map(({ label, text }) => {
                            const filled = text
                              .replace(/\{\{leadName\}\}/g, activeChat?.contactName?.split(' ')[0] || 'Cliente')
                              .replace(/\{\{companyName\}\}/g, company?.tradeName || company?.legalName || 'nuestra empresa')
                              .replace(/\{\{quoteNumber\}\}/g, '—')
                              .replace(/\{\{savings\}\}/g, '—');
                            return (
                              <button
                                key={label}
                                onClick={() => { setInputText(filled); setShowQuickTemplates(false); }}
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors border-b border-slate-100 dark:border-slate-700 last:border-0 group"
                              >
                                <p className="text-[11px] font-bold text-slate-700 dark:text-white group-hover:text-[#1877F2] transition-colors">{label}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">{filled}</p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setShowCatalogDrawer(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 transition-colors">
                      <Package className="w-3.5 h-3.5 text-slate-400" /> Catálogo
                    </button>
                    <button onClick={() => navigate('/cotizaciones')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 transition-colors">
                      <FileText className="w-3.5 h-3.5 text-slate-400" /> Cotizar
                    </button>
                    <button onClick={() => setShowPaymentModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 hover:bg-emerald-100 rounded-xl text-xs font-bold text-emerald-600 transition-colors">
                      <CreditCard className="w-3.5 h-3.5" /> Link de Pago
                    </button>
                  </div>
                )}

                {isWindowExpired ? (
                  <div className="flex flex-col md:flex-row gap-2.5">
                    <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 rounded-2xl text-red-600">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="text-xs font-bold">Ventana libre vencida</p>
                        <p className="text-[10px] opacity-70">Reactivá con una plantilla aprobada.</p>
                      </div>
                    </div>
                    <button onClick={() => setShowTemplateSelector(true)}
                      className="px-6 py-3 bg-[#10B981] hover:bg-emerald-600 text-white font-black text-xs rounded-2xl flex items-center gap-2 transition-colors">
                      <LayoutTemplate className="w-4 h-4" /> Reactivar chat
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSendMessage}>
                    {mediaUrl && (
                      <div className="flex items-center gap-2.5 p-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900 rounded-xl mb-2 relative max-w-sm">
                        {/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(mediaUrl) ? (
                          <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0"><img src={mediaUrl} alt="" className="w-full h-full object-cover" /></div>
                        ) : /\.(ogg|mp3|m4a|aac|wav|opus|audio)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(ogg|mp3|m4a|aac|wav|opus)$/i.test(mediaFilename)) ? (
                          <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0"><Mic className="w-5 h-5 text-emerald-600" /></div>
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0"><FileText className="w-5 h-5 text-red-500" /></div>
                        )}
                        <p className="text-xs font-bold text-slate-700 flex-1 truncate">{mediaFilename || 'Archivo adjunto'}</p>
                        <button type="button" onClick={() => { setMediaUrl(null); setMediaFilename(null); }}
                          className="p-1 text-slate-400 hover:text-red-500 rounded-lg transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.mp4,.mov,.3gp,.ogg,.mp3,.m4a,.aac,.wav,.opus"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
                    />
                    <div className="flex items-center gap-2">
                      {/* Adjuntar (oculto mientras se graba) */}
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                        title="Adjuntar imagen, audio o documento"
                        className={`w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 rounded-xl transition-colors shrink-0 disabled:opacity-40 ${isRecording ? 'hidden' : ''}`}>
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      </button>

                      {/* Área central: texto (reposo) · indicador de grabación */}
                      <div className="flex-1 min-w-0">
                        {isRecording ? (
                          isLocked ? (
                            <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-2xl pl-2 pr-1.5 py-1.5">
                              <button type="button" onClick={cancelRecording} title="Cancelar"
                                className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors shrink-0">
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                              <span className="text-sm font-bold text-rose-600 tabular-nums flex-1">
                                {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
                              </span>
                              <button type="button" onClick={finishRecordingAndSend} title="Enviar nota de voz"
                                className="w-10 h-10 flex items-center justify-center bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all shrink-0">
                                <Send className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className={`flex items-center gap-2 rounded-2xl px-4 py-3 select-none transition-colors ${slideCancel ? 'bg-rose-100 dark:bg-rose-900/40' : 'bg-rose-50 dark:bg-rose-950/30'}`}>
                              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                              <span className="text-sm font-bold text-rose-600 tabular-nums">
                                {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
                              </span>
                              <span className="text-xs font-semibold text-rose-500/80 truncate ml-1">
                                {slideCancel ? 'Suelta para cancelar' : '‹ Desliza para cancelar · ↑ Bloquear'}
                              </span>
                            </div>
                          )
                        ) : (
                          <textarea
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
                            placeholder="Escribí un mensaje..."
                            rows={1}
                            className="w-full bg-slate-50 dark:bg-slate-900 rounded-2xl px-4 py-3 text-sm outline-none resize-none border-2 border-transparent focus:border-[#1877F2]/20 transition-colors"
                          />
                        )}
                      </div>

                      {/* Micrófono persistente — mantener para grabar (oculto en modo bloqueado) */}
                      <button type="button"
                        onPointerDown={onMicPointerDown}
                        onPointerMove={onMicPointerMove}
                        onPointerUp={onMicPointerUp}
                        onPointerCancel={() => cancelRecording()}
                        onContextMenu={e => e.preventDefault()}
                        disabled={isUploading}
                        title="Mantené presionado para grabar"
                        style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
                        className={`flex items-center justify-center rounded-2xl transition-all shrink-0 disabled:opacity-40 ${isLocked ? 'hidden' : ''} ${isRecording ? 'w-12 h-12 bg-rose-500 text-white scale-110 shadow-lg shadow-rose-500/30' : 'w-9 h-9 bg-slate-100 dark:bg-slate-700 text-slate-500 hover:text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/20'}`}>
                        <Mic className="w-4 h-4" />
                      </button>

                      {/* Enviar texto (solo en reposo) */}
                      {!isRecording && (
                        <button type="submit" disabled={(!inputText.trim() && !mediaUrl) || isSending}
                          className="w-11 h-11 flex items-center justify-center bg-[#1877F2] text-white rounded-2xl shadow-lg shadow-[#1877F2]/20 hover:bg-blue-600 disabled:opacity-40 transition-all shrink-0">
                          {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 bg-[#f0f2f5] dark:bg-[#0b141a]">
            <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-sm">
              <MessageSquareText className="w-10 h-10 text-slate-200 dark:text-slate-600" />
            </div>
            <h3 className="text-base font-black text-slate-600 dark:text-slate-400 mb-1">Bandeja de entrada</h3>
            <p className="text-sm text-slate-400">Seleccioná una conversación para comenzar</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showTemplateSelector && activeChat && (
        <TemplateSelector templates={whatsappTemplates} contactName={activeChat.contactName}
          onSend={handleSendTemplate} onClose={() => setShowTemplateSelector(false)} />
      )}
      {showCreditsModal && <TemplateCreditsModal onClose={() => setShowCreditsModal(false)} />}
      {showPaymentModal && activeChat && (
        <CreatePaymentLinkModal
          initialCustomerName={activeChat.contactName} conversationId={activeChat.id}
          onClose={() => { setShowPaymentModal(false); setSelectedCatalogItemForPayment(null); }}
          initialConcept={selectedCatalogItemForPayment?.name || ''}
          initialAmount={selectedCatalogItemForPayment?.rate || ''}
          initialCurrency={selectedCatalogItemForPayment?.currency}
        />
      )}
      {showConnectionModal && activeMembership?.tenantId && (
        <WhatsappConnectionModal
          onClose={() => setShowConnectionModal(false)}
          tenantId={activeMembership.tenantId}
        />
      )}

      {/* Catalog Drawer */}
      {showCatalogDrawer && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white dark:bg-slate-800 shadow-2xl border-l border-slate-200 dark:border-slate-700 flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#1877F2]/10 rounded-xl">
                <Package className="w-4 h-4 text-[#1877F2]" />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 dark:text-white">Catálogo</h3>
                <p className="text-[10px] text-slate-400">Insertá productos en el chat</p>
              </div>
            </div>
            <button onClick={() => setShowCatalogDrawer(false)}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl text-slate-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
              <input type="text" placeholder="Buscar producto..." value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs outline-none focus:border-[#1877F2]/50 transition-colors" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
            {catalogItems
              .filter(i => i.name.toLowerCase().includes(catalogSearch.toLowerCase()) || i.description?.toLowerCase().includes(catalogSearch.toLowerCase()))
              .map(item => {
                const img = item.imageUrl || (item.images?.[0] || null);
                return (
                  <div key={item.id} className="p-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-700 rounded-2xl flex gap-3 hover:border-[#1877F2]/30 transition-all">
                    {img ? (
                      <img src={img} alt={item.name} className="w-14 h-14 rounded-xl object-cover shrink-0 border border-black/5" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-slate-300" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <h4 className="text-xs font-black text-slate-900 dark:text-white truncate">{item.name}</h4>
                        <span className="text-xs font-black text-[#1877F2] shrink-0">
                          {item.currency === 'CRC' ? '₡' : '$'}{item.rate.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">{item.description || 'Sin descripción'}</p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => {
                          setInputText(`🛍️ *${item.name}*\n\n${item.description || ''}\n\n💵 *Precio:* ${item.currency || 'USD'} ${item.rate.toLocaleString()}`);
                          if (img) { setMediaUrl(img); setMediaFilename(`${item.name}.png`); }
                          setShowCatalogDrawer(false);
                          addToast('Producto listo en el editor', 'success');
                        }} className="flex-1 py-1.5 bg-[#1877F2] hover:bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase transition-colors">
                          Insertar
                        </button>
                        <button onClick={() => { setSelectedCatalogItemForPayment(item); setShowPaymentModal(true); }}
                          className="px-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors flex items-center">
                          <CreditCard className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            {catalogItems.length === 0 && (
              <div className="text-center py-10">
                <Package className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-slate-400 mb-2">Catálogo vacío</p>
                <button onClick={() => { setShowCatalogDrawer(false); navigate('/catalogo'); }}
                  className="text-xs font-bold text-[#1877F2] hover:underline">
                  Agregar productos
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
