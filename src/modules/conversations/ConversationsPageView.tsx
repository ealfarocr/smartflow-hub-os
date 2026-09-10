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
  MessageSquareText, Loader2, CheckCheck, Check, AlertCircle,
  LayoutTemplate, ArrowLeft, Zap, CreditCard,
  Camera, Globe, Sparkles, UserPlus, Package,
  FileText, Download, X, Bot, Settings2, Paperclip, Mic, Play, Trash2, Image, RotateCcw,
} from 'lucide-react';
import { VoiceRecorder } from '@/utils/audioRecorder';
import { useTeam } from '@/hooks/useTeam';
import { CreatePaymentLinkModal } from '@/modules/payments/CreatePaymentLinkModal';
import { WhatsappWindowBadge } from './WhatsappWindowBadge';
import { WhatsappWindowBanner, WhatsappWindowHint } from './WhatsappWindowBanner';
import { TemplateSelector, TemplateComponent } from './TemplateSelector';
import { WhatsappUsageStats } from './WhatsappUsageStats';
import { TemplateCreditsModal } from './TemplateCreditsModal';
import { WhatsappTemplate, TenantRecord, WhatsappQuota, CatalogItem, Message } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import { TenantService } from '@/services/firebase/TenantService';
import { WhatsappConnectionModal } from './WhatsappConnectionModal';
import { CatalogService } from '@/services/firebase/CatalogService';
import { sellerErrorMessage, isSessionDeadError, type SellerErrorLayer } from '@/utils/sellerErrors';
import { isAdminRole } from '@/utils/permissions';
import { AudioMessagePlayer } from './components/AudioMessagePlayer';

// Hoy: solo hora (como antes). Otro día: día + mes + hora, para no confundir
// mensajes de distintos días cuando solo se mostraba la hora.
function formatChatTimestamp(iso: string): string {
  const d = new Date(iso);
  return isToday(d) ? format(d, 'HH:mm') : format(d, "d MMM, HH:mm", { locale: es });
}

// Selector "Asignar agente" — mostrar el nombre real de todo el equipo
// (incluye prepared/draft/pending, útil para ver quién falta activar) pero
// bloquear la asignación manual a cualquiera que no sea 'active': asignar
// una conversación viva a alguien que todavía no puede loguearse no tiene
// sentido operativo. Mostrar su nombre/estado sí sirve para que el
// Admin/Owner vea de un vistazo quién está preparado.
const TEAM_STATUS_LABEL: Record<string, string> = {
  prepared: 'Preparado',
  draft: 'Borrador',
  pending: 'Invitado',
  suspended: 'Suspendido',
};

