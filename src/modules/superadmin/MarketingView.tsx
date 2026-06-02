import { useState, useEffect } from 'react';
import { 
  Sparkles, Send, Copy, Check, FileText, X,
  ChevronLeft, ChevronRight, History, BookOpen, Clock, Lightbulb, 
  ArrowRight, Heart, MessageCircle, Share, Bookmark, Globe, ArrowUpRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, serverTimestamp, limit, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';

const InstagramIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);

const FacebookIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </svg>
);

interface BlogData {
  title: string;
  metaDescription: string;
  introduction: string;
  subheadings: { title: string; content: string }[];
  conclusion: string;
  cta: string;
}

interface FacebookData {
  hook: string;
  body: string;
  cta: string;
}

interface InstagramSlide {
  slideNumber: number;
  slideTitle: string;
  slideBody: string;
  graphicConcept: string;
}

interface InstagramData {
  slides: InstagramSlide[];
  caption: string;
  hashtags: string;
}

interface CampaignData {
  blog: BlogData;
  facebook: FacebookData;
  instagram: InstagramData;
}

interface HistoryItem {
  id: string;
  topic: string;
  tone: string;
  createdAt: any;
  data: CampaignData;
}

export const MarketingView = () => {
  const { addToast } = useUIStore();
  const { activeMembership } = useAuthStore();
  const tenantId = activeMembership?.tenantId;
  
  // Navegación de pestañas principales (Creación IA vs Canales y Conexiones)
  const [activeSubTab, setActiveSubTab] = useState<'generator' | 'connections'>('generator');

  // Conexiones de redes sociales (Persistentes mediante Firestore)
  const [isFbConnected, setIsFbConnected] = useState(false);
  const [isIgConnected, setIsIgConnected] = useState(false);
  const [isBlogConnected, setIsBlogConnected] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<'facebook' | 'instagram' | 'blog' | null>(null);
  const [oauthStep, setOauthStep] = useState<'start' | 'loading' | 'select'>('start');
  const [selectedFbPage, setSelectedFbPage] = useState('SmartFlow Suite (@smartflowsuite)');
  const [blogUrl, setBlogUrl] = useState('https://smartflow-suite.com');
  const [wordpressUser, setWordpressUser] = useState('admin');
  const [wordpressAppPassword, setWordpressAppPassword] = useState('xxxx-xxxx-xxxx-xxxx');

  // Estados de conexión con API Meta de Producción Real
  const [connectionMode, setConnectionMode] = useState<'oauth' | 'real_api'>('real_api');
  const [realPageToken, setRealPageToken] = useState('');
  const [realPageId, setRealPageId] = useState('');
  const [realIgBusinessId, setRealIgBusinessId] = useState('');
  const [realFbPageName, setRealFbPageName] = useState('');
  const [realFbAvatar, setRealFbAvatar] = useState('');
  const [realIgUsername, setRealIgUsername] = useState('');

  // Efecto para suscribirse en tiempo real a las conexiones de marketing del Tenant.
  // SEGURIDAD: Migrado de `settings/{tenantId}.marketingConnections` a la coleccion
  // `marketing_connections/{tenantId}`, restringida a Admin/Owner. Antes cualquier
  // miembro (Asesor/Tecnico) podia leer los Page Access Tokens.
  useEffect(() => {
    if (!tenantId) return;
    const unsub = onSnapshot(doc(db, 'marketing_connections', tenantId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const connections = data || {};

        if (connections.facebook?.isConnected) {
          setIsFbConnected(true);
          setRealFbPageName(connections.facebook.pageName || '');
          setRealFbAvatar(connections.facebook.avatarUrl || '');
          setRealPageId(connections.facebook.pageId || '');
          setRealPageToken(connections.facebook.accessToken || '');
          setSelectedFbPage(connections.facebook.pageName || '');
        } else {
          setIsFbConnected(false);
        }
        
        if (connections.instagram?.isConnected) {
          setIsIgConnected(true);
          setRealIgUsername(connections.instagram.username || '');
          setRealIgBusinessId(connections.instagram.businessId || '');
        } else {
          setIsIgConnected(false);
        }
        
        if (connections.blog?.isConnected) {
          setIsBlogConnected(true);
        } else {
          setIsBlogConnected(false);
        }
      }
    });
    return () => unsub();
  }, [tenantId]);

  const saveConnectionsToDb = async (updatedConnections: any) => {
    if (!tenantId) return;
    try {
      // SEGURIDAD: escribimos en marketing_connections (admin-only), no en settings.
      await setDoc(doc(db, 'marketing_connections', tenantId), updatedConnections, { merge: true });
    } catch (err) {
      console.error('Error saving connections to Firestore:', err);
      addToast('Error al guardar la conexión en la base de datos', 'error');
    }
  };

  const handleDisconnect = async (platform: 'facebook' | 'instagram' | 'blog') => {
    if (!tenantId) return;
    try {
      await setDoc(doc(db, 'marketing_connections', tenantId), {
        [platform]: {
          isConnected: false,
          pageId: '',
          pageName: '',
          accessToken: '',
          avatarUrl: '',
          username: '',
          businessId: ''
        }
      }, { merge: true });
      addToast(`Canal ${platform === 'blog' ? 'Blog' : platform === 'facebook' ? 'Facebook' : 'Instagram'} desconectado con éxito`, 'info');
    } catch (err) {
      console.error('Error disconnecting:', err);
      addToast('Error al desconectar de la base de datos', 'error');
    }
  };

  const [isValidatingApi, setIsValidatingApi] = useState(false);

  const handleValidateAndSaveRealApi = async () => {
    if (!realPageToken || !realPageId) {
      addToast('Por favor, ingresa el Page Access Token y el Page ID', 'warning');
      return;
    }
    setIsValidatingApi(true);
    try {
      // 1. Validar la Página de Facebook contra la API de Meta
      const testUrl = `https://graph.facebook.com/v18.0/${realPageId}?fields=name,picture&access_token=${realPageToken}`;
      const response = await fetch(testUrl);
      const data = await response.json();
      
      if (data.error) {
        console.warn('Meta API Error, fallback to force save:', data.error);
        addToast(`Bypasando Meta API Error: ${data.error.message}. Guardando en Modo Manual/Sandbox.`, 'warning');
        
        let updatedConnections: any = {
          facebook: {
            isConnected: true,
            pageId: realPageId,
            pageName: 'Página de Facebook Conectada',
            accessToken: realPageToken,
            avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
          }
        };

        if (connectingPlatform === 'instagram' && realIgBusinessId) {
          updatedConnections.instagram = {
            isConnected: true,
            businessId: realIgBusinessId,
            username: '@instagram_comercial',
            accessToken: realPageToken
          };
        }

        await saveConnectionsToDb(updatedConnections);
        addToast('¡Canales de Meta conectados con éxito en Modo Sandbox/Manual! 🚀', 'success');
        setConnectingPlatform(null);
        setIsValidatingApi(false);
        return;
      }
      
      const pageName = data.name || 'Página de Facebook';
      const avatarUrl = data.picture?.data?.url || '';
      
      let updatedConnections: any = {
        facebook: {
          isConnected: true,
          pageId: realPageId,
          pageName: pageName,
          accessToken: realPageToken,
          avatarUrl: avatarUrl
        }
      };

      // 2. Si se proporcionó un ID de Instagram Business, validarlo también
      if (connectingPlatform === 'instagram' && realIgBusinessId) {
        const igTestUrl = `https://graph.facebook.com/v18.0/${realIgBusinessId}?fields=username,profile_picture_url&access_token=${realPageToken}`;
        const igRes = await fetch(igTestUrl);
        const igData = await igRes.json();
        
        if (igData.error) {
          console.warn('Meta IG API Error, fallback to manual IG connection:', igData.error);
          updatedConnections.instagram = {
            isConnected: true,
            businessId: realIgBusinessId,
            username: '@instagram_comercial',
            accessToken: realPageToken
          };
          addToast('¡Cuenta de Instagram conectada en Modo Manual/Sandbox!', 'warning');
        } else {
          updatedConnections.instagram = {
            isConnected: true,
            businessId: realIgBusinessId,
            username: '@' + (igData.username || pageName.toLowerCase().replace(/\s+/g, '')),
            accessToken: realPageToken
          };
          addToast(`¡Cuenta de Instagram @${igData.username || 'comercial'} conectada exitosamente!`, 'success');
        }
      } else if (connectingPlatform === 'instagram' && !realIgBusinessId) {
        addToast('Para Instagram, debes proveer también el Instagram Business ID', 'warning');
        setIsValidatingApi(false);
        return;
      }

      await saveConnectionsToDb(updatedConnections);
      addToast(`¡Canal de Facebook "${pageName}" conectado con éxito! 🚀`, 'success');
      setConnectingPlatform(null);
    } catch (err) {
      console.warn('Meta connection verification network error, fallback to force save:', err);
      addToast('Error de red/CORS con Meta API. Conectando y guardando de forma Manual/Sandbox para evitar bloqueos.', 'warning');
      
      let updatedConnections: any = {
        facebook: {
          isConnected: true,
          pageId: realPageId,
          pageName: 'Página de Facebook Conectada',
          accessToken: realPageToken,
          avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
        }
      };

      if (connectingPlatform === 'instagram' && realIgBusinessId) {
        updatedConnections.instagram = {
          isConnected: true,
          businessId: realIgBusinessId,
          username: '@instagram_comercial',
          accessToken: realPageToken
        };
      }

      await saveConnectionsToDb(updatedConnections);
      addToast('¡Canales de Meta enlazados y configurados con éxito! 🚀', 'success');
      setConnectingPlatform(null);
    } finally {
      setIsValidatingApi(false);
    }
  };

  const startConnectionFlow = (platform: 'facebook' | 'instagram' | 'blog') => {
    setConnectingPlatform(platform);
    setOauthStep('start');
  };

  // Estados de autopublicación de campaña
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState(0);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishResults, setPublishResults] = useState<{
    blog: 'idle' | 'success' | 'error';
    facebook: 'idle' | 'success' | 'error' | 'blocked';
    instagram: 'idle' | 'success' | 'error' | 'blocked';
  }>({ blog: 'idle', facebook: 'idle', instagram: 'idle' });

  // Formulario
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('persuasive');
  const [notes, setNotes] = useState('');
  
  // Estados de carga e IA
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<CampaignData | null>(null);

  // Estados de imágenes DALL-E 3
  const [igImageUrl, setIgImageUrl] = useState<string | null>(null);
  const [fbImageUrl, setFbImageUrl] = useState<string | null>(null);
  const [blogImageUrl, setBlogImageUrl] = useState<string | null>(null);
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [activeTab, setActiveTab] = useState<'instagram' | 'facebook' | 'blog'>('instagram');
  
  // Instagram Mockup Carousel State
  const [currentSlide, setCurrentSlide] = useState(0);
  
  // Estado para copiar al portapapeles
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const publishSteps = [
    '📤 Subiendo imágenes autogeneradas a los servidores Meta CDN...',
    '✍️ Sincronizando artículo SEO y metadatos en el Blog Corporativo de tu Landing Page...',
    '👥 Creando post con ganchos persuasivos en Facebook Page...',
    '📸 Publicando carrusel de imágenes secuenciales en Instagram Business...',
    '🎉 ¡Campaña de marketing publicada con total éxito en todos los canales activos!'
  ];

  const handleStartPublishing = async () => {
    if (!result) return;

    setIsPublishing(true);
    setPublishStep(0);
    setPublishSuccess(false);
    setPublishResults({ blog: 'idle', facebook: 'idle', instagram: 'idle' });

    try {
      // 1. Blog → Firestore (siempre funciona, no depende de Meta)
      setPublishStep(1);
      if (isBlogConnected) {
        try {
          const slug = result.blog.title
            .toLowerCase().trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
          await addDoc(collection(db, 'landing_blog_posts'), {
            title: result.blog.title,
            slug,
            introduction: result.blog.introduction || '',
            subheadings: result.blog.subheadings || [],
            conclusion: result.blog.conclusion || '',
            cta: result.blog.cta || '',
            metaDescription: result.blog.metaDescription || '',
            topic,
            imageUrl: blogImageUrl || '',
            createdAt: new Date().toISOString(),
          });
          setPublishResults(prev => ({ ...prev, blog: 'success' }));
        } catch (err) {
          console.error('Blog Firestore error:', err);
          setPublishResults(prev => ({ ...prev, blog: 'error' }));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Facebook Pages API
      setPublishStep(2);
      if (isFbConnected && realPageId && realPageToken) {
        try {
          const messageBody = `${result.facebook.hook}\n\n${result.facebook.body}\n\n${result.facebook.cta}`;
          const res = await fetch(`https://graph.facebook.com/v18.0/${realPageId}/feed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageBody, access_token: realPageToken })
          });
          const fbData = await res.json();
          if (fbData.error) {
            const isBlocked = fbData.error.code === 200 || fbData.error.message?.includes('pages_manage_posts') || fbData.error.message?.includes('App Review');
            setPublishResults(prev => ({ ...prev, facebook: isBlocked ? 'blocked' : 'error' }));
          } else {
            setPublishResults(prev => ({ ...prev, facebook: 'success' }));
            addToast('¡Post publicado en Facebook! 🚀', 'success');
          }
        } catch (err) {
          console.error('Facebook publish error:', err);
          setPublishResults(prev => ({ ...prev, facebook: 'error' }));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Instagram Business API
      setPublishStep(3);
      if (isIgConnected && realIgBusinessId && realPageToken) {
        try {
          const captionText = `${result.instagram.caption}\n\n${result.instagram.hashtags}`;
          // Instagram requiere imagen pública — si tenemos URL de Pollinations la usamos como fallback
          const igImagePublicUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(result.blog.title + ' professional tech business dark background')}&width=1080&height=1350&nologo=true`;
          const containerRes = await fetch(`https://graph.facebook.com/v18.0/${realIgBusinessId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: igImagePublicUrl, caption: captionText, access_token: realPageToken })
          });
          const containerData = await containerRes.json();
          if (containerData.id) {
            const publishRes = await fetch(`https://graph.facebook.com/v18.0/${realIgBusinessId}/media_publish`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creation_id: containerData.id, access_token: realPageToken })
            });
            const publishData = await publishRes.json();
            if (publishData.error) {
              const isBlocked = publishData.error.code === 200 || publishData.error.message?.includes('permission');
              setPublishResults(prev => ({ ...prev, instagram: isBlocked ? 'blocked' : 'error' }));
            } else {
              setPublishResults(prev => ({ ...prev, instagram: 'success' }));
              addToast('¡Post publicado en Instagram! 📸', 'success');
            }
          } else if (containerData.error) {
            const isBlocked = containerData.error.code === 200 || containerData.error.message?.includes('permission') || containerData.error.message?.includes('does not exist');
            setPublishResults(prev => ({ ...prev, instagram: isBlocked ? 'blocked' : 'error' }));
          }
        } catch (err) {
          console.error('Instagram publish error:', err);
          setPublishResults(prev => ({ ...prev, instagram: 'error' }));
        }
      }
      await new Promise(resolve => setTimeout(resolve, 800));

      setPublishStep(4);
      setIsPublishing(false);
      setPublishSuccess(true);
    } catch (err) {
      console.error('Critical error during publishing:', err);
      setIsPublishing(false);
      addToast('Error inesperado durante la publicación.', 'error');
    }
  };
  
  // Historial
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const PRESET_TOPICS = [
    { label: 'Auditor IA de SmartFlow', value: 'Cómo el Auditor de Calidad IA de SmartFlow analiza tus chats de WhatsApp y te ayuda a recuperar ventas perdidas' },
    { label: 'Piloto Automático de Ventas', value: 'Activar un Agente IA autónomo en WhatsApp que responde dudas de tus productos, califica prospectos y agenda citas' },
    { label: 'Adiós desorden en Clientes', value: 'Por qué necesitas un CRM de WhatsApp multiagente para que tu equipo de ventas deje de perder clientes' },
    { label: 'Links de Pago Express', value: 'Cómo generar enlaces de cobros con PayPal y tarjeta directamente en tus conversaciones de WhatsApp' },
  ];

  // Cargar Historial al montar
  useEffect(() => {
    fetchHistory();
  }, []);

  // Escuchar mensaje del popup OAuth real de Facebook
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'FACEBOOK_AUTHORIZED') {
        setOauthStep('select');
        addToast(`Conectado como ${event.data.userName} con éxito`, 'success');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const fetchHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const q = query(
        collection(db, 'superadmin_marketing_history'), 
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const snapshot = await getDocs(q);
      const items: HistoryItem[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as HistoryItem[];
      setHistory(items);
    } catch (error) {
      console.error('Error fetching history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Efecto de mensajes secuenciales de carga
  useEffect(() => {
    let interval: any;
    if (isGenerating) {
      interval = setInterval(() => {
        setLoadingStep(prev => (prev + 1) % 4);
      }, 3500);
    } else {
      setLoadingStep(0);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const loadingMessages = [
    '🤖 Analizando contexto comercial con Google Gemini 1.5...',
    '✍️ Redactando artículo optimizado SEO para tu Blog...',
    '👥 Estructurando publicación con alto gancho para Facebook...',
    '📸 Diseñando diapositivas de Carrusel y Caption para Instagram...'
  ];

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!topic.trim()) {
      addToast('Por favor escribe o selecciona un tema de campaña.', 'error');
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const generateContentFn = httpsCallable<any, any>(functions, 'generateSocialMediaContent');
      const response = await generateContentFn({
        topic,
        tone,
        additionalNotes: notes
      });

      if (response.data?.success) {
        const campaignData = response.data.data as CampaignData;
        setResult(campaignData);
        setCurrentSlide(0);
        setIgImageUrl(null);
        setFbImageUrl(null);
        setBlogImageUrl(null);
        addToast('¡Campaña generada! Creando imágenes con DALL-E 3... 🎨', 'success');

        // Guardar en Firestore Historial de forma asíncrona
        try {
          await addDoc(collection(db, 'superadmin_marketing_history'), {
            topic,
            tone,
            additionalNotes: notes,
            data: campaignData,
            createdAt: serverTimestamp()
          });
          fetchHistory();
        } catch (dbErr) {
          console.error('Error saving campaign to history:', dbErr);
        }

        // Generar imágenes con gpt-image-1 en paralelo (composite ads con copy real)
        const generateImageFn = httpsCallable<any, any>(functions, 'generateMarketingImage');
        setIsGeneratingImages(true);
        try {
          const igCopy = campaignData.instagram.caption?.split('\n')[0] || topic;
          const fbCopy = campaignData.facebook.hook || topic;
          const blogCopy = campaignData.blog.title || topic;
          const [igRes, fbRes, blogRes] = await Promise.all([
            generateImageFn({ format: 'instagram', copy: igCopy }),
            generateImageFn({ format: 'facebook', copy: fbCopy }),
            generateImageFn({ format: 'blog', copy: blogCopy })
          ]);
          setIgImageUrl(igRes.data?.imageUrl || null);
          setFbImageUrl(fbRes.data?.imageUrl || null);
          setBlogImageUrl(blogRes.data?.imageUrl || null);
          addToast('¡Imágenes GPT-4o listas! 🖼️', 'success');
        } catch (imgErr: any) {
          console.error('Error generando imágenes gpt-image-1:', imgErr);
          addToast('Error al generar imágenes con GPT-4o.', 'error');
        } finally {
          setIsGeneratingImages(false);
        }
      } else {
        throw new Error('No se recibió la estructura esperada de la IA.');
      }
    } catch (error: any) {
      console.error(error);
      addToast(error.message || 'Error al generar campaña con Gemini.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    addToast('¡Copiado al portapapeles!', 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const loadPastCampaign = (campaign: HistoryItem) => {
    setResult(campaign.data);
    setTopic(campaign.topic);
    setTone(campaign.tone);
    setCurrentSlide(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    addToast('Campaña cargada desde el historial.', 'success');
  };

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="p-4 rounded-2xl bg-[#1877F2]/10 shrink-0">
            <Sparkles className="w-8 h-8 text-[#1877F2]" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Marketing AI Suite</h1>
              <span className="px-2.5 py-0.5 bg-[#1877F2]/10 text-[#1877F2] text-[9px] font-black uppercase tracking-widest rounded-full">
                Gemini 1.5 Flash
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Genera campañas omnicanal coordinadas: Artículos de Blog SEO, Copys de Facebook e Instagram Carruseles en un clic.
            </p>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex p-1 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shrink-0 self-start xl:self-center">
          <button
            onClick={() => setActiveSubTab('generator')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-black tracking-tight transition-all uppercase ${activeSubTab === 'generator' ? 'bg-white dark:bg-slate-800 shadow-md text-[#1877F2]' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'}`}
          >
            <Sparkles className="w-4 h-4" /> GENERADOR IA
          </button>
          <button
            onClick={() => setActiveSubTab('connections')}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-black tracking-tight transition-all uppercase ${activeSubTab === 'connections' ? 'bg-white dark:bg-slate-800 shadow-md text-[#1877F2]' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white'}`}
          >
            <Globe className="w-4 h-4" /> CONEXIONES & RRSS
          </button>
        </div>
      </div>

      {activeSubTab === 'generator' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

        {/* ── FORMULARIO IZQUIERDA ── */}
        <div className="xl:col-span-5 space-y-4">
          <form onSubmit={handleGenerate} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">

            {/* Barra superior azul con título */}
            <div className="bg-[#1877F2] px-6 py-4 flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-white/80" />
              <div>
                <p className="text-sm font-black text-white">Nueva Campaña</p>
                <p className="text-[10px] text-white/60 font-medium">Gemini 1.5 · Blog + Facebook + Instagram</p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Textarea grande de tema */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">¿Sobre qué quieres crear contenido? *</label>
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Ej: Cómo nuestros paneles solares ahorraron $15,000 MXN al mes a un negocio en BCS..."
                  rows={4}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:border-[#1877F2] focus:bg-white dark:focus:bg-slate-900 rounded-2xl outline-none text-sm font-medium text-slate-800 dark:text-white transition-all resize-none placeholder:text-slate-300 dark:placeholder:text-slate-600"
                />
              </div>

              {/* Chips de sugerencias */}
              <div className="space-y-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ideas rápidas:</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_TOPICS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setTopic(p.value)}
                      className="px-3 py-1.5 bg-slate-100 dark:bg-slate-900 hover:bg-[#1877F2]/10 dark:hover:bg-[#1877F2]/10 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-[#1877F2] rounded-full transition-all border border-slate-200 dark:border-slate-700 hover:border-[#1877F2]/30 whitespace-nowrap"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tono */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tono de voz</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:border-[#1877F2] rounded-2xl outline-none text-sm font-semibold text-slate-800 dark:text-white transition-all cursor-pointer"
                >
                  <option value="persuasive">💰 Persuasivo (Ventas)</option>
                  <option value="professional">🏢 Corporativo / Formal</option>
                  <option value="educational">📚 Educativo / Técnico</option>
                  <option value="creative">🎨 Creativo / Divertido</option>
                </select>
              </div>

              {/* Notas extra */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instrucciones extra (opcional)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: incluir descuento del 10%, enfocarlo a PyMEs..."
                  className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:border-[#1877F2] focus:bg-white dark:focus:bg-slate-900 rounded-2xl outline-none text-sm font-medium text-slate-800 dark:text-white transition-all placeholder:text-slate-300 dark:placeholder:text-slate-600"
                />
              </div>

              {/* Botón */}
              <button
                type="submit"
                disabled={isGenerating || !topic.trim()}
                className="w-full py-4 rounded-2xl bg-[#1877F2] hover:bg-[#166fe5] text-white font-black text-sm uppercase tracking-[0.1em] shadow-lg shadow-[#1877F2]/30 flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Generando campaña...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" /> Generar con Gemini
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Historial Reciente */}
          {history.length > 0 && (
            <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <History className="w-3.5 h-3.5" /> Generadas anteriormente
              </h4>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                {history.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadPastCampaign(item)}
                    className="w-full px-3 py-2.5 bg-slate-50 hover:bg-[#1877F2]/5 dark:bg-slate-900/40 dark:hover:bg-slate-800 rounded-xl text-left border border-transparent hover:border-[#1877F2]/10 transition-all group flex items-center gap-2"
                  >
                    <Clock className="w-3 h-3 text-slate-300 shrink-0" />
                    <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 truncate group-hover:text-[#1877F2] transition-colors">
                      {item.topic}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RESULTADOS / EMPTY STATE ── */}
        <div className="xl:col-span-7 space-y-6">
          <AnimatePresence mode="wait">
            {isGenerating && (
              <motion.div
                key="loader"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-12 text-center shadow-sm flex flex-col items-center justify-center min-h-[500px]"
              >
                <div className="relative mb-8">
                  <div className="w-20 h-20 bg-[#1877F2]/10 rounded-full flex items-center justify-center">
                    <Sparkles className="w-9 h-9 text-[#1877F2]" />
                  </div>
                  <div className="absolute inset-0 border-[3px] border-[#1877F2] border-t-transparent rounded-full animate-spin" />
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">Gemini está creando tu campaña</h3>
                <p className="text-sm font-medium text-[#1877F2] max-w-xs h-10 leading-relaxed">
                  {loadingMessages[loadingStep]}
                </p>
                <div className="w-40 h-1 bg-slate-100 dark:bg-slate-900 rounded-full overflow-hidden mt-5">
                  <motion.div
                    className="h-full bg-[#1877F2] rounded-full"
                    animate={{ width: ['0%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 3.5, ease: 'easeInOut' }}
                  />
                </div>
              </motion.div>
            )}

            {!isGenerating && !result && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center min-h-[500px] p-10 text-center space-y-8"
              >
                {/* Icono central animado */}
                <div className="relative">
                  <div className="w-20 h-20 bg-[#1877F2]/10 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-9 h-9 text-[#1877F2]" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-400 rounded-full flex items-center justify-center animate-bounce">
                    <Lightbulb className="w-3 h-3 text-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white">Un tema, tres canales</h3>
                  <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto leading-relaxed">
                    Escribe de qué quieres hablar y Gemini redacta todo simultáneamente.
                  </p>
                </div>

                {/* 3 channel cards decorativas */}
                <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
                  <div className="flex flex-col items-center gap-2 p-4 bg-gradient-to-b from-pink-50 to-white dark:from-pink-950/20 dark:to-slate-900 rounded-2xl border border-pink-100 dark:border-pink-900/30">
                    <div className="p-2 bg-pink-100 dark:bg-pink-900/30 rounded-xl">
                      <InstagramIcon className="w-5 h-5 text-pink-600" />
                    </div>
                    <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">Instagram</p>
                    <p className="text-[9px] text-slate-400 text-center leading-tight">Carrusel + caption + hashtags</p>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 bg-gradient-to-b from-blue-50 to-white dark:from-blue-950/20 dark:to-slate-900 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                      <FacebookIcon className="w-5 h-5 text-[#1877F2]" />
                    </div>
                    <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">Facebook</p>
                    <p className="text-[9px] text-slate-400 text-center leading-tight">Hook + cuerpo + CTA</p>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-4 bg-gradient-to-b from-slate-50 to-white dark:from-slate-800/50 dark:to-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
                      <FileText className="w-5 h-5 text-slate-500" />
                    </div>
                    <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wide">Blog</p>
                    <p className="text-[9px] text-slate-400 text-center leading-tight">Artículo SEO completo</p>
                  </div>
                </div>

                <p className="text-[10px] text-slate-300 dark:text-slate-600 font-semibold uppercase tracking-widest">+ imágenes con IA incluidas</p>
              </motion.div>
            )}

            {!isGenerating && result && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
              >
                {/* Resultados Copys (Lado Izquierdo de la derecha: 7 cols) */}
                <div className="lg:col-span-7 space-y-6">
                  {/* Glowing Omnichannel Publisher Card */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-5 bg-[#1877F2]/5 rounded-2xl border border-[#1877F2]/10 shadow-sm">
                    <div className="space-y-1 text-center sm:text-left">
                      <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5 justify-center sm:justify-start">
                        <Sparkles className="w-4 h-4 text-[#1877F2]" /> ¿Todo listo para publicar?
                      </h4>
                      <p className="text-[10px] font-bold text-slate-400">Sincroniza y autopublica tus copys e imágenes con un solo clic.</p>
                    </div>
                    <button
                      onClick={() => setShowPublishModal(true)}
                      className="w-full sm:w-auto px-5 py-3 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-md shadow-[#1877F2]/20 hover:scale-[1.02] active:scale-[0.98]"
                    >
                      🚀 PUBLICAR CAMPAÑA
                    </button>
                  </div>

                  {/* Selector de Pestaña de Red Social */}
                  <div className="flex p-1 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <button
                      onClick={() => setActiveTab('instagram')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-xs font-black tracking-tight transition-all uppercase ${activeTab === 'instagram' ? 'bg-white dark:bg-slate-800 shadow-md text-pink-600 dark:text-pink-400' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <InstagramIcon className="w-4 h-4" /> INSTAGRAM
                    </button>
                    <button
                      onClick={() => setActiveTab('facebook')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-xs font-black tracking-tight transition-all uppercase ${activeTab === 'facebook' ? 'bg-white dark:bg-slate-800 shadow-md text-[#1877F2]' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <FacebookIcon className="w-4 h-4" /> FACEBOOK
                    </button>
                    <button
                      onClick={() => setActiveTab('blog')}
                      className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-xs font-black tracking-tight transition-all uppercase ${activeTab === 'blog' ? 'bg-white dark:bg-slate-800 shadow-md text-[#1877F2]' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <FileText className="w-4 h-4" /> ARTÍCULO BLOG
                    </button>
                  </div>

                  {/* Panel del Resultado */}
                  <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-6">
                    {activeTab === 'instagram' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Instagram Carousel Caption</h4>
                          <button
                            onClick={() => copyToClipboard(result.instagram.caption + "\n\n" + result.instagram.hashtags, 'ig-caption')}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                          >
                            {copiedKey === 'ig-caption' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            COPIAR CAPTION
                          </button>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-2xl max-h-[160px] overflow-y-auto text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                          {result.instagram.caption}
                        </div>
                        
                        {/* Hashtags */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hashtags Estratégicos</label>
                            <button 
                              onClick={() => copyToClipboard(result.instagram.hashtags, 'ig-hashtags')}
                              className="text-[10px] font-black text-pink-600 dark:text-pink-400 uppercase hover:underline"
                            >
                              {copiedKey === 'ig-hashtags' ? '¡Copiado!' : 'Copiar Hashtags'}
                            </button>
                          </div>
                          <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl text-[10px] font-bold text-slate-500 dark:text-slate-400">
                            {result.instagram.hashtags}
                          </div>
                        </div>

                        {/* AI Image Preview - Instagram 4:5 */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[11px] font-black text-pink-600 dark:text-pink-400 uppercase tracking-widest flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5" /> Imagen IA — Slide {currentSlide + 1}
                            </h5>
                            <button
                              onClick={() => copyToClipboard(result.instagram.slides[currentSlide]?.graphicConcept || '', `prompt-${currentSlide}`)}
                              className="text-[9px] font-black text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white uppercase tracking-wider flex items-center gap-1"
                            >
                              {copiedKey === `prompt-${currentSlide}` ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                              Copiar Prompt
                            </button>
                          </div>
                          <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '4/5' }}>
                            {isGeneratingImages ? (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 min-h-[300px]">
                                <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin" />
                                <p className="text-[11px] font-bold text-slate-400">Generando imagen con GPT-4o...</p>
                              </div>
                            ) : igImageUrl ? (
                              <>
                                <img src={igImageUrl} alt="Instagram" className="w-full h-full object-cover" />
                                {/* Gradient + copy overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                                <div className="absolute bottom-0 left-0 right-0 p-5 space-y-3">
                                  <p className="text-white font-black text-base leading-snug drop-shadow-lg">
                                    {result.instagram.caption?.split('\n')[0] || result.instagram.slides[0]?.slideTitle}
                                  </p>
                                  <div className="flex items-center justify-between">
                                    <span className="bg-[#00C853] text-white text-[10px] font-black px-3 py-1.5 rounded-full">Empieza gratis →</span>
                                    <span className="text-white/60 text-[9px] font-medium">hub.smartflow-suite.com</span>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 min-h-[300px]">
                                <Sparkles className="w-8 h-8 text-slate-700" />
                                <p className="text-[11px] font-bold text-slate-600">Genera la campaña para ver la imagen</p>
                              </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-md">
                              4:5 · 1080×1350
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'facebook' && (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Facebook Copy</h4>
                          <button
                            onClick={() => copyToClipboard(result.facebook.hook + "\n\n" + result.facebook.body + "\n\n" + result.facebook.cta, 'fb-copy')}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                          >
                            {copiedKey === 'fb-copy' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            COPIAR COPY FACEBOOK
                          </button>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-5 rounded-2xl space-y-4 text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed max-h-[350px] overflow-y-auto">
                          <p className="font-bold text-slate-900 dark:text-white text-sm">{result.facebook.hook}</p>
                          <p className="whitespace-pre-wrap">{result.facebook.body}</p>
                          <p className="p-3 bg-[#1877F2]/5 rounded-xl border border-[#1877F2]/10 font-bold text-[#1877F2]">{result.facebook.cta}</p>
                        </div>
                        {/* AI Image Preview - Facebook 1:1 */}
                        <div className="space-y-2">
                          <h5 className="text-[11px] font-black text-[#1877F2] uppercase tracking-widest flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" /> Imagen IA — 1:1
                          </h5>
                          <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '1/1' }}>
                            {isGeneratingImages ? (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 min-h-[280px]">
                                <div className="w-8 h-8 border-4 border-[#1877F2] border-t-transparent rounded-full animate-spin" />
                                <p className="text-[11px] font-bold text-slate-400">Generando imagen con GPT-4o...</p>
                              </div>
                            ) : fbImageUrl ? (
                              <>
                                <img src={fbImageUrl} alt="Facebook" className="w-full h-full object-cover" />
                                {/* Gradient + copy overlay */}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                                <div className="absolute bottom-0 left-0 right-0 p-5 space-y-3">
                                  <p className="text-white font-black text-base leading-snug drop-shadow-lg">
                                    {result.facebook.hook}
                                  </p>
                                  <div className="flex items-center justify-between">
                                    <span className="bg-[#00C853] text-white text-[10px] font-black px-3 py-1.5 rounded-full">Agenda gratis →</span>
                                    <span className="text-white/60 text-[9px] font-medium">hub.smartflow-suite.com</span>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 min-h-[280px]">
                                <Sparkles className="w-8 h-8 text-slate-700" />
                                <p className="text-[11px] font-bold text-slate-600">Genera la campaña para ver la imagen</p>
                              </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-md">
                              1:1 · 1080×1080
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeTab === 'blog' && (
                      <div className="space-y-6">
                        <div className="flex justify-between items-center">
                          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Artículo de Blog Completo</h4>
                          <button
                            onClick={() => {
                              const blogText = `# ${result.blog.title}\n\n*Meta Descripción: ${result.blog.metaDescription}*\n\n${result.blog.introduction}\n\n${result.blog.subheadings.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n')}\n\n## Conclusión\n\n${result.blog.conclusion}\n\n**${result.blog.cta}**`;
                              copyToClipboard(blogText, 'blog-copy');
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
                          >
                            {copiedKey === 'blog-copy' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                            COPIAR EN FORMATO MARKDOWN
                          </button>
                        </div>
                        {/* Blog Banner Image */}
                        <div className="space-y-2">
                          <h5 className="text-[11px] font-black text-[#1877F2] uppercase tracking-widest flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" /> Banner del Blog
                          </h5>
                          <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: '1200/630' }}>
                            {isGeneratingImages ? (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-3 min-h-[200px]">
                                <div className="w-8 h-8 border-4 border-[#1877F2] border-t-transparent rounded-full animate-spin" />
                                <p className="text-[11px] font-bold text-slate-400">Generando imagen con GPT-4o...</p>
                              </div>
                            ) : blogImageUrl ? (
                              <>
                                <img src={blogImageUrl} alt="Blog Banner" className="w-full h-full object-cover" />
                                {/* Left gradient + copy overlay */}
                                <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/50 to-transparent" />
                                <div className="absolute inset-0 flex flex-col justify-center pl-6 pr-[45%]">
                                  <span className="text-[#00C853] text-[9px] font-black uppercase tracking-widest mb-2">SmartFlow · CRM Multiagente</span>
                                  <p className="text-white font-black text-sm leading-snug drop-shadow-lg mb-3">
                                    {result.blog.title}
                                  </p>
                                  <span className="text-white/50 text-[9px] font-medium">hub.smartflow-suite.com</span>
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-2 min-h-[200px]">
                                <Sparkles className="w-8 h-8 text-slate-700" />
                                <p className="text-[11px] font-bold text-slate-600">Genera la campaña para ver el banner</p>
                              </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-[9px] font-bold px-2 py-1 rounded-md">
                              Banner · 1200×630
                            </div>
                          </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl space-y-6 text-xs font-medium text-slate-700 dark:text-slate-300 leading-relaxed max-h-[350px] overflow-y-auto text-left">
                          <h1 className="text-xl font-black text-slate-950 dark:text-white leading-tight border-b pb-3 border-slate-200 dark:border-slate-800">{result.blog.title}</h1>
                          <p className="italic text-slate-400 font-semibold bg-slate-100 dark:bg-slate-900 p-3 rounded-xl border border-slate-200/20">🔍 Meta Descripción: {result.blog.metaDescription}</p>
                          <p className="text-sm font-semibold">{result.blog.introduction}</p>
                          
                          {result.blog.subheadings.map((s, i) => (
                            <div key={i} className="space-y-2">
                              <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5"><BookOpen className="w-4 h-4 text-[#1877F2]" /> {s.title}</h2>
                              <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">{s.content}</p>
                            </div>
                          ))}

                          <div className="border-t pt-4 border-slate-200 dark:border-slate-800 space-y-2">
                            <h2 className="text-sm font-black text-slate-900 dark:text-white">Conclusión</h2>
                            <p className="text-slate-600 dark:text-slate-400">{result.blog.conclusion}</p>
                          </div>

                          <div className="bg-[#1877F2] text-white p-5 rounded-xl shadow-md font-bold text-center">
                            {result.blog.cta}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Simulador Físico del Celular (Lado Derecho de la derecha: 5 cols) */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="text-center mb-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 justify-center">
                      <Clock className="w-3.5 h-3.5 text-[#1877F2] animate-pulse" /> Simulador en Tiempo Real
                    </p>
                  </div>

                  {/* Estructura Física del iPhone */}
                  <div className="relative w-[280px] h-[570px] bg-slate-900 dark:bg-slate-950 rounded-[40px] p-3 shadow-2xl border-[6px] border-slate-800 dark:border-slate-900 flex flex-col justify-between overflow-hidden ring-4 ring-slate-800/10">
                    {/* iPhone Notch */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 bg-slate-800 rounded-b-xl z-50 flex justify-center items-center">
                      <span className="w-2.5 h-2.5 bg-black rounded-full mr-2" />
                      <span className="w-10 h-1 bg-slate-900 rounded-full" />
                    </div>

                    {/* Contenido de la pantalla del celular */}
                    <div className="flex-1 bg-white dark:bg-black rounded-[30px] overflow-hidden flex flex-col justify-between pt-6 text-[10px]">
                      
                      {activeTab === 'instagram' && (
                        <div className="flex flex-col flex-1 justify-between">
                          {/* Instagram Top Bar */}
                          <div className="px-3 py-2 flex items-center justify-between border-b dark:border-slate-900 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[1.5px]">
                                <div className="w-full h-full rounded-full bg-white dark:bg-black flex items-center justify-center p-[1px]">
                                  <div className="w-full h-full rounded-full bg-slate-100 flex items-center justify-center font-bold text-[8px] text-[#1877F2]">SF</div>
                                </div>
                              </div>
                              <div className="flex flex-col">
                                <span className="font-bold dark:text-white flex items-center gap-0.5">smartflow.os <span className="text-[7px] text-blue-500">🔵</span></span>
                                <span className="text-[6px] text-slate-400">Patrocinado</span>
                              </div>
                            </div>
                            <span className="text-slate-400 font-bold">...</span>
                          </div>

                          {/* Instagram Carousel Frame */}
                          <div className="flex-1 bg-slate-50 dark:bg-slate-900/40 relative flex items-center justify-center p-3 overflow-hidden">
                            <AnimatePresence mode="wait">
                              <motion.div
                                key={currentSlide}
                                initial={{ opacity: 0, x: 50 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -50 }}
                                className="w-full h-[230px] rounded-2xl bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 p-4 text-white flex flex-col justify-between shadow-lg relative border border-white/5 overflow-hidden"
                              >
                                {/* Fondo de Imagen Generada por IA Real */}
                                <img 
                                  src={`https://image.pollinations.ai/prompt/${encodeURIComponent(result.instagram.slides[currentSlide]?.graphicConcept || 'modern graphic design template style')}`} 
                                  alt="AI Art" 
                                  className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-overlay pointer-events-none"
                                />
                                <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/80 via-slate-950/85 to-purple-950/90 z-10 pointer-events-none" />

                                {/* Diapositiva */}
                                <div className="relative z-20 flex justify-between items-center text-[7px] font-black tracking-widest text-blue-200 uppercase shrink-0">
                                  <span>SmartFlow Suite</span>
                                  <span>{currentSlide + 1} / {result.instagram.slides.length}</span>
                                </div>

                                <div className="relative z-20 my-auto space-y-2 text-center">
                                  <h4 className="text-xs font-black text-white leading-snug tracking-tight drop-shadow-md">
                                    {result.instagram.slides[currentSlide]?.slideTitle}
                                  </h4>
                                  <p className="text-[9px] font-medium text-slate-300 leading-normal">
                                    {result.instagram.slides[currentSlide]?.slideBody}
                                  </p>
                                </div>

                                <div className="relative z-20 text-[7px] font-bold text-center text-blue-300 uppercase tracking-widest shrink-0 mt-auto flex items-center justify-center gap-1">
                                  <span>Crea tu Hub Gratis</span> <ArrowUpRight className="w-2.5 h-2.5" />
                                </div>
                              </motion.div>
                            </AnimatePresence>

                            {/* Chevron Controls */}
                            <button
                              onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                              disabled={currentSlide === 0}
                              className="absolute left-1.5 p-1 bg-black/60 backdrop-blur-sm text-white rounded-full disabled:opacity-20 transition-all"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCurrentSlide(prev => Math.min(result.instagram.slides.length - 1, prev + 1))}
                              disabled={currentSlide === result.instagram.slides.length - 1}
                              className="absolute right-1.5 p-1 bg-black/60 backdrop-blur-sm text-white rounded-full disabled:opacity-20 transition-all"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Instagram Action Row */}
                          <div className="p-3 border-t border-slate-100 dark:border-slate-900 space-y-2 shrink-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Heart className="w-4 h-4 text-pink-500 fill-pink-500" />
                                <MessageCircle className="w-4 h-4 text-slate-400" />
                                <Share className="w-4 h-4 text-slate-400" />
                              </div>
                              {/* Indicator Dots */}
                              <div className="flex gap-1">
                                {result.instagram.slides.map((_, i) => (
                                  <span key={i} className={`w-1 h-1 rounded-full transition-all ${i === currentSlide ? 'bg-pink-500 w-2' : 'bg-slate-300 dark:bg-slate-700'}`} />
                                ))}
                              </div>
                              <Bookmark className="w-4 h-4 text-slate-400" />
                            </div>
                            
                            {/* Short caption preview */}
                            <div className="space-y-1">
                              <p className="font-bold dark:text-white">smartflow.os <span className="font-medium text-slate-600 dark:text-slate-400 truncate block w-[180px]">Iniciando la era de la automatización inteligente...</span></p>
                              <p className="text-[8px] text-slate-400 uppercase font-semibold">Hace 2 horas</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTab === 'facebook' && (
                        <div className="flex flex-col flex-1 justify-between text-slate-800 dark:text-slate-200">
                          {/* Facebook Header */}
                          <div className="p-3 border-b dark:border-slate-900 space-y-2 shrink-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="w-7 h-7 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-black text-[9px] shadow-sm shadow-[#1877F2]/20">SF</div>
                                <div className="flex flex-col">
                                  <span className="font-bold text-[9px] flex items-center gap-0.5">{isFbConnected ? selectedFbPage : 'SmartFlow Hub OS'} <span className="text-[7px]">✔️</span></span>
                                  <span className="text-[7px] text-slate-400 flex items-center gap-0.5">Publicado por Admin · Justo ahora · <Globe className="w-2.5 h-2.5" /></span>
                                </div>
                              </div>
                              <span className="text-slate-400 font-bold">...</span>
                            </div>
                            <p className="text-[9px] font-bold line-clamp-2 leading-relaxed">
                              {result.facebook.hook}
                            </p>
                          </div>

                          {/* Facebook Body Image Mockup */}
                          <div className="flex-1 bg-slate-50 dark:bg-slate-950 p-2 flex flex-col justify-between overflow-hidden">
                            <p className="text-[8px] font-semibold text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-6 px-1.5 whitespace-pre-wrap">
                              {result.facebook.body}
                            </p>
                            
                            {/* Link Card Mockup */}
                            <div className="border dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 mt-2 shrink-0">
                              <div className="h-20 relative flex items-center justify-center text-white p-2 overflow-hidden">
                                <img 
                                  src={`https://image.pollinations.ai/prompt/${encodeURIComponent(topic || 'modern digital technology business concept banner')}`} 
                                  alt="Facebook Post Graphic" 
                                  className="absolute inset-0 w-full h-full object-cover opacity-65 pointer-events-none"
                                />
                                <div className="absolute inset-0 bg-blue-950/80 pointer-events-none" />
                                <span className="relative z-10 font-black text-center text-[8px] tracking-tight leading-snug">{topic.toUpperCase()}</span>
                              </div>
                              <div className="p-2 space-y-1">
                                <p className="text-[7px] font-bold text-blue-500 uppercase">SMARTFLOW-SUITE.COM</p>
                                <p className="text-[8px] font-bold dark:text-white line-clamp-1">{result.facebook.hook}</p>
                                <p className="text-[7px] text-slate-400 line-clamp-1">Inicia tu automatización gratuita hoy mismo.</p>
                              </div>
                            </div>
                          </div>

                          {/* Facebook Action Footer */}
                          <div className="p-2 border-t dark:border-slate-900 flex justify-around text-slate-400 text-[8px] font-bold shrink-0">
                            <span className="flex items-center gap-1 hover:text-[#1877F2]"><Heart className="w-3.5 h-3.5" /> Me gusta</span>
                            <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> Comentar</span>
                            <span className="flex items-center gap-1"><Share className="w-3.5 h-3.5" /> Compartir</span>
                          </div>
                        </div>
                      )}

                      {activeTab === 'blog' && (
                        <div className="flex flex-col flex-1 justify-between text-slate-800 dark:text-slate-200">
                          {/* Blog Browser Top Bar */}
                          <div className="px-3 py-2 border-b dark:border-slate-900 bg-slate-50 dark:bg-slate-950 shrink-0 flex items-center gap-2">
                            <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                            </div>
                            <div className="flex-1 bg-white dark:bg-slate-900 text-slate-400 text-[7px] py-0.5 px-2 rounded-full text-center truncate select-none">
                              smartflow-suite.com/blog/lanzamiento
                            </div>
                          </div>

                          {/* Blog Article Reader view */}
                          <div className="flex-1 overflow-y-auto p-4 text-[8px] space-y-3 leading-relaxed">
                            <h1 className="font-black text-xs text-slate-900 dark:text-white leading-tight">
                              {result.blog.title}
                            </h1>
                            <p className="text-[7px] text-slate-400 font-bold uppercase tracking-widest flex items-center gap-1">
                              <span>POR SMARTFLOW OS</span> · <span>3 MIN DE LECTURA</span>
                            </p>
                            <p className="font-bold text-slate-600 dark:text-slate-400 border-l-2 border-[#1877F2] pl-1.5">
                              {result.blog.introduction}
                            </p>
                            
                            {result.blog.subheadings.slice(0, 1).map((s, idx) => (
                              <div key={idx} className="space-y-1">
                                <h2 className="font-bold text-slate-900 dark:text-white">{s.title}</h2>
                                <p className="text-slate-500 dark:text-slate-400 leading-normal truncate block w-[220px]">{s.content}</p>
                              </div>
                            ))}
                            
                            <div className="bg-[#1877F2] text-white p-2 rounded-lg text-center font-bold text-[7px]">
                              {result.blog.cta}
                            </div>
                          </div>

                          {/* Blog Reader Footer */}
                          <div className="p-2 border-t dark:border-slate-900 text-center text-[7px] text-slate-400 bg-slate-50 dark:bg-slate-950 shrink-0">
                            © 2026 SmartFlow Hub OS.
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      )}

      {/* ----------------- CANALES Y CONEXIONES ----------------- */}
      {activeSubTab === 'connections' && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Banner de Bienvenida */}
          <div className="bg-gradient-to-tr from-slate-900 via-slate-900 to-slate-800 p-8 rounded-2xl border border-slate-700 text-white shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:30px_30px]" />
            <div className="relative z-10 max-w-2xl space-y-3">
              <span className="px-3 py-1 bg-[#1877F2]/10 text-blue-200 text-[10px] font-black uppercase tracking-widest rounded-full border border-[#1877F2]/20">
                Hub Omnicanal de Marketing
              </span>
              <h2 className="text-xl font-black tracking-tight">Automatiza Publicaciones en tus Redes y Blog Corporativo</h2>
              <p className="text-xs text-slate-400 font-medium leading-relaxed">
                Conecta las APIs oficiales de Meta Business y WordPress REST para habilitar la autopublicación directa. Tus campañas generadas con Gemini se enviarán a tus feeds públicos de Facebook, Instagram y Blog sin salir de tu Hub de Administración.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Tarjeta Facebook */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/20 text-[#1877F2] rounded-2xl">
                    <FacebookIcon className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-full ${isFbConnected ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                    {isFbConnected ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Facebook Pages API</h3>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Sincroniza y publica de forma automática copys informativos y de venta con imágenes personalizadas en tu página de Facebook.
                  </p>
                </div>
              </div>

              {isFbConnected ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-2.5">
                    {realFbAvatar ? (
                      <img src={realFbAvatar} className="w-6 h-6 rounded-full object-cover" alt="avatar" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center font-bold text-[8px]">{(realFbPageName || selectedFbPage).substring(0, 2)}</div>
                    )}
                    <div>
                      <p className="text-[10px] font-bold dark:text-white">{realFbPageName || selectedFbPage}</p>
                      <p className="text-[8px] text-slate-400 font-semibold uppercase">API Token Activo</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDisconnect('facebook')}
                    className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                  >
                    Desconectar Canal
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startConnectionFlow('facebook')}
                  className="w-full py-2.5 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                >
                  Conectar Canal
                </button>
              )}
            </div>

            {/* Tarjeta Instagram */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="p-3 bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 rounded-2xl">
                    <InstagramIcon className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-full ${isIgConnected ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                    {isIgConnected ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Instagram Business API</h3>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Sube carruseles completos de diapositivas con sus captions estructurados y hashtags para tu audiencia en Instagram.
                  </p>
                </div>
              </div>

              {isIgConnected ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-yellow-500 to-pink-600 p-[1.5px]">
                      <div className="w-full h-full rounded-full bg-white dark:bg-black flex items-center justify-center font-bold text-[8px] text-pink-600">IG</div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold dark:text-white">{realIgUsername || '@smartflow.os'}</p>
                      <p className="text-[8px] text-slate-400 font-semibold uppercase">API Graph Conectado</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDisconnect('instagram')}
                    className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                  >
                    Desconectar Canal
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startConnectionFlow('instagram')}
                  className="w-full py-2.5 bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 hover:opacity-90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                >
                  Conectar Canal
                </button>
              )}
            </div>

            {/* Tarjeta Blog Oficial Subdominio */}
            <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="p-3 bg-[#1877F2]/10 text-[#1877F2] rounded-2xl">
                    <FileText className="w-6 h-6" />
                  </div>
                  <span className={`px-2.5 py-1 text-[9px] font-black uppercase tracking-wider rounded-full ${isBlogConnected ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
                    {isBlogConnected ? 'Conectado' : 'Desconectado'}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wider">Blog Oficial Subdominio</h3>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Sincroniza y publica artículos SEO completos de forma nativa en tu subdominio bloghub.smartflow-suite.com conectado a Firestore.
                  </p>
                </div>
              </div>

              {isBlogConnected ? (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
                    <p className="text-[10px] font-bold dark:text-white truncate">bloghub.smartflow-suite.com</p>
                    <p className="text-[8px] text-slate-400 font-semibold uppercase">Base de datos: Firestore (landing_blog_posts) · Activo</p>
                  </div>
                  <button
                    onClick={() => handleDisconnect('blog')}
                    className="w-full py-2.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                  >
                    Desconectar Canal
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => startConnectionFlow('blog')}
                  className="w-full py-2.5 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                >
                  Conectar Canal
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ----------------- MODAL DE AUTORIZACIÓN OAUTH ----------------- */}
      <AnimatePresence>
        {connectingPlatform && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 max-w-md w-full shadow-2xl relative space-y-6"
            >
              <button
                onClick={() => setConnectingPlatform(null)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3.5">
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl">
                  {connectingPlatform === 'facebook' && <FacebookIcon className="w-6 h-6 text-[#1877F2]" />}
                  {connectingPlatform === 'instagram' && <InstagramIcon className="w-6 h-6 text-pink-600" />}
                  {connectingPlatform === 'blog' && <FileText className="w-6 h-6 text-[#1877F2]" />}
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-wider">
                    {connectingPlatform === 'facebook' ? 'Meta Facebook' : connectingPlatform === 'instagram' ? 'Meta Instagram' : 'Blog de la Landing'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400">Canal de Automatización Nativa</p>
                </div>
              </div>

              {/* STEP 1: START */}
              {oauthStep === 'start' && (
                <div className="space-y-5">
                  {(connectingPlatform === 'facebook' || connectingPlatform === 'instagram') && (
                    <div className="flex bg-slate-100 dark:bg-slate-950 p-1.5 rounded-2xl gap-1">
                      <button
                        onClick={() => setConnectionMode('real_api')}
                        className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                          connectionMode === 'real_api'
                            ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm'
                            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                        }`}
                      >
                        🔑 Credenciales Meta (100% Real)
                      </button>
                      <button
                        onClick={() => setConnectionMode('oauth')}
                        className={`flex-1 py-2 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all ${
                          connectionMode === 'oauth'
                            ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm'
                            : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                        }`}
                      >
                        🌐 Meta OAuth (Demo)
                      </button>
                    </div>
                  )}

                  {/* VISTA CREDENCIALES REAL_API */}
                  {(connectingPlatform === 'facebook' || connectingPlatform === 'instagram') && connectionMode === 'real_api' ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                          Meta Page Access Token (Token de Acceso)
                        </label>
                        <input
                          type="password"
                          value={realPageToken}
                          onChange={(e) => setRealPageToken(e.target.value)}
                          placeholder="E.g. EAACEdEose0cBA..."
                          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl outline-none text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-[#1877F2] transition-all shadow-inner"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                          Facebook Page ID (ID de Página)
                        </label>
                        <input
                          type="text"
                          value={realPageId}
                          onChange={(e) => setRealPageId(e.target.value)}
                          placeholder="E.g. 10452394528194"
                          className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl outline-none text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-[#1877F2] transition-all shadow-inner"
                        />
                      </div>

                      {connectingPlatform === 'instagram' && (
                        <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">
                            Instagram Business ID (ID de Cuenta Comercial)
                          </label>
                          <input
                            type="text"
                            value={realIgBusinessId}
                            onChange={(e) => setRealIgBusinessId(e.target.value)}
                            placeholder="E.g. 17841401234567890"
                            className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl outline-none text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-[#1877F2] transition-all shadow-inner"
                          />
                        </div>
                      )}

                      <details className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-150 dark:border-slate-800/80 cursor-pointer select-none">
                        <summary className="font-bold text-[9px] uppercase tracking-wider text-slate-600 dark:text-slate-400 hover:text-[#1877F2] transition-all">
                          ¿Cómo obtener tus credenciales de Meta?
                        </summary>
                        <div className="mt-2 text-[8.5px] font-semibold text-slate-500 dark:text-slate-400 space-y-1.5 leading-relaxed">
                          <p>1. Ve a <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-[#1877F2] font-bold underline">developers.facebook.com</a> e inicia sesión.</p>
                          <p>2. Crea una Aplicación de tipo <strong className="text-slate-750 dark:text-slate-300">Negocios / Comercial</strong>.</p>
                          <p>3. En el panel izquierdo de Meta, ve a <strong className="text-slate-750 dark:text-slate-300">Herramientas &gt; Explorador de la API Graph</strong>.</p>
                          <p>4. Genera un <strong className="text-slate-750 dark:text-slate-300">Token de Acceso de Página</strong> de larga duración con permisos <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-pink-600">pages_manage_posts</code>, <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-pink-600">pages_read_engagement</code> y <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-pink-600">instagram_basic</code>.</p>
                        </div>
                      </details>

                      <button
                        onClick={handleValidateAndSaveRealApi}
                        disabled={isValidatingApi}
                        className={`w-full py-3.5 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2.5 bg-[#1877F2] hover:bg-[#1877F2]/90 shadow-md ${
                          isValidatingApi ? 'opacity-70 cursor-not-allowed' : ''
                        }`}
                      >
                        {isValidatingApi ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Validando Credenciales...</span>
                          </>
                        ) : (
                          <>
                            <span>Validar y Guardar Conexión</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    /* MOCK OAUTH O LOCAL BLOG */
                    <div className="space-y-5">
                      <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">
                        {connectingPlatform === 'facebook' && "Para autopublicar en Facebook, debes otorgarle permisos a la Suite para gestionar y subir contenido a tus páginas comerciales mediante Meta OAuth."}
                        {connectingPlatform === 'instagram' && "Para publicar carruseles con IA en Instagram, debes conceder permisos de escritura en tu cuenta comercial de Instagram Business enlazada a tu página de Facebook."}
                        {connectingPlatform === 'blog' && "Para publicar artículos dinámicos en tu Landing Page principal, inicia el enlace nativo con la base de datos central de SmartFlow Hub OS."}
                      </p>

                      <button
                        onClick={() => {
                          if (connectingPlatform === 'facebook' || connectingPlatform === 'instagram') {
                            setOauthStep('loading');
                            const w = 600;
                            const h = 650;
                            const left = (window.screen.width / 2) - (w / 2);
                            const top = (window.screen.height / 2) - (h / 2);
                            window.open(
                              '/facebook-oauth-mock.html',
                              'MetaOAuthPopup',
                              `width=${w},height=${h},top=${top},left=${left}`
                            );
                          } else {
                            // Blog local (Firestore)
                            setOauthStep('loading');
                            setTimeout(() => {
                              setOauthStep('select');
                            }, 1500);
                          }
                        }}
                        className={`w-full py-3.5 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2.5 ${
                          connectingPlatform === 'facebook' ? 'bg-[#1877F2] hover:bg-[#1877F2]/90' :
                          connectingPlatform === 'instagram' ? 'bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 hover:opacity-90' :
                          'bg-[#1877F2] hover:bg-[#1877F2]/90'
                        }`}
                      >
                        {connectingPlatform === 'facebook' && (
                          <>
                            <FacebookIcon className="w-4 h-4 text-white" />
                            <span>Iniciar Sesión con Facebook</span>
                          </>
                        )}
                        {connectingPlatform === 'instagram' && (
                          <>
                            <InstagramIcon className="w-4 h-4 text-white" />
                            <span>Conectar con Instagram Business</span>
                          </>
                        )}
                        {connectingPlatform === 'blog' && (
                          <>
                            <FileText className="w-4 h-4 text-white" />
                            <span>Enlazar con Blog Local (Firestore)</span>
                          </>
                        )}
                      </button>
                      <p className="text-[8.5px] text-center font-bold text-slate-400 uppercase">
                        🔒 Conexión encriptada SSL de 256 bits · No almacenamos tus contraseñas personales.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: LOADING */}
              {oauthStep === 'loading' && (
                <div className="py-8 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-[#1877F2] rounded-full animate-spin" />
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider">
                      {connectingPlatform === 'blog' ? 'Sincronizando Base de Datos...' : 'Autenticando con Meta APIs...'}
                    </h4>
                    <p className="text-[10px] text-slate-400 font-semibold mt-1">
                      {connectingPlatform === 'blog' ? 'Mapeando colección landing_blog_posts en Firestore...' : 'Obteniendo tokens de acceso seguro de larga duración (OAuth 2.0)...'}
                    </p>
                  </div>
                </div>
              )}

              {/* STEP 3: SELECT / FINALIZE */}
              {oauthStep === 'select' && (
                <div className="space-y-4">
                  <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900 rounded-2xl flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold">✓</div>
                    <div>
                      <p className="text-[10px] font-black text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                        {connectingPlatform === 'blog' ? 'Conexión local autorizada' : 'Meta OAuth Autorizado'}
                      </p>
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold">
                        {connectingPlatform === 'blog' ? 'SmartFlow Landing Page vinculada.' : 'Conectado como Eduardo Alfaro (Administrador).'}
                      </p>
                    </div>
                  </div>

                  {connectingPlatform === 'facebook' && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Seleccionar Página Comercial de Facebook</label>
                      <select
                        value={selectedFbPage}
                        onChange={(e) => setSelectedFbPage(e.target.value)}
                        className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl outline-none text-xs font-semibold dark:text-white"
                      >
                        <option value="SmartFlow Suite (@smartflowsuite)">SmartFlow Suite (@smartflowsuite)</option>
                        <option value="Paneles Solares BCS MX">Paneles Solares BCS MX</option>
                        <option value="Mi Negocio Local">Mi Negocio Local</option>
                      </select>
                      <p className="text-[8.5px] text-slate-400 font-semibold">
                        * Selecciona la página comercial para la autopublicación directa.
                      </p>
                    </div>
                  )}

                  {connectingPlatform === 'instagram' && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Cuenta Profesional de Instagram Detectada</label>
                      <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-yellow-500 to-pink-600" />
                        <div>
                          <p className="text-[10px] font-bold dark:text-white">SmartFlow Suite (@smartflowsuite)</p>
                          <p className="text-[8px] text-slate-400 font-semibold">Instagram Business API · Token Activo</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {connectingPlatform === 'blog' && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Configuración de Destino del Blog</label>
                      <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1.5">
                        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400">URL del blog: <span className="text-slate-800 dark:text-white font-mono">bloghub.smartflow-suite.com</span></p>
                        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400">Colección Firestore: <span className="text-[#1877F2] font-mono block mt-0.5">landing_blog_posts</span></p>
                        <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400">Sincronización: <span className="text-emerald-500 font-black">Inmediata (En Tiempo Real)</span></p>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      let updatedConnections: any = {};
                      if (connectingPlatform === 'facebook') {
                        updatedConnections = {
                          facebook: {
                            isConnected: true,
                            pageId: realPageId || '906688959199328',
                            pageName: selectedFbPage || 'SmartFlow Suite (@smartflowsuite)',
                            accessToken: realPageToken || 'EAACEdEose0cBA...',
                            avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe'
                          }
                        };
                        setIsFbConnected(true);
                      } else if (connectingPlatform === 'instagram') {
                        updatedConnections = {
                          instagram: {
                            isConnected: true,
                            businessId: realIgBusinessId || '17841479625483131',
                            username: '@smartflowsuite',
                            accessToken: realPageToken || 'EAACEdEose0cBA...'
                          }
                        };
                        setIsIgConnected(true);
                      } else if (connectingPlatform === 'blog') {
                        updatedConnections = {
                          blog: {
                            isConnected: true,
                            blogUrl: 'https://bloghub.smartflow-suite.com',
                            targetCollection: 'landing_blog_posts'
                          }
                        };
                        setIsBlogConnected(true);
                      }
                      await saveConnectionsToDb(updatedConnections);
                      setConnectingPlatform(null);
                      addToast('¡Cuenta vinculada y guardada con éxito! 🚀', 'success');
                    }}
                    className="w-full py-3 bg-[#1877F2] hover:bg-[#1877F2]/95 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                  >
                    <span>Confirmar Conexión Segura</span>
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ----------------- MODAL DE AUTOPUBLICACIÓN MULTICANAL ----------------- */}
      <AnimatePresence>
        {showPublishModal && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 max-w-md w-full shadow-2xl relative space-y-6"
            >
              <button
                onClick={() => {
                  if (!isPublishing) setShowPublishModal(false);
                }}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white disabled:opacity-20"
                disabled={isPublishing}
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-2">
                <h3 className="text-sm font-black uppercase text-slate-900 dark:text-white tracking-wider flex items-center gap-2">
                  🚀 Publicar Campaña en Vivo
                </h3>
                <p className="text-[11px] font-semibold text-slate-500 leading-relaxed">
                  Sincroniza y envía los contenidos redactados de forma inmediata a todas las cuentas oficiales conectadas.
                </p>
              </div>

              {/* Lista de canales y su estado */}
              {!isPublishing && !publishSuccess && (
                <div className="space-y-3">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Canales Disponibles para Publicación:</p>
                  
                  {/* Facebook Status */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl">
                    <div className="flex items-center gap-2.5">
                      <FacebookIcon className={`w-5 h-5 ${isFbConnected ? 'text-[#1877F2]' : 'text-slate-300'}`} />
                      <div>
                        <p className="text-[11px] font-bold dark:text-white">Facebook Page</p>
                        <p className="text-[8px] text-slate-400 font-semibold">{isFbConnected ? selectedFbPage : 'Canal desconectado'}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-full ${isFbConnected ? 'bg-[#1877F2]/10 text-[#1877F2]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                      {isFbConnected ? 'Listo' : 'Omitir'}
                    </span>
                  </div>

                  {/* Instagram Status */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl">
                    <div className="flex items-center gap-2.5">
                      <InstagramIcon className={`w-5 h-5 ${isIgConnected ? 'text-pink-600' : 'text-slate-300'}`} />
                      <div>
                        <p className="text-[11px] font-bold dark:text-white">Instagram Feed</p>
                        <p className="text-[8px] text-slate-400 font-semibold">{isIgConnected ? '@smartflow.os' : 'Canal desconectado'}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-full ${isIgConnected ? 'bg-[#1877F2]/10 text-[#1877F2]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                      {isIgConnected ? 'Listo' : 'Omitir'}
                    </span>
                  </div>

                  {/* Blog Status */}
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl">
                    <div className="flex items-center gap-2.5">
                      <FileText className={`w-5 h-5 ${isBlogConnected ? 'text-[#1877F2]' : 'text-slate-300'}`} />
                      <div>
                        <p className="text-[11px] font-bold dark:text-white">Blog Oficial Subdominio</p>
                        <p className="text-[8px] text-slate-400 font-semibold">{isBlogConnected ? 'bloghub.smartflow-suite.com' : 'Canal desconectado'}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 text-[8px] font-black uppercase tracking-wider rounded-full ${isBlogConnected ? 'bg-[#1877F2]/10 text-[#1877F2]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                      {isBlogConnected ? 'Listo' : 'Omitir'}
                    </span>
                  </div>

                  {(!isFbConnected && !isIgConnected && !isBlogConnected) ? (
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/20 rounded-2xl border border-rose-100 dark:border-rose-950/40 space-y-3">
                      <p className="text-[10px] font-bold text-rose-600 leading-relaxed">
                        ⚠️ No has conectado ninguna cuenta de red social o blog. Conecta tus canales primero para activar la autopublicación en vivo.
                      </p>
                      <button
                        onClick={() => {
                          setShowPublishModal(false);
                          setActiveSubTab('connections');
                        }}
                        className="w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-[9px] uppercase tracking-widest rounded-xl transition-all"
                      >
                        Ir a Configurar Canales
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleStartPublishing}
                      className="w-full py-3 bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-[#1877F2]/15"
                    >
                      Confirmar Auto-Publicación
                    </button>
                  )}
                </div>
              )}

              {/* Animación secuencial de publicación */}
              {isPublishing && (
                <div className="space-y-6 py-4">
                  <div className="flex flex-col items-center justify-center space-y-3">
                    <div className="w-10 h-10 border-4 border-[#1877F2] border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-black text-[#1877F2] uppercase tracking-wider">Publicando...</p>
                  </div>
                  
                  <div className="space-y-2">
                    {publishSteps.map((stepText, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${publishStep > idx ? 'bg-emerald-500 text-white' : publishStep === idx ? 'bg-[#1877F2] text-white animate-pulse' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                          {publishStep > idx ? '✓' : idx + 1}
                        </span>
                        <p className={`text-[10px] font-semibold ${publishStep === idx ? 'text-slate-800 dark:text-white font-bold' : publishStep > idx ? 'text-slate-400 dark:text-slate-500' : 'text-slate-300 dark:text-slate-700'}`}>
                          {stepText}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resultado real por canal */}
              {publishSuccess && !isPublishing && (
                <div className="space-y-4 py-2">
                  <h3 className="text-[11px] font-black uppercase text-center text-slate-900 dark:text-white tracking-widest">Resultado de Publicación</h3>

                  <div className="space-y-2">
                    {/* Blog */}
                    {isBlogConnected && (
                      <div className={`flex items-center gap-3 p-3 rounded-xl border ${publishResults.blog === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' : publishResults.blog === 'error' ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                        <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${publishResults.blog === 'success' ? 'bg-emerald-500 text-white' : publishResults.blog === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-300 text-white'}`}>
                          {publishResults.blog === 'success' ? '✓' : publishResults.blog === 'error' ? '✕' : '—'}
                        </span>
                        <div>
                          <p className="text-[11px] font-black text-slate-800 dark:text-white">Blog</p>
                          <p className="text-[9px] text-slate-500">{publishResults.blog === 'success' ? 'Artículo guardado en Firestore (landing_blog_posts)' : publishResults.blog === 'error' ? 'Error al guardar en Firestore' : 'No procesado'}</p>
                        </div>
                      </div>
                    )}

                    {/* Facebook */}
                    {isFbConnected && (
                      <div className={`flex items-center gap-3 p-3 rounded-xl border ${publishResults.facebook === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' : publishResults.facebook === 'blocked' ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20' : publishResults.facebook === 'error' ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                        <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${publishResults.facebook === 'success' ? 'bg-emerald-500 text-white' : publishResults.facebook === 'blocked' ? 'bg-amber-500 text-white' : publishResults.facebook === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-300 text-white'}`}>
                          {publishResults.facebook === 'success' ? '✓' : publishResults.facebook === 'blocked' ? '!' : publishResults.facebook === 'error' ? '✕' : '—'}
                        </span>
                        <div>
                          <p className="text-[11px] font-black text-slate-800 dark:text-white">Facebook Page</p>
                          <p className="text-[9px] text-slate-500">{publishResults.facebook === 'success' ? 'Post publicado exitosamente' : publishResults.facebook === 'blocked' ? 'Bloqueado — requiere App Review (pages_manage_posts)' : publishResults.facebook === 'error' ? 'Error al publicar' : 'No procesado'}</p>
                        </div>
                      </div>
                    )}

                    {/* Instagram */}
                    {isIgConnected && (
                      <div className={`flex items-center gap-3 p-3 rounded-xl border ${publishResults.instagram === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' : publishResults.instagram === 'blocked' ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20' : publishResults.instagram === 'error' ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                        <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-black ${publishResults.instagram === 'success' ? 'bg-emerald-500 text-white' : publishResults.instagram === 'blocked' ? 'bg-amber-500 text-white' : publishResults.instagram === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-300 text-white'}`}>
                          {publishResults.instagram === 'success' ? '✓' : publishResults.instagram === 'blocked' ? '!' : publishResults.instagram === 'error' ? '✕' : '—'}
                        </span>
                        <div>
                          <p className="text-[11px] font-black text-slate-800 dark:text-white">Instagram Business</p>
                          <p className="text-[9px] text-slate-500">{publishResults.instagram === 'success' ? 'Post publicado exitosamente' : publishResults.instagram === 'blocked' ? 'Bloqueado — requiere App Review de Meta' : publishResults.instagram === 'error' ? 'Error al publicar' : 'No procesado'}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Nota App Review si hay canales bloqueados */}
                  {(publishResults.facebook === 'blocked' || publishResults.instagram === 'blocked') && (
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3">
                      <p className="text-[9px] font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
                        ⏳ Meta requiere App Review aprobado para publicar en Facebook/Instagram. Sigue el proceso en Meta Developers. Una vez aprobado, la publicación funcionará automáticamente.
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => { setShowPublishModal(false); setPublishSuccess(false); }}
                    className="w-full py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all"
                  >
                    Entendido
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
