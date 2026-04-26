import { useEffect, useRef, useState } from 'react';
import { useConversationStore } from '@/stores/conversationStore';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSearchParams } from 'react-router-dom';
import { useWhatsappWindow } from '@/hooks/useWhatsappWindow';
import {
  Search, Send, Phone, MoreVertical, UserCircle,
  MessageSquareText, Loader2, CheckCheck, AlertCircle,
  Clock, FileText, X, LayoutTemplate
} from 'lucide-react';
import { WhatsappWindowBadge } from './WhatsappWindowBadge';
import { WhatsappWindowBanner, WhatsappWindowHint } from './WhatsappWindowBanner';
import { TemplateSelector, TemplateComponent } from './TemplateSelector';
import { WhatsappTemplate } from '@/types';

export const ConversationsPageView = () => {
  const {
    conversations,
    activeConversation,
    activeMessages,
    setActiveConversation,
    subscribeInbox,
    subscribeMessages,
    sendMessage,
    markAsRead,
    seedConversations,
    isLoadingInbox,
    isLoadingMessages,
    errorInbox,
    errorMessages
  } = useConversationStore();
  const { activeMembership, user } = useAuthStore();
  const { whatsappTemplates } = useSettingsStore();
  const [inputText, setInputText] = useState('');
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const leadIdQuery = searchParams.get('leadId');
  const draftMessageQuery = searchParams.get('draftMessage');
  const mediaUrlQuery = searchParams.get('mediaUrl');
  const mediaFilenameQuery = searchParams.get('mediaFilename');
  const hasLoadedDraft = useRef(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaFilename, setMediaFilename] = useState<string | null>(null);
  const [leadNotFoundWarning, setLeadNotFoundWarning] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);

  // ─── Ventana WhatsApp 24h ──────────────────────────────────────────────────
  const windowInfo = useWhatsappWindow(activeMessages);
  const isWindowExpired = windowInfo.status === 'expired';

  // ─── Lead query redirect ───────────────────────────────────────────────────
  useEffect(() => {
    if (leadIdQuery && conversations.length > 0 && !isLoadingInbox) {
      const conv = conversations.find(c => c.leadId === leadIdQuery);
      if (conv) {
        if (conv.id !== activeConversation) {
          setActiveConversation(conv.id);
        }
        setLeadNotFoundWarning(false);
      } else {
        setLeadNotFoundWarning(true);
      }
    }
  }, [leadIdQuery, conversations, activeConversation, setActiveConversation, isLoadingInbox]);

  const activeChat = conversations.find(c => c.id === activeConversation);

  useEffect(() => {
    if (draftMessageQuery && activeChat && !hasLoadedDraft.current) {
      setInputText(draftMessageQuery);
      if (mediaUrlQuery) setMediaUrl(mediaUrlQuery);
      if (mediaFilenameQuery) setMediaFilename(mediaFilenameQuery);
      hasLoadedDraft.current = true;
    }
  }, [draftMessageQuery, mediaUrlQuery, mediaFilenameQuery, activeChat]);

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribe = subscribeInbox(activeMembership.tenantId);
      return () => unsubscribe();
    }
  }, [activeMembership?.tenantId, subscribeInbox]);

  useEffect(() => {
    if (activeConversation) {
      const unsubscribe = subscribeMessages(activeConversation);
      const activeChat = conversations.find(c => c.id === activeConversation);
      if (activeChat && activeChat.unreadCount > 0) {
        markAsRead(activeConversation);
      }
      return () => unsubscribe();
    }
  }, [activeConversation, subscribeMessages, conversations.find(c => c.id === activeConversation)?.unreadCount]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeMessages]);

  // ─── Send free message ─────────────────────────────────────────────────────
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation || !activeMembership?.tenantId || isSending) return;

    const cleanText = inputText
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r\n/g, '\n')
      .trim();

    if (!cleanText && !mediaUrl) return;

    setIsSending(true);
    setSendError(null);
    try {
      await sendMessage(activeConversation, cleanText, 'advisor', activeMembership.tenantId, mediaUrl, mediaFilename);
      setInputText('');
      setMediaUrl(null);
      setMediaFilename(null);
    } catch (error: any) {
      console.error('Error enviando mensaje:', error);
      const code = error?.code || '';
      const msg = error?.message || '';

      if (code.includes('failed-precondition') || msg.toLowerCase().includes('index')) {
        setSendError('Error de infraestructura: Falta un índice de Firestore. Contacta al administrador.');
      } else if (code.includes('deadline-exceeded') || msg.includes('24 horas')) {
        setSendError('Ventana de 24h vencida. Usa una plantilla aprobada.');
      } else if (code.includes('unauthenticated')) {
        setSendError('Tu sesión expiró. Recarga la página e inicia sesión de nuevo.');
      } else if (code.includes('permission-denied')) {
        setSendError('No tienes permisos para enviar mensajes en este tenant.');
      } else if (code.includes('not-found')) {
        setSendError('Conversación no encontrada. Es posible que haya sido eliminada.');
      } else if (msg) {
        setSendError(msg);
      } else {
        setSendError('Error interno al enviar el mensaje. Revisa la consola para más detalles.');
      }
    } finally {
      setIsSending(false);
    }
  };

  // ─── Send template ─────────────────────────────────────────────────────────
  const handleSendTemplate = async (template: WhatsappTemplate, components: TemplateComponent[]) => {
    if (!activeConversation || !activeMembership?.tenantId) return;
    await sendMessage(
      activeConversation,
      `[Plantilla: ${template.name}]`,
      'advisor',
      activeMembership.tenantId,
      null,
      null,
      template.metaTemplateName,
      template.languageCode,
      components
    );
  };

  const handleSeed = async () => {
    if (!activeMembership?.tenantId || !user?.id) return;
    setIsSeeding(true);
    try {
      await seedConversations(activeMembership.tenantId, user.id);
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex overflow-hidden">

      {/* ─── Sidebar de Chats ─────────────────────────────────────────────────── */}
      <div className="w-80 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50 dark:bg-slate-800/50">
        <div className="p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar conversación..."
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto relative">
          {isLoadingInbox && (
            <div className="absolute inset-0 bg-white/50 dark:bg-slate-900/50 flex items-center justify-center z-10">
              <Loader2 className="w-6 h-6 text-primary-500 animate-spin" />
            </div>
          )}
          {conversations.length === 0 && !isLoadingInbox && (
            <div className="p-8 text-center">
              <p className="text-slate-500 text-sm italic mb-4">No hay conversaciones activas</p>
              <button
                onClick={handleSeed}
                disabled={isSeeding}
                className="text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 dark:bg-primary-900/20 px-3 py-1.5 rounded-full transition-colors flex items-center justify-center mx-auto"
              >
                {isSeeding ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <MessageSquareText className="w-3 h-3 mr-2" />}
                Cargar Chats de Prueba
              </button>
            </div>
          )}
          {errorInbox && (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border-b border-red-100 dark:border-red-800">
              <div className="flex items-center text-red-600 dark:text-red-400 text-xs font-medium">
                <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
                <span>Error: {errorInbox.includes('index') ? 'Índice faltante' : errorInbox}</span>
              </div>
            </div>
          )}
          {conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={`p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border-b border-slate-100 dark:border-slate-700/50 ${
                activeConversation === conv.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
              }`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-medium text-slate-900 dark:text-slate-100 truncate mr-2">{conv.contactName}</span>
                <div className="flex flex-col items-end shrink-0 gap-1">
                  <span className="text-xs text-slate-500">
                    {conv.lastMessageDate ? new Date(conv.lastMessageDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="bg-primary-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 truncate flex items-center mb-1.5">
                {conv.lastMessageSender === 'advisor' && <span className="mr-1 text-[10px] opacity-50">Tú:</span>}
                {conv.lastMessage || 'Nuevo chat'}
              </p>
              {/* ← Badge ventana WhatsApp */}
              <WhatsappWindowBadge
                lastInboundDate={
                  // Prefer dedicated lastInboundDate; fall back to lastMessageDate if last sender was lead
                  conv.lastInboundDate ||
                  (conv.lastMessageSender === 'lead' ? conv.lastMessageDate : null)
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Panel Principal ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a]">
        {activeChat ? (
          <>
            {/* Header del Chat */}
            <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <UserCircle className="h-10 w-10 text-slate-400 mr-3 shrink-0" />
                  <div>
                    <h2 className="font-semibold text-slate-800 dark:text-slate-100">{activeChat.contactName}</h2>
                    <p className="text-xs text-slate-500">{activeChat.phoneE164 || activeChat.phoneRaw}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* ← Banner ventana WhatsApp */}
                  {!isLoadingMessages && (
                    <WhatsappWindowBanner windowInfo={windowInfo} />
                  )}
                  <button className="text-slate-500 hover:text-primary-600 transition-colors">
                    <Phone className="h-5 w-5" />
                  </button>
                  <button className="text-slate-500 hover:text-primary-600 transition-colors">
                    <MoreVertical className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 relative">
              {errorMessages && (
                <div className="absolute inset-x-0 top-0 p-4 bg-red-50/90 dark:bg-red-900/40 backdrop-blur-sm z-20 flex items-center justify-center border-b border-red-100 dark:border-red-800">
                  <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                  <p className="text-xs text-red-700 dark:text-red-300 font-medium">
                    {errorMessages.includes('index') ? 'Error al cargar mensajes: Falta índice compuesto.' : errorMessages}
                  </p>
                </div>
              )}
              {isLoadingMessages && (
                <div className="absolute inset-0 bg-[#efeae2]/50 dark:bg-[#0b141a]/50 flex items-center justify-center z-10">
                  <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
                </div>
              )}
              {activeMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === 'advisor' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-lg p-3 relative ${
                    msg.sender === 'advisor'
                      ? 'bg-[#d9fdd3] dark:bg-[#005c4b] text-slate-900 dark:text-slate-100 rounded-tr-none shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-tl-none shadow-sm'
                  }`}>
                    <p className="text-sm">{msg.text}</p>
                    {msg.status === 'failed' && (
                      <p className="text-[10px] text-red-500 mt-1 flex items-center">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        {msg.errorMessage || 'Error de envío'}
                      </p>
                    )}
                    <div className="flex justify-end items-center space-x-1 mt-1">
                      <span className="text-[10px] text-slate-500">
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                      </span>
                      {msg.sender === 'advisor' && (
                        <span className="text-slate-400">
                          {msg.status === 'sent' && <CheckCheck className="w-3 h-3 text-primary-500" />}
                          {(msg.status === 'pending' || !msg.status) && <Clock className="w-3 h-3" />}
                          {msg.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-500" />}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input / Área de envío */}
            <div className="bg-white dark:bg-slate-800 p-4 shrink-0 border-t border-slate-200 dark:border-slate-700">

              {/* Hint de ventana activa */}
              {!isLoadingMessages && (
                <WhatsappWindowHint status={windowInfo.status} />
              )}

              {/* Error de envío */}
              {sendError && (
                <div className="mb-2 p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded border border-red-100 dark:border-red-800 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2 min-w-4" />
                  <span className="truncate">{sendError}</span>
                </div>
              )}

              {/* Adjunto PDF */}
              {mediaUrl && (
                <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
                  <div className="flex items-center text-blue-700 dark:text-blue-300">
                    <FileText className="w-5 h-5 mr-3" />
                    <div>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{mediaFilename || 'Documento adjunto'}</p>
                      <p className="text-xs">PDF listo para enviar</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setMediaUrl(null); setMediaFilename(null); }}
                    className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-full transition-colors text-blue-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {isWindowExpired ? (
                /* ─── Ventana vencida: mostrar advertencia + botón plantilla ── */
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/40 rounded-xl">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <p className="text-xs text-red-700 dark:text-red-400">
                      La ventana de 24h ha vencido. No puedes enviar mensajes libres hasta que el cliente escriba primero.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowTemplateSelector(true)}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm"
                  >
                    <LayoutTemplate className="w-4 h-4" />
                    Usar plantilla aprobada
                  </button>
                </div>
              ) : (
                /* ─── Ventana activa: input normal ──────────────────────────── */
                <form onSubmit={handleSendMessage} className="flex items-center space-x-2">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage(e);
                      }
                    }}
                    disabled={isSending}
                    placeholder={isSending ? 'Enviando...' : 'Escribe un mensaje...'}
                    className="flex-1 bg-slate-100 dark:bg-slate-900 border-none rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/50 disabled:opacity-50 resize-none"
                    rows={inputText.split('\n').length > 1 ? Math.min(inputText.split('\n').length, 5) : 1}
                  />
                  <button
                    type="submit"
                    disabled={(!inputText.trim() && !mediaUrl) || isSending}
                    className="bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 text-white p-3 rounded-lg transition-colors flex items-center justify-center min-w-[3rem]"
                  >
                    {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col text-slate-500 text-center p-6">
            {leadNotFoundWarning ? (
              <>
                <AlertCircle className="h-16 w-16 mb-4 text-orange-400" />
                <p className="font-semibold text-lg text-slate-800 dark:text-slate-200">Este lead aún no tiene conversación de WhatsApp asociada.</p>
                <p className="text-sm mt-2 max-w-sm">No se pudieron precargar los mensajes. El cliente debe enviar un mensaje a la plataforma o necesitamos iniciar la sesión para este LeadId.</p>
              </>
            ) : (
              <>
                <MessageSquareText className="h-16 w-16 mb-4 opacity-50" />
                <p>Selecciona una conversación para comenzar</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Template Selector Modal ──────────────────────────────────────────── */}
      {showTemplateSelector && activeChat && (
        <TemplateSelector
          templates={whatsappTemplates}
          contactName={activeChat.contactName}
          onSend={handleSendTemplate}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}
    </div>
  );
};