export const ConversationsPageView = () => {
  const {
    conversations, activeConversation, activeMessages,
    setActiveConversation, subscribeInbox, subscribeMessages,
    sendMessage, markAsRead, assignAgent, claimConversation, toggleBot, isLoadingInbox
  } = useConversationStore();
  const { activeMembership } = useAuthStore();
  const { whatsappTemplates, templates: quickTemplates, company } = useSettingsStore();
  const { leads } = useLeadStore();
  const [showQuickTemplates, setShowQuickTemplates] = useState(false);
  const [showQuotaPanel, setShowQuotaPanel] = useState(false);
  const [showToolsPanel, setShowToolsPanel] = useState(false);
  const [showCameraChoice, setShowCameraChoice] = useState(false);
  const { addToast } = useUIStore();

  const [inputText, setInputText]   = useState('');
  const [isSending, setIsSending]   = useState(false);
  const [retryingMsgId, setRetryingMsgId] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
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
  // Adjuntos múltiples del composer (Adjuntar/Galería/Foto/Video): preview local instantánea
  // (URL.createObjectURL, antes de que termine de subir) + estado por ítem, para que la UI
  // responda al toque de inmediato en vez de esperar la subida completa. No reemplaza el
  // mediaUrl/mediaFilename "legacy" (nota de voz, catálogo, borrador por query param), que
  // sigue funcionando exactamente igual.
  type PendingMediaKind = 'image' | 'video' | 'audio' | 'document';
  type PendingMediaItem = {
    id: string;
    localPreviewUrl: string;
    filename: string;
    kind: PendingMediaKind;
    status: 'uploading' | 'ready' | 'error';
    remoteUrl: string | null;
  };
  const [pendingMedia, setPendingMedia] = useState<PendingMediaItem[]>([]);
  const pendingMediaRef = useRef<PendingMediaItem[]>([]);
  useEffect(() => { pendingMediaRef.current = pendingMedia; }, [pendingMedia]);
  const fileInputRef                              = useRef<HTMLInputElement>(null);
  const cameraInputRef                            = useRef<HTMLInputElement>(null);
  const cameraVideoInputRef                       = useRef<HTMLInputElement>(null);
  const galleryInputRef                           = useRef<HTMLInputElement>(null);

  // Grabación de notas de voz por TAP (no mantener presionado, estilo WhatsApp
  // actual): un toque inicia, el mismo botón cambia de Mic a Enviar mientras
  // graba — un segundo tap detiene Y envía directo, sin paso de preview
  // intermedio (el flujo ya es estable, no hace falta ese paso extra).
  const [isRecording, setIsRecording]   = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef                     = useRef<VoiceRecorder | null>(null);
  const recordTimerRef                  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Evita que un segundo tap (querer "detener") dispare start() otra vez si el
  // primer tap todavía está esperando el permiso de micrófono (diálogo nativo).
  const isStartingRecorderRef           = useRef(false);
  const cancelPendingStartRef           = useRef(false);

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

  // Modo Libre — reclamo atómico de una conversación sin asesor. La decisión
  // real (quién gana si dos hacen clic casi al mismo tiempo) la resuelve el
  // backend con una transacción (claimConversation); acá solo mostramos el
  // resultado. 'already-exists' = alguien más la tomó primero.
  // Asignación manual (dropdown "Asignar agente") — guardia extra además del
  // `disabled` nativo del <option>: si target es '' (Sin asignar) siempre se
  // permite; si no, el miembro elegido debe estar 'active'. El <option>
  // disabled ya bloquea esto en el uso normal del navegador, esta es una
  // segunda capa defensiva por si el value llega por otro camino.
  const handleAssignAgent = (conversationId: string, targetId: string) => {
    if (targetId === '') { assignAgent(conversationId, targetId); return; }
    const target = team.find(m => (m.userId || m.id) === targetId);
    if (target && target.status !== 'active') {
      addToast('Solo se puede asignar a miembros con acceso activo.', 'warning');
      return;
    }
    assignAgent(conversationId, targetId);
  };

  const handleClaim = async (conversationId: string) => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      await claimConversation(conversationId);
      addToast('¡Conversación tomada! Ya es tuya.', 'success');
    } catch (error) {
      const code = (error as { code?: string; message?: string } | null)?.code;
      const message = (error as { code?: string; message?: string } | null)?.message;
      if (code === 'functions/already-exists') {
        addToast('Esta conversación ya fue tomada por otro asesor.', 'warning');
      } else if (code === 'functions/permission-denied') {
        addToast(message || 'No estás habilitado para tomar conversaciones.', 'error');
      } else if (code === 'functions/failed-precondition') {
        addToast(message || 'Tenés que estar en estado "Trabajando" para tomar una conversación.', 'warning');
      } else {
        addToast('Error al tomar la conversación.', 'error');
      }
    } finally {
      setIsClaiming(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation || !activeMembership?.tenantId || isSending) return;
    const cleanText = inputText.replace(/[​-‍﻿]/g, '').replace(/\r\n/g, '\n').trim();
    const hasPending = pendingMedia.length > 0;
    if (!cleanText && !mediaUrl && !hasPending) return;
    if (hasPending && pendingMedia.some(m => m.status === 'uploading')) return; // el botón ya queda disabled en este caso
    const readyItems = hasPending ? pendingMedia.filter(m => m.status === 'ready' && m.remoteUrl) : [];
    if (hasPending && readyItems.length === 0 && !cleanText) {
      addToast('Todos los adjuntos tienen error. Quitalos o reintentá.', 'error');
      return;
    }
    setIsSending(true);
    try {
      if (hasPending) {
        // Cada imagen/video pendiente se envía como su propio mensaje (mismo sendMessage de
        // siempre, uno por adjunto) — el texto escrito queda como caption del primero.
        let caption = cleanText;
        for (const item of readyItems) {
          const isVideoItem = item.kind === 'video';
          if (isVideoItem) {
            debugAttach('VIDEO_SEND_REQUEST', {
              conversationId: activeConversation, tenantId: activeMembership.tenantId,
              mediaUrl: item.remoteUrl, mediaFilename: item.filename, caption,
            });
          }
          // sendWhatsappMessage (Cloud Function) NO tira excepción cuando Meta
          // rechaza el mensaje — atrapa el error de Meta internamente, guarda el
          // mensaje en Firestore con status:'failed', y devuelve { success:false,
          // status, errorMessage } con HTTP 200. Sin leer este valor de retorno
          // (antes se descartaba, ver conversationStore.ts) un rechazo de Meta es
          // indistinguible de un envío exitoso — exactamente el bug reportado de
          // "video no envía" sin ningún error visible.
          const result = await sendMessage(activeConversation, caption, 'advisor', activeMembership.tenantId, item.remoteUrl, item.filename);
          if (isVideoItem) {
            debugAttach('VIDEO_SEND_RESPONSE', result);
            if (result && result.success === false) {
              debugAttach('VIDEO_SEND_ERROR', { status: result.status, message: result.errorMessage });
              addToast(`WhatsApp rechazó el video: ${result.errorMessage || 'error desconocido'}`, 'error');
            }
          }
          caption = '';
        }
        pendingMedia.forEach(m => URL.revokeObjectURL(m.localPreviewUrl));
        setPendingMedia([]);
        if (!readyItems.length && cleanText) {
          // No había adjuntos listos (todos con error) pero sí texto: igual se envía el texto solo.
          await sendMessage(activeConversation, cleanText, 'advisor', activeMembership.tenantId, null, null);
        }
      } else {
        await sendMessage(activeConversation, cleanText, 'advisor', activeMembership.tenantId, mediaUrl, mediaFilename);
      }
      setInputText(''); setMediaUrl(null); setMediaFilename(null);
    } catch (err) { handleSellerError('send', err); }
    finally { setIsSending(false); }
  };

  // LOOP nocturno USADITOS, Fase 5: reintento manual y explícito de un
  // mensaje con status:'failed' — nunca automático (un error de Meta no debe
  // reintentar solo). Crea un mensaje NUEVO con el mismo texto/adjunto; el
  // bubble fallido original queda tal cual, como registro de que ese intento
  // específico no llegó — no se sobreescribe ni se duplica el historial.
  const handleRetryFailedMessage = async (msg: Message) => {
    if (!activeConversation || !activeMembership?.tenantId || retryingMsgId) return;
    setRetryingMsgId(msg.id);
    try {
      const originalText = (msg.text || '')
        .replace(/^\[Imagen Enviada\]\n/, '')
        .replace(/^\[Video Enviado\]\n/, '')
        .replace(/^\[Audio Enviado\]\n/, '')
        .replace(/^\[Documento Enviado:.*?\]\n/, '')
        .replace(/^\[Error al enviar.*?\]\n/, '');
      await sendMessage(activeConversation, originalText, 'advisor', activeMembership.tenantId, msg.mediaUrl || null, null);
    } catch {
      addToast('Error al reintentar el mensaje', 'error');
    } finally {
      setRetryingMsgId(null);
    }
  };

  const handleSendTemplate = async (template: WhatsappTemplate, components: TemplateComponent[]) => {
    if (!activeConversation || !activeMembership?.tenantId) return;
    await sendMessage(activeConversation, `[Plantilla: ${template.name}]`, 'advisor',
      activeMembership.tenantId, null, null, template.metaTemplateName, template.languageCode, components);
  };

  // Owner/Admin abren el modulo de Cotizaciones; el asesor trabaja desde el chat.
  const canOpenQuotesModule = isAdminRole(activeMembership?.role);

  // Un solo lugar donde se traduce un error tecnico a algo accionable para quien
  // esta atendiendo a un cliente. El detalle completo sigue yendo a consola para
  // Admin/Auditor; lo que cambia es lo que ve el vendedor.
  //
  // Caso importante: si un Owner/Admin regenera el codigo de acceso de esta
  // persona, se revocan sus refresh tokens y el telefono queda "abierto" pero sin
  // poder renovar el token — a partir de ahi fallan a la vez el texto, los
  // adjuntos y las notas de voz, cada uno con su propio mensaje generico. Cuando
  // se detecta ese caso se cierra la sesion y se la manda a entrar de nuevo con
  // una sola frase clara, en vez de dejarla peleando con tres errores distintos.
  const handleSellerError = (layer: SellerErrorLayer, err: unknown) => {
    console.error(`[SELLER_ERROR:${layer}]`, err);
    addToast(sellerErrorMessage(layer, err), 'error');
    if (isSessionDeadError(err)) {
      setTimeout(async () => {
        try { const { signOut } = await import('firebase/auth'); const { auth } = await import('@/lib/firebase'); await signOut(auth); } catch { /* igual navegamos */ }
        navigate('/acceso', { replace: true });
      }, 2500);
    }
  };
  const uploadToStorage = async (file: File): Promise<string> => {
    const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
    const { storage } = await import('@/lib/firebase');
    const path = `chat-attachments/${activeMembership!.tenantId}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, { contentType: file.type });
    return getDownloadURL(storageRef);
  };

  // Instrumentación temporal: el reporte en producción es que el chooser nativo de
  // Android/iOS abre bien, pero el archivo capturado/elegido no siempre vuelve al chat.
  // Estos logs marcan cada paso (click → input disparado → change → archivo recibido →
  // attachment creado) para poder ver en remote debugging (chrome://inspect) exactamente
  // dónde se corta el flujo en un teléfono real. Quitar una vez confirmado en producción.
  const debugAttach = (tag: string, data?: unknown) => {
    console.log(`[ATTACH] ${tag}`, data ?? '');
  };

  // Clasifica el archivo por tipo real (MIME primero, extensión como respaldo) y aplica el
  // límite de WhatsApp Cloud API que corresponde a ESE tipo — no un único límite de 16MB
  // para todo. Antes, una imagen pesada (muy común en fotos de celular modernas) no
  // disparaba ninguna advertencia porque 16MB es el límite de video/audio, no el de imagen
  // (5MB) — y el mensaje de "para video" nunca debía aparecer fuera de un video, cosa que
  // ya no puede pasar: el texto ahora se arma con el tipo real detectado, no con un ternario
  // aparte. Límites verificados contra la documentación de Meta al momento de este cambio —
  // revisar si Meta los actualiza.
  const classifyFile = (file: File): PendingMediaKind => {
    if (file.type.startsWith('video/') || /\.(mp4|mov|3gp|webm)$/i.test(file.name)) return 'video';
    if (file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) return 'image';
    if (file.type.startsWith('audio/') || /\.(ogg|mp3|m4a|aac|wav|opus)$/i.test(file.name)) return 'audio';
    return 'document';
  };
  const MEDIA_SIZE_LIMITS: Record<PendingMediaKind, number> = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
  };
  const MEDIA_KIND_LABEL: Record<PendingMediaKind, string> = {
    image: 'imagen', video: 'video', audio: 'audio', document: 'documento',
  };

  // Agrega un archivo al composer con preview local instantánea (URL.createObjectURL, se ve
  // de inmediato) y sube en segundo plano — la UI nunca espera a que termine la subida para
  // reaccionar al toque del usuario. Cada ítem trackea su propio estado (uploading/ready/error).
  const addPendingMedia = (file: File, source: 'PHOTO' | 'VIDEO' | 'GALLERY' | 'ATTACH') => {
    debugAttach(`${source}_FILE_RECEIVED`, { name: file.name, size: file.size, type: file.type });
    if (!activeMembership?.tenantId) {
      debugAttach(`${source}_ABORTED_NO_TENANT`);
      return;
    }
    const kind = classifyFile(file);
    const limit = MEDIA_SIZE_LIMITS[kind];
    // Instrumentación TEMPORAL solo-video: el reporte es que un video corto (10-20s) sigue
    // disparando el mensaje de límite. classifyFile() ya cubre video/mp4|quicktime|3gpp|webm
    // (vía startsWith('video/'), cualquier subtipo cae ahí) y usa extensión como respaldo, así
    // que si esto dispara con kind !== 'video' para un archivo que el usuario grabó como video,
    // el bug está en la clasificación (MIME vacío/genérico + nombre sin extensión reconocida).
    // Si kind === 'video' pero size > limit, el archivo real excede el límite (confirmar con
    // sizeMB de acá) — no asumir, mirar el dato real que reporta el dispositivo.
    if (kind === 'video' || source === 'VIDEO') {
      const extMatch = file.name.match(/\.[^./\\]+$/);
      debugAttach('VIDEO_FILE_META', {
        name: file.name,
        type: file.type || '(vacío)',
        size: file.size,
        sizeMB: +(file.size / 1048576).toFixed(2),
        extension: extMatch ? extMatch[0].toLowerCase() : '(sin extensión)',
        classifyFileResult: kind,
        selectedLimitMB: limit / 1048576,
        source,
        origin: source === 'VIDEO' ? 'camera' : source === 'GALLERY' ? 'gallery' : source,
      });
    }
    if (file.size > limit) {
      debugAttach(`${source}_REJECTED_TOO_LARGE`, { size: file.size, kind });
      addToast(`El archivo pesa ${(file.size / 1048576).toFixed(1)}MB. WhatsApp acepta máximo ${(limit / 1048576).toFixed(0)}MB para ${MEDIA_KIND_LABEL[kind]}.`, 'error');
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const localPreviewUrl = URL.createObjectURL(file);
    setPendingMedia(prev => [...prev, { id, localPreviewUrl, filename: file.name, kind, status: 'uploading', remoteUrl: null }]);
    if (kind === 'video') debugAttach('VIDEO_PENDING_ADDED', { id, name: file.name, sizeMB: +(file.size / 1048576).toFixed(2) });

    // Se devuelve la promesa (no se usa acá) para que el <input> pueda esperar a que el
    // archivo termine de leerse antes de resetear su value — limpiarlo antes puede invalidar
    // el File en algunos navegadores móviles (mismo cuidado que ya se aplicaba acá).
    if (kind === 'video') debugAttach('VIDEO_UPLOAD_START', { id, name: file.name });
    return uploadToStorage(file)
      .then(url => {
        debugAttach(`${source}_ATTACHMENT_CREATED`, { url, name: file.name });
        if (kind === 'video') debugAttach('VIDEO_UPLOAD_SUCCESS', { id, mediaUrl: url });
        setPendingMedia(prev => prev.map(m => m.id === id ? { ...m, status: 'ready', remoteUrl: url } : m));
      })
      .catch(err => {
        debugAttach(`${source}_UPLOAD_ERROR`, err);
        if (kind === 'video') debugAttach('VIDEO_UPLOAD_ERROR', { id, code: err?.code, message: err?.message });
        setPendingMedia(prev => prev.map(m => m.id === id ? { ...m, status: 'error' } : m));
        handleSellerError('upload', err);
      });
  };

  const handleFilesSelected = (fileList: FileList, source: 'PHOTO' | 'VIDEO' | 'GALLERY' | 'ATTACH') => {
    return Promise.all(Array.from(fileList).map(file => addPendingMedia(file, source)));
  };

  const removePendingMedia = (id: string) => {
    setPendingMedia(prev => {
      const item = prev.find(m => m.id === id);
      if (item) URL.revokeObjectURL(item.localPreviewUrl);
      return prev.filter(m => m.id !== id);
    });
  };

  // Liberar los blob: URL de preview local al desmontar (cambio de conversación con
  // adjuntos pendientes sin enviar) — usa el ref, no el closure de este render, para no
  // liberar siempre el array vacío del primer render.
  useEffect(() => () => {
    pendingMediaRef.current.forEach(m => URL.revokeObjectURL(m.localPreviewUrl));
  }, []);

  // ── Grabación de notas de voz por TAP ──────────────────────────────
  const clearRecordTimer = () => {
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
  };

  const startRecording = async () => {
    if (isRecording || isStartingRecorderRef.current) return;
    isStartingRecorderRef.current = true;
    cancelPendingStartRef.current = false;
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      // El permiso de micrófono puede tardar en resolverse (diálogo nativo del
      // navegador, sobre todo la primera vez) — si el usuario ya tocó "detener"
      // mientras tanto, no arrancar la grabación "fantasma".
      if (cancelPendingStartRef.current) {
        recorder.cancel();
        return;
      }
      recorderRef.current = recorder;
      setRecordSeconds(0);
      setIsRecording(true);
      // Tope de 3 min: ScriptProcessorNode acumula todo el audio crudo en memoria
      // (no hay streaming), así que una grabación muy larga puede volverse pesada
      // y sentirse "colgada" en celulares de gama baja — se corta sola y se envía.
      const MAX_RECORD_SECONDS = 180;
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds(s => {
          if (s + 1 >= MAX_RECORD_SECONDS) {
            stopAndSendRecording();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      addToast('No se pudo acceder al micrófono. Revisá los permisos.', 'error');
    } finally {
      isStartingRecorderRef.current = false;
    }
  };

  const cancelRecording = () => {
    clearRecordTimer();
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setIsRecording(false);
    setRecordSeconds(0);
  };

  // Segundo tap (el mismo botón, ya mostrando el ícono de Enviar): detiene el
  // MediaRecorder, espera a que termine de construir el archivo, y lo sube y
  // envía directo — sin paso de preview intermedio, el flujo ya es estable.
  const stopAndSendRecording = async () => {
    if (!recorderRef.current) { cancelRecording(); return; }
    clearRecordTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setIsRecording(false);
    if (!activeConversation || !activeMembership?.tenantId) { setRecordSeconds(0); return; }
    setIsUploading(true);
    try {
      const file = await recorder.stop();
      if (file.size < 1200) { addToast('La nota de voz quedó muy corta.', 'info'); return; }
      const url = await uploadToStorage(file);
      await sendMessage(activeConversation, '', 'advisor', activeMembership.tenantId, url, file.name);
    } catch (err) {
      const esDeGrabacion = String((err as { name?: string })?.name || '').includes('Not');
      handleSellerError(esDeGrabacion ? 'mic' : 'upload', err);
    } finally {
      setIsUploading(false);
      setRecordSeconds(0);
    }
  };

  // Tap único en el botón mic/enviar: inicia si está en reposo, detiene Y
  // envía si ya está grabando. Si el tap de "enviar" llega mientras el
  // permiso del micrófono todavía está pendiente, se marca para cancelar
  // apenas resuelva (evita una grabación "fantasma").
  const handleMicTap = () => {
    if (isUploading) return;
    if (isRecording) { stopAndSendRecording(); return; }
    if (isStartingRecorderRef.current) { cancelPendingStartRef.current = true; return; }
    startRecording();
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
    <div className="h-full md:h-[calc(100vh-8rem)] flex overflow-hidden rounded-2xl shadow-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">

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
                        {/* Fallback (m.userId || m.id) — un asesor prepared/pending recién
                            asignado por Multi-Agente no tiene userId todavía (solo el id de
                            membership), y sin este fallback el badge mostraba "Agente" genérico
                            en vez de su nombre real. */}
                        {team.find(m => (m.userId || m.id) === conv.advisorId)?.name?.split(' ')[0] || 'Agente'}
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
                    {activeChat.phoneE164 || activeChat.phoneRaw
                      ? (activeChat.phoneE164 || activeChat.phoneRaw)
                      : activeChat.source === 'instagram' ? 'Instagram DM' : 'Messenger'}
                  </p>
                </div>

                {/* Tomar conversación — Modo Libre, solo si nadie la tiene aún */}
                {!activeChat.advisorId && (
                  <button
                    onClick={() => handleClaim(activeChat.id)}
                    disabled={isClaiming}
                    className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-xl shrink-0 text-[10px] font-black uppercase tracking-tight hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
                    title="Tomar esta conversación sin asignar"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {isClaiming ? 'Tomando...' : 'Tomar'}
                  </button>
                )}

                {/* Assign agent — oculto en móvil */}
                <div className="hidden md:flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl shrink-0">
                  <UserPlus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={activeChat.advisorId || ''}
                    onChange={e => handleAssignAgent(activeChat.id, e.target.value)}
                    className="bg-transparent text-[10px] font-bold text-slate-600 dark:text-slate-400 outline-none cursor-pointer max-w-[90px]"
                  >
                    <option value="">Sin asignar</option>
                    {team.map(m => {
                      const effectiveId = m.userId || m.id;
                      const isActive = m.status === 'active';
                      const label = `${m.name || m.email || 'Sin nombre'}${!isActive ? ` (${TEAM_STATUS_LABEL[m.status] || m.status})` : ''}`;
                      return (
                        <option key={m.id} value={effectiveId} disabled={!isActive} title={!isActive ? 'Solo se puede asignar a miembros con acceso activo' : undefined}>
                          {label}
                        </option>
                      );
                    })}
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 md:px-6 py-4 space-y-3 scrollbar-hide">
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
                          <AudioMessagePlayer src={msg.mediaUrl} />
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
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {msg.text?.replace(/^\[Imagen Enviada\]\n/, '').replace(/^\[Documento Enviado:.*?\]\n/, '').replace(/^\[Error al enviar.*?\]\n/, '')}
                      </p>
                    )}
                    <div className="flex justify-end items-center gap-1 mt-1.5">
                      <span className="text-[10px] opacity-40">
                        {msg.timestamp ? formatChatTimestamp(msg.timestamp) : '...'}
                      </span>
                      {/* LOOP nocturno USADITOS, Fase 5: antes esto era un
                          CheckCheck azul fijo para TODO mensaje del asesor,
                          sin mirar msg.status — un mensaje con status:'failed'
                          se veía idéntico a uno realmente entregado. Ahora
                          refleja el estado real que ya guarda el backend. */}
                      {msg.sender === 'advisor' && (
                        msg.status === 'failed' ? (
                          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                        ) : msg.status === 'read' ? (
                          <CheckCheck className="w-3.5 h-3.5 text-[#1877F2]" />
                        ) : msg.status === 'delivered' ? (
                          <CheckCheck className="w-3.5 h-3.5 opacity-40" />
                        ) : msg.status === 'sent' ? (
                          <Check className="w-3.5 h-3.5 opacity-40" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 opacity-40 animate-spin" />
                        )
                      )}
                    </div>
                    {msg.sender === 'advisor' && msg.status === 'failed' && (
                      <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-red-500/20 text-[10px] font-bold text-red-500 dark:text-red-400">
                        <span className="flex-1 min-w-0 truncate" title={msg.errorMessage}>
                          No enviado{msg.errorMessage ? ` — ${msg.errorMessage}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRetryFailedMessage(msg)}
                          disabled={retryingMsgId === msg.id}
                          className="inline-flex items-center gap-1 shrink-0 text-[#1877F2] hover:underline disabled:opacity-50"
                        >
                          {retryingMsgId === msg.id
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <RotateCcw className="w-3 h-3" />}
                          Reintentar
                        </button>
                      </div>
                    )}
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
              {isWindowExpired && (
                showQuotaPanel ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowQuotaPanel(false)}
                      className="w-full flex items-center justify-between px-4 pt-3 text-[10px] font-black text-slate-400 uppercase tracking-widest"
                    >
                      Ocultar estado de cuotas
                      <span>▲</span>
                    </button>
                    <WhatsappUsageStats quota={activeQuota} onUpgrade={() => setShowCreditsModal(true)} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowQuotaPanel(true)}
                    className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 text-[10px] font-black text-slate-400 uppercase tracking-widest"
                  >
                    <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-amber-500" /> Estado de cuotas WhatsApp</span>
                    <span>▼</span>
                  </button>
                )
              )}
              <div className="px-4 py-3">
                {!isWindowExpired && (
                  <button
                    type="button"
                    onClick={() => setShowToolsPanel(v => !v)}
                    className="w-full flex items-center justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5"
                  >
                    <span>Plantillas, catálogo y más</span>
                    <span>{showToolsPanel ? '▲' : '▼'}</span>
                  </button>
                )}
                {(isWindowExpired || showToolsPanel) && <WhatsappWindowHint status={windowInfo.status} />}

                {/* Action shortcuts */}
                {!isWindowExpired && showToolsPanel && (
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
                    {/* COBRO PRIMERO Y EN VERDE: es la accion que cierra la venta, y
                        antes era el ultimo chip gris-verde de la fila, del mismo tamano
                        que el resto. Es una accion DE VENTA dentro de la conversacion, no
                        configuracion financiera: el asesor genera el enlace y se lo manda
                        al cliente; las cuentas de cobro las administra Owner/Admin. */}
                    <button onClick={() => setShowPaymentModal(true)}
                      className="flex items-center gap-2 px-5 py-3 bg-[#10B981] hover:bg-emerald-600 active:scale-[0.98] rounded-2xl text-sm font-black text-white shadow-md transition-all w-full sm:w-auto justify-center order-first">
                      <CreditCard className="w-4 h-4" /> Cobrar / Enviar pago
                    </button>
                    <button onClick={() => setShowCatalogDrawer(true)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 transition-colors">
                      <Package className="w-3.5 h-3.5 text-slate-400" /> Catálogo
                    </button>
                    {/* El asesor NO navega a /cotizaciones (modulo administrativo): antes
                        este boton lo mandaba derecho a "Acceso restringido". Ahora le deja
                        la plantilla de cotizacion lista en el mensaje, que es la accion
                        comercial que necesita; Owner/Admin sigue abriendo el modulo. */}
                    <button onClick={() => {
                      if (canOpenQuotesModule) { navigate('/cotizaciones'); return; }
                      const plantilla = (quickTemplates?.quoteMessage || '').replace(/{{quoteNumber}}/g, '—');
                      setInputText(prev => prev ? `${prev}
${plantilla}` : plantilla);
                    }}
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-500 transition-colors">
                      <FileText className="w-3.5 h-3.5 text-slate-400" /> Cotizar
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
                    {/* Previews múltiples (Adjuntar/Galería/Foto/Video) — preview local instantánea,
                        cada ítem muestra su propio estado de subida y se puede quitar individualmente.
                        Scroll horizontal encapsulado a esta franja, nunca a la página. */}
                    {pendingMedia.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {pendingMedia.map(item => (
                          <div key={item.id} className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
                            {item.kind === 'image' ? (
                              <img src={item.localPreviewUrl} alt="" className="w-full h-full object-cover" />
                            ) : item.kind === 'video' ? (
                              <video src={item.localPreviewUrl} muted className="w-full h-full object-cover" />
                            ) : item.kind === 'audio' ? (
                              <div className="w-full h-full flex items-center justify-center"><Mic className="w-5 h-5 text-slate-400" /></div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center"><FileText className="w-5 h-5 text-slate-400" /></div>
                            )}
                            {item.status === 'uploading' && (
                              <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
                                <Loader2 className="w-4 h-4 text-white animate-spin" />
                              </div>
                            )}
                            {item.status === 'error' && (
                              <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center">
                                <AlertCircle className="w-4 h-4 text-white" />
                              </div>
                            )}
                            <button type="button" onClick={() => removePendingMedia(item.id)} title="Quitar"
                              className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center transition-colors">
                              <X className="w-2.5 h-2.5 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
                      multiple
                      accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.mp4,.mov,.3gp,.ogg,.mp3,.m4a,.aac,.wav,.opus"
                      className="hidden"
                      onChange={async e => {
                        const files = e.target.files;
                        if (files?.length) await handleFilesSelected(files, 'ATTACH');
                        e.target.value = '';
                      }}
                    />
                    {/* capture="environment" abre la camara directo en celular, no la galeria.
                        accept mezclado "image/*,video/*" no abre la camara en varios navegadores
                        de Android — un solo tipo por input es lo confiable. Sin "multiple": una
                        captura de cámara siempre es una sola foto/video por naturaleza. */}
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={async e => {
                        debugAttach('PHOTO_CHANGE', { filesLength: e.target.files?.length ?? 0 });
                        const files = e.target.files;
                        if (files?.length) await handleFilesSelected(files, 'PHOTO');
                        e.target.value = '';
                      }}
                    />
                    <input
                      ref={cameraVideoInputRef}
                      type="file"
                      accept="video/*"
                      capture="environment"
                      className="hidden"
                      onChange={async e => {
                        const files = e.target.files;
                        debugAttach('VIDEO_CHANGE', {
                          filesLength: files?.length ?? 0,
                          files: files ? Array.from(files).map(f => ({ name: f.name, type: f.type, size: f.size })) : [],
                        });
                        // Instrumentación temporal: primer eslabón de la cadena
                        // "video no envía" — confirma qué entrega REALMENTE la
                        // cámara nativa de Android antes de cualquier procesamiento propio.
                        if (files?.length) {
                          Array.from(files).forEach(f => debugAttach('VIDEO_NATIVE_CHANGE', {
                            name: f.name, type: f.type, size: f.size, sizeMB: +(f.size / 1048576).toFixed(2),
                          }));
                          await handleFilesSelected(files, 'VIDEO');
                        }
                        e.target.value = '';
                      }}
                    />
                    {/* Galería: sin "capture", así el navegador abre el selector de fotos/videos
                        del teléfono en vez de la cámara. Input separado del de "Adjuntar" (que
                        acepta también audio/documentos) para que el punto de entrada quede
                        claro junto a Foto/Video en el mismo menú. "multiple": selección de
                        varias imágenes/videos de una sola vez. */}
                    <input
                      ref={galleryInputRef}
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={async e => {
                        debugAttach('GALLERY_CHANGE', { filesLength: e.target.files?.length ?? 0 });
                        const files = e.target.files;
                        if (files?.length) await handleFilesSelected(files, 'GALLERY');
                        e.target.value = '';
                      }}
                    />
                    <div className="flex items-center gap-2">
                      {/* Adjuntar (oculto mientras se graba) */}
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading}
                        title="Adjuntar imagen, audio o documento"
                        className={`w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 rounded-xl transition-colors shrink-0 disabled:opacity-40 ${isRecording ? 'hidden' : ''}`}>
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                      </button>
                      {/* Cámara: toma foto o graba video al momento y lo sube igual que un adjunto.
                          Dos inputs separados (foto/video) porque un solo input con accept
                          mezclado no abre la cámara de forma confiable en Android. */}
                      <div className={`relative shrink-0 ${isRecording ? 'hidden' : ''}`}>
                        <button type="button" onClick={() => setShowCameraChoice(v => !v)} disabled={isUploading}
                          title="Cámara o galería"
                          className="w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 rounded-xl transition-colors disabled:opacity-40">
                          <Camera className="w-4 h-4" />
                        </button>
                        {showCameraChoice && (
                          <div className="absolute bottom-full left-0 mb-2 w-36 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-30 overflow-hidden">
                            <button type="button"
                              onClick={() => {
                                debugAttach('PHOTO_CLICK');
                                setShowCameraChoice(false);
                                cameraInputRef.current?.click();
                                debugAttach('PHOTO_INPUT_TRIGGERED');
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                              <Camera className="w-3.5 h-3.5" /> Foto
                            </button>
                            <button type="button"
                              onClick={() => {
                                debugAttach('VIDEO_CLICK');
                                setShowCameraChoice(false);
                                // Grabador propio (VideoRecorderModal) desactivado: dos rondas de
                                // QA física en Android confirmaron que el MP4 que produce el
                                // MediaRecorder del navegador no tiene duración/metadata válida
                                // (preview negro, 0:00) — no es un problema de qué candidato de
                                // mimeType se pide, es el propio encoder/muxer de Android. El gate
                                // de reproducibilidad lo bloquearía igual, así que en vez de
                                // insistir se usa directo el flujo nativo de cámara del teléfono
                                // (ya valida el límite de 16MB y da preview+enviar vía
                                // addPendingMedia, igual que cualquier otro adjunto).
                                debugAttach('VIDEO_RECORDER_FALLBACK_NATIVE', { reason: 'custom_recorder_disabled_unreliable_mp4' });
                                cameraVideoInputRef.current?.click();
                                debugAttach('VIDEO_INPUT_TRIGGERED');
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 border-t border-slate-100 dark:border-slate-700">
                              <Play className="w-3.5 h-3.5" /> Video
                            </button>
                            <button type="button"
                              onClick={() => {
                                debugAttach('GALLERY_CLICK');
                                setShowCameraChoice(false);
                                galleryInputRef.current?.click();
                                debugAttach('GALLERY_INPUT_TRIGGERED');
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2 border-t border-slate-100 dark:border-slate-700">
                              <Image className="w-3.5 h-3.5" /> Galería
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Área central: texto (reposo) · grabando */}
                      <div className="flex-1 min-w-0">
                        {isRecording ? (
                          <div className="flex items-center gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-2xl pl-2 pr-3 py-1.5">
                            <button type="button" onClick={cancelRecording} title="Cancelar" disabled={isUploading}
                              className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors shrink-0 disabled:opacity-40">
                              <Trash2 className="w-4 h-4" />
                            </button>
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                            <span className="text-sm font-bold text-rose-600 tabular-nums flex-1">
                              {String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:{String(recordSeconds % 60).padStart(2, '0')}
                            </span>
                            <span className="text-xs font-semibold text-rose-500/70 truncate">Tocá enviar para mandar</span>
                          </div>
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

                      {/* Mic/Enviar unificado: en reposo muestra Mic (tap inicia), grabando
                          cambia AL INSTANTE a Enviar (mismo botón, tap detiene y envía directo,
                          sin preview intermedio) — Cancelar arriba es la acción secundaria. */}
                      <button type="button"
                        onClick={handleMicTap}
                        disabled={isUploading}
                        title={isUploading ? 'Enviando…' : isRecording ? 'Enviar nota de voz' : 'Tocá para grabar'}
                        className={`flex items-center justify-center rounded-2xl transition-all shrink-0 disabled:opacity-40 ${isRecording ? 'w-12 h-12 bg-emerald-500 text-white scale-110 shadow-lg shadow-emerald-500/30' : 'w-9 h-9 bg-slate-100 dark:bg-slate-700 text-slate-500 hover:text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/20'}`}>
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : isRecording ? <Send className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      </button>

                      {/* Enviar texto (solo en reposo — mientras graba, el botón de arriba ya es Enviar) */}
                      {!isRecording && (
                        <button type="submit"
                          disabled={(!inputText.trim() && !mediaUrl && pendingMedia.length === 0) || isSending || pendingMedia.some(m => m.status === 'uploading')}
                          title={pendingMedia.some(m => m.status === 'uploading') ? 'Esperando a que terminen de subir los adjuntos…' : undefined}
                          className="w-11 h-11 flex items-center justify-center bg-[#1877F2] text-white rounded-2xl shadow-lg shadow-[#1877F2]/20 hover:bg-blue-600 disabled:opacity-40 transition-all shrink-0">
                          {isSending || pendingMedia.some(m => m.status === 'uploading') ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
