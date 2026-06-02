import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuoteStore } from '@/stores/quoteStore';
import { useLeadStore } from '@/stores/leadStore';
import { usePackageStore } from '@/stores/packageStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { Quote, QuoteStatus, CatalogItem } from '@/types';
import { QuoteService } from '@/services/firebase/QuoteService';
import { CatalogService } from '@/services/firebase/CatalogService';
import { 
  Plus, FileText, ChevronLeft, Save, EyeOff, Send, FolderOpen, Loader2, 
  AlertCircle, MessageCircle, Trash2, Tag, Layers, RefreshCw, Info
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import { QuotePdfTemplate } from './QuotePdfTemplate';

export const getCurrencySymbol = (currencyCode?: string) => {
  switch (currencyCode) {
    case 'CRC': return '₡';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'JPY': return '¥';
    case 'CHF': return 'CHF';
    case 'BRL': return 'R$';
    default: return '$';
  }
};

const CURRENCIES = [
  { code: 'MXN', name: 'Peso Mexicano (MXN)' },
  { code: 'USD', name: 'Dólar Estadounidense (USD)' },
  { code: 'EUR', name: 'Euro (EUR)' },
  { code: 'CRC', name: 'Colón Costarricense (CRC)' },
  { code: 'COP', name: 'Peso Colombiano (COP)' },
  { code: 'PEN', name: 'Sol Peruano (PEN)' },
  { code: 'CLP', name: 'Peso Chileno (CLP)' },
  { code: 'ARS', name: 'Peso Argentino (ARS)' },
  { code: 'BRL', name: 'Real Brasileño (BRL)' },
  { code: 'GTQ', name: 'Quetzal Guatemalteco (GTQ)' },
  { code: 'HNL', name: 'Lempira Hondureño (HNL)' },
  { code: 'NIO', name: 'Córdoba Nicaragüense (NIO)' },
  { code: 'DOP', name: 'Peso Dominicano (DOP)' },
  { code: 'VES', name: 'Bolívar Venezolano (VES)' },
  { code: 'BOB', name: 'Boliviano (BOB)' },
  { code: 'PYG', name: 'Guaraní Paraguayo (PYG)' },
  { code: 'UYU', name: 'Peso Uruguayo (UYU)' },
  { code: 'CAD', name: 'Dólar Canadiense (CAD)' },
  { code: 'GBP', name: 'Libra Esterlina (GBP)' },
  { code: 'CHF', name: 'Franco Suizo (CHF)' },
  { code: 'JPY', name: 'Yen Japonés (JPY)' },
  { code: 'AUD', name: 'Dólar Australiano (AUD)' }
];

const INDUSTRY_PRESETS = [
  {
    niche: 'Bienes Raíces',
    name: 'Comisión y Honorarios de Venta Inmobiliaria',
    clientType: 'Comercial' as const,
    currency: 'USD',
    items: [
      { id: '1', description: 'Comisión de Corretaje e Intermediación (5%)', quantity: 1, rate: 12500, amount: 12500 },
      { id: '2', description: 'Gastos Notariales, Inscripción y Registro', quantity: 1, rate: 3200, amount: 3200 },
      { id: '3', description: 'Estudio de Avalúo y Dictamen Comercial', quantity: 1, rate: 800, amount: 800 }
    ],
    remarks: 'Forma de pago: 50% al contrato de promesa de compraventa, 50% a la firma de escritura pública.'
  },
  {
    niche: 'Venta de Autos',
    name: 'Cotización Sedán Familiar Premium',
    clientType: 'Comercial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Vehículo Sedán Motor 1.6T Transmisión Automática', quantity: 1, rate: 420000, amount: 420000 },
      { id: '2', description: 'Seguro de Cobertura Amplia Primer Año', quantity: 1, rate: 14500, amount: 14500 },
      { id: '3', description: 'Gastos de Gestoría de Trámite de Placas y Registro', quantity: 1, rate: 3500, amount: 3500 }
    ],
    remarks: 'Vigencia sujeta a disponibilidad de inventario físico en concesionaria.'
  },
  {
    niche: 'Repuestos / Refacciones',
    name: 'Kit de Balatas y Rectificado de Discos',
    clientType: 'Residencial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Balatas Cerámicas Delanteras de Alta Resistencia', quantity: 1, rate: 1850, amount: 1850 },
      { id: '2', description: 'Líquido de Frenos Sintético Dot-4', quantity: 2, rate: 250, amount: 500 },
      { id: '3', description: 'Rectificado de Discos y Mano de Obra de Instalación', quantity: 1, rate: 1200, amount: 1200 }
    ],
    remarks: 'Garantía por escrito de 6 meses o 10,000 km en balatas y discos rectificados.'
  },
  {
    niche: 'Paneles Solares',
    name: 'Sistema Fotovoltaico Residencial 4.4 kWp',
    clientType: 'Residencial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Módulos Fotovoltaicos Monocristalinos 550W (Tier 1)', quantity: 8, rate: 8500, amount: 68000 },
      { id: '2', description: 'Microinversor Interconectado Hoymiles 1500W', quantity: 2, rate: 9500, amount: 19000 },
      { id: '3', description: 'Estructura Coplanar de Aluminio Anodizado e Ingeniería', quantity: 1, rate: 8000, amount: 8000 }
    ],
    remarks: 'Precios netos con IVA. Incluye trámites ante CFE e interconexión formal de medidor bidireccional.'
  },
  {
    niche: 'Agencia de Marketing',
    name: 'Estrategia Digital Integral Semestral',
    clientType: 'Comercial' as const,
    currency: 'USD',
    items: [
      { id: '1', description: 'Diseño de Identidad Corporativa y Branding Manual', quantity: 1, rate: 1500, amount: 1500 },
      { id: '2', description: 'Gestión Redes Sociales y Creación de Contenido (Mensual)', quantity: 6, rate: 650, amount: 3900 },
      { id: '3', description: 'Configuración y Optimización Campañas de Google Ads & Meta', quantity: 1, rate: 500, amount: 500 }
    ],
    remarks: 'Vigencia de cotización por 30 días. No incluye presupuesto de inversión publicitaria directa.'
  },
  {
    niche: 'Construcción / Obra',
    name: 'Suministro de Cemento y Mano de Obra Obra Gris',
    clientType: 'Residencial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Suministro de Cemento y Acero de Refuerzo para Loza', quantity: 1, rate: 45000, amount: 45000 },
      { id: '2', description: 'Mano de Obra Calificada Albañilería e Instalaciones', quantity: 1, rate: 35000, amount: 35000 },
      { id: '3', description: 'Acabados Finos de Yeso y Plaste en Muros', quantity: 1, rate: 18000, amount: 18000 }
    ],
    remarks: 'Forma de pago: Anticipo 40%, Estimaciones semanales contra avance físico de obra.'
  },
  {
    niche: 'Servicios de Consultoría',
    name: 'Auditoría Corporativa de Procesos Organizacionales',
    clientType: 'Industrial' as const,
    currency: 'USD',
    items: [
      { id: '1', description: 'Fase 1: Diagnóstico Operativo y Mapeo de Procesos', quantity: 1, rate: 3500, amount: 3500 },
      { id: '2', description: 'Fase 2: Taller de Liderazgo Agile y Clima Laboral (x2)', quantity: 2, rate: 1200, amount: 2400 },
      { id: '3', description: 'Fase 3: Soporte y Consultoría Post-Auditoría (Soporte)', quantity: 1, rate: 2000, amount: 2000 }
    ],
    remarks: 'Incluye reporte final digital de áreas de oportunidad y plan detallado de remediación.'
  },
  {
    niche: 'Desarrollo de Software',
    name: 'Desarrollo de Aplicación Móvil MVP',
    clientType: 'Comercial' as const,
    currency: 'USD',
    items: [
      { id: '1', description: 'Diseño UX/UX, Prototipo Figma Interactivo', quantity: 1, rate: 2400, amount: 2400 },
      { id: '2', description: 'Backend Node.js & Configuración de Base de Datos Cloud', quantity: 1, rate: 4800, amount: 4800 },
      { id: '3', description: 'Frontend React Native App (Compilación iOS y Android)', quantity: 1, rate: 6500, amount: 6500 }
    ],
    remarks: 'Soporte y mantenimiento de fallas gratuito por 60 días tras publicación oficial.'
  },
  {
    niche: 'Eventos y Banquetes',
    name: 'Servicio de Catering Premium para Eventos',
    clientType: 'Comercial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Alquiler de Salón Climatizado (Servicio 6 Horas)', quantity: 1, rate: 25000, amount: 25000 },
      { id: '2', description: 'Menú Formal Gourmet de 3 Tiempos (P/Persona)', quantity: 150, rate: 450, amount: 67500 },
      { id: '3', description: 'Cabina Sonido, DJ e Iluminación Robótica Led', quantity: 1, rate: 12000, amount: 12000 }
    ],
    remarks: 'Vigencia sujeta a reservación con el 30% de anticipo del valor total.'
  },
  {
    niche: 'Membresías Gym',
    name: 'Plan Anual Corporativo Multi-Acceso',
    clientType: 'Comercial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Acceso Completo Anual Todo Incluido (x20 pases)', quantity: 20, rate: 4800, amount: 96000 },
      { id: '2', description: 'Asesoría Nutricional Personalizada Trimestral', quantity: 20, rate: 600, amount: 12000 },
      { id: '3', description: 'Estudio de Composición InBody Mensual', quantity: 12, rate: 250, amount: 3000 }
    ],
    remarks: 'Precio corporativo especial por convenio empresarial directo.'
  },
  {
    niche: 'Clínica / Estética',
    name: 'Tratamiento de Rejuvenecimiento Facial Profundo',
    clientType: 'Residencial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Sesión de Limpieza e Hidratación Facial Profunda', quantity: 3, rate: 1200, amount: 3600 },
      { id: '2', description: 'Aplicación Facial Aparatología Microdermoabrasión', quantity: 3, rate: 1800, amount: 5400 },
      { id: '3', description: 'Kit de Cremas Dermocosméticas de Cuidado Diario', quantity: 1, rate: 2450, amount: 2450 }
    ],
    remarks: 'Se recomienda agendar citas de tratamiento con al menos 48 horas de anticipación.'
  },
  {
    niche: 'Seguridad / Monitoreo',
    name: 'Kit de Monitoreo CCTV Residencial HD',
    clientType: 'Residencial' as const,
    currency: 'MXN',
    items: [
      { id: '1', description: 'Kit de 4 Cámaras IP HD 1080p y NVR Grabador', quantity: 1, rate: 6500, amount: 6500 },
      { id: '2', description: 'Instalación Física, Cableado y Configuración App', quantity: 1, rate: 3200, amount: 3200 },
      { id: '3', description: 'Suscripción Monitoreo y Soporte Remoto (Anual)', quantity: 1, rate: 4500, amount: 4500 }
    ],
    remarks: 'Requiere conexión activa a Internet de banda ancha estable para monitoreo remoto en tiempo real.'
  }
];

export const QuotesListView = () => {
  const { quotes, createQuote, updateQuoteStatus, subscribe: subscribeQuotes, isLoading, error } = useQuoteStore();
  const { leads, subscribe: subscribeLeads } = useLeadStore();
  const { packages, subscribe: subscribePackages } = usePackageStore();
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const { subscribe: subscribeSettings, isLoading: settingsLoading, ...settings } = useSettingsStore();
  const { teamMembers, subscribe: subscribeUsers } = useUserStore();
  const navigate = useNavigate();

  const [viewState, setViewState] = useState<'list' | 'create' | 'preview'>('list');
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { deleteQuote } = useQuoteStore();

  // Catalog integrations
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [activePresetIndex, setActivePresetIndex] = useState<string>('none');
  const [showCatalogSuggestionsIndex, setShowCatalogSuggestionsIndex] = useState<number>(-1);
  const [suggestionsList, setSuggestionsList] = useState<CatalogItem[]>([]);

  // Form State
  const [formData, setFormData] = useState<Partial<Quote>>({
    quoteNumber: '',
    date: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
    clientType: 'Residencial',
    status: 'borrador',
    currency: 'MXN',
    items: [],
    subtotal: 0,
    discount: 0,
    taxes: 0,
    total: 0,
    remarks: 'Precios sujetos a cambio sin previo aviso. Esta cotización tiene una vigencia de 15 días.',
  });

  // Synchronize currency with settings once settings are loaded
  useEffect(() => {
    if (settings.commercial?.currency) {
      setFormData(prev => {
        if (!prev.quoteNumber) { // Initial blank state before initCreate is called
          return {
            ...prev,
            currency: settings.commercial?.currency || 'MXN'
          };
        }
        return prev;
      });
    }
  }, [settings.commercial?.currency]);

  const [selectedPackageId, setSelectedPackageId] = useState<string>('');

  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribeQuotes = subscribeQuotes(activeMembership.tenantId);
      const unsubscribeLeads = subscribeLeads(activeMembership.tenantId);
      const unsubscribeSettings = subscribeSettings(activeMembership.tenantId);
      const unsubscribeUsers = subscribeUsers(activeMembership.tenantId);
      const unsubscribePackages = subscribePackages(activeMembership.tenantId);

      const unsubscribeCatalog = CatalogService.subscribeToCatalog(activeMembership.tenantId, (items) => {
        setCatalogItems(items);
      });

      return () => {
        unsubscribeQuotes();
        unsubscribeLeads();
        unsubscribeSettings();
        unsubscribeUsers();
        unsubscribePackages();
        unsubscribeCatalog();
      };
    }
  }, [activeMembership?.tenantId, subscribeQuotes, subscribeLeads, subscribeSettings, subscribeUsers, subscribePackages]);

  // Handle Preset Application
  const handleApplyPreset = (presetVal: string) => {
    setActivePresetIndex(presetVal);
    setSelectedPackageId('');
    if (presetVal === 'none') {
      setFormData(prev => ({
        ...prev,
        niche: '',
        systemRecommended: '',
        items: [],
        subtotal: 0,
        taxes: 0,
        total: 0
      }));
      return;
    }

    const preset = INDUSTRY_PRESETS[Number(presetVal)];
    if (preset) {
      const subtotal = preset.items.reduce((acc, curr) => acc + curr.amount, 0);
      const taxRate = (settings.commercial?.taxRatePercent ?? 16) / 100;
      const discount = formData.discount || 0;
      const taxes = (subtotal - discount) * taxRate;
      const total = subtotal - discount + taxes;

      setFormData(prev => ({
        ...prev,
        niche: preset.niche,
        systemRecommended: preset.name,
        currency: settings.commercial?.currency || preset.currency || 'MXN',
        items: preset.items.map(item => ({ ...item })), // cloned
        subtotal,
        taxes: Math.max(0, taxes),
        total: Math.max(0, total),
        remarks: preset.remarks
      }));
    }
  };

  // Recalculates quote financial totals from itemized list
  const recalculateQuoteTotals = (updatedItems: any[], currentDiscount: number) => {
    const newSubtotal = updatedItems.reduce((acc, curr) => acc + (curr.amount || 0), 0);
    const taxRate = (settings.commercial?.taxRatePercent ?? 16) / 100;
    const taxes = (newSubtotal - currentDiscount) * taxRate;
    const total = newSubtotal - currentDiscount + taxes;

    return {
      subtotal: newSubtotal,
      taxes: Math.max(0, taxes),
      total: Math.max(0, total)
    };
  };

  const handleAddConcept = () => {
    const newItem = {
      id: Math.random().toString(),
      description: '',
      quantity: 1,
      rate: 0,
      amount: 0
    };
    const updatedItems = [...(formData.items || []), newItem];
    const totals = recalculateQuoteTotals(updatedItems, formData.discount || 0);

    setFormData(prev => ({
      ...prev,
      items: updatedItems,
      ...totals
    }));
  };

  const handleRemoveConcept = (index: number) => {
    const updatedItems = (formData.items || []).filter((_, i) => i !== index);
    const totals = recalculateQuoteTotals(updatedItems, formData.discount || 0);

    setFormData(prev => ({
      ...prev,
      items: updatedItems,
      ...totals
    }));
  };

  const handleConceptFieldChange = (index: number, field: 'description' | 'quantity' | 'rate', value: any) => {
    const updatedItems = [...(formData.items || [])];
    const item = { ...updatedItems[index], [field]: value };

    if (field === 'quantity' || field === 'rate') {
      item.amount = (item.quantity || 1) * (item.rate || 0);
    }
    updatedItems[index] = item;

    const totals = recalculateQuoteTotals(updatedItems, formData.discount || 0);

    setFormData(prev => ({
      ...prev,
      items: updatedItems,
      ...totals
    }));

    if (field === 'description') {
      if (value.trim().length > 1) {
        const filtered = catalogItems.filter(ci => 
          ci.name.toLowerCase().includes(value.toLowerCase()) ||
          (ci.code && ci.code.toLowerCase().includes(value.toLowerCase()))
        );
        setSuggestionsList(filtered);
        setShowCatalogSuggestionsIndex(index);
      } else {
        setShowCatalogSuggestionsIndex(-1);
      }
    }
  };

  const handleSelectCatalogSuggestion = (index: number, catItem: CatalogItem) => {
    const updatedItems = [...(formData.items || [])];
    updatedItems[index] = {
      id: catItem.id,
      description: catItem.name,
      quantity: 1,
      rate: catItem.rate,
      amount: catItem.rate
    };

    const totals = recalculateQuoteTotals(updatedItems, formData.discount || 0);
    const newCurrency = catItem.currency || formData.currency || 'MXN';

    setFormData(prev => ({
      ...prev,
      items: updatedItems,
      currency: newCurrency,
      ...totals
    }));

    setShowCatalogSuggestionsIndex(-1);
  };

  const handlePackageSelect = (pkgId: string) => {
    setSelectedPackageId(pkgId);
    setActivePresetIndex('none');
    const pkg = packages.find(p => p.id === pkgId);
    if (pkg) {
      // Formulate single item concept from standard solar package
      const clonedItems = [
        {
          id: Math.random().toString(),
          description: pkg.name,
          quantity: 1,
          rate: pkg.price,
          amount: pkg.price
        }
      ];

      const totals = recalculateQuoteTotals(clonedItems, formData.discount || 0);

      setFormData(prev => ({
        ...prev,
        clientType: pkg.clientType,
        powerKw: pkg.powerKw,
        panelsCount: pkg.panelsCount,
        inverter: pkg.inverter,
        savingsEstimado: pkg.savingsEstimado,
        systemRecommended: pkg.name,
        items: clonedItems,
        niche: 'Paneles Solares',
        ...totals
      }));
    }
  };

  const handlePriceChange = (field: 'subtotal' | 'discount', value: number) => {
    if (field === 'subtotal') {
      // Manual adjustment of subtotal directly when concepts list is blank
      const totals = recalculateQuoteTotals(formData.items || [], formData.discount || 0);
      const taxRate = (settings.commercial?.taxRatePercent ?? 16) / 100;
      const taxes = (value - (formData.discount || 0)) * taxRate;
      const total = value - (formData.discount || 0) + taxes;

      setFormData(prev => ({
        ...prev,
        subtotal: value,
        taxes: Math.max(0, taxes),
        total: Math.max(0, total)
      }));
    } else {
      // Discount adjustment
      const totals = recalculateQuoteTotals(formData.items || [], value);
      setFormData(prev => ({
        ...prev,
        discount: value,
        ...totals
      }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId || !user?.id) return;

    if (typeof formData.systemRecommended === 'string' && formData.systemRecommended.trim() === '') {
       addToast('El nombre del sistema no puede estar vacío', 'error');
       return;
    }

    if (!formData.leadId) {
      addToast('Por favor selecciona un Lead', 'error');
      return;
    }

    try {
      if (viewState === 'create') {
        const quoteData: Omit<Quote, 'id' | 'tenantId' | 'advisorId'> = {
          ...(formData as Quote),
          systemRecommended: formData.systemRecommended?.trim() || '',
        };
        await createQuote(activeMembership.tenantId, formData.advisorId || user.id, quoteData);
        addToast('Cotización creada exitosamente', 'success');
      } else if (selectedQuote) {
        addToast('Para cambios estructurales, cree una nueva cotización.', 'info');
      }
      setViewState('list');
    } catch (error) {
      addToast('Error al procesar la cotización', 'error');
    }
  };

  const handleDelete = async () => {
    if (!quoteToDelete || !user) return;
    setIsDeleting(true);
    try {
      await deleteQuote(quoteToDelete.id, user.id, user.name);
      addToast(`Cotización ${quoteToDelete.quoteNumber} eliminada`, 'success');
      setIsDeleteModalOpen(false);
      setQuoteToDelete(null);
    } catch (error) {
      addToast('Error al eliminar la cotización', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSendWhatsApp = async () => {
    console.log('[PDF_ENGINE_V3] flujo real ejecutado');
    if (!selectedQuote || !activeMembership?.tenantId) return;

    setIsGeneratingPdf(true);
    let mediaUrl = '';
    let mediaFilename = '';

    const waitForImages = async (container: HTMLElement) => {
      const images = Array.from(container.querySelectorAll('img'));
      await Promise.all(
        images.map((img) => {
          if (img.complete && img.naturalWidth > 0) return Promise.resolve();
          return new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            setTimeout(resolve, 5000);
          });
        })
      );
    };

    const getBase64Image = async (url: string): Promise<string> => {
      try {
        const response = await fetch(url, { mode: 'cors' });
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (err) {
        console.error('[PDF_ENGINE_V3] Base64 conversion failed:', err);
        return url;
      }
    };

    try {
      const element = document.getElementById('quote-pdf-template-safe');
      if (!element) throw new Error('Contenedor de cotización (PDF Template) no encontrado');

      const images = element.querySelectorAll('img');
      for (const img of Array.from(images)) {
        if (img.src && (img.src.startsWith('http') || img.src.startsWith('https'))) {
          const base64 = await getBase64Image(img.src);
          img.src = base64;
        }
      }

      await waitForImages(element);
      await new Promise(resolve => setTimeout(resolve, 800));

      const canvas = await html2canvas(element, { 
        scale: 2, 
        useCORS: true, 
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

      const localLogoPath = '/brand/logo-energia-inteligente-bcs.png';
      try {
        const logoBase64 = await getBase64Image(localLogoPath);
        pdf.addImage(logoBase64, 'PNG', 14, 12, 28, 28);
      } catch (logoErr) {
        const fallbackLogoUrl = settings?.branding?.logoUrl;
        if (fallbackLogoUrl) {
          try {
            const fallbackBase64 = await getBase64Image(fallbackLogoUrl);
            pdf.addImage(fallbackBase64, 'PNG', 14, 12, 28, 28);
          } catch (err2) {
            console.error('[PDF_ENGINE_V3] Both local and remote logo failed');
          }
        }
      }

      const pdfBlob = pdf.output('blob');
      mediaFilename = `Cotizacion-${selectedQuote.quoteNumber}-${Date.now()}.pdf`;

      const storageRef = ref(storage, `quotes/${activeMembership.tenantId}/${mediaFilename}`);

      await uploadBytes(storageRef, pdfBlob, {
        contentType: 'application/pdf',
      });
      mediaUrl = await getDownloadURL(storageRef);
    } catch (e) {
      console.error('[PDF_ENGINE_V3] Error:', e);
      addToast('Error al generar PDF V3', 'error');
      setIsGeneratingPdf(false);
      return; 
    }

    setIsGeneratingPdf(false);

    let leadName = 'Cliente';
    const lead = leads.find(l => l.id === selectedQuote.leadId);
    if (lead) {
      leadName = lead.name;
    }

    const systemName = selectedQuote.systemRecommended ? selectedQuote.systemRecommended.trim() : 'Sistema personalizado';
    const currency = selectedQuote.currency || settings.commercial?.currency || 'MXN';
    const totalAmount = selectedQuote.total ? `${getCurrencySymbol(currency)}${selectedQuote.total.toLocaleString('es-MX')} ${currency}` : 'Por confirmar';
    const savings = selectedQuote.savingsEstimado ? `${getCurrencySymbol(currency)}${selectedQuote.savingsEstimado.toLocaleString('es-MX')} ${currency}` : 'Por calcular';
    const settingsCompanyName = settings.company?.tradeName || settings.company?.legalName || 'Paneles Solares MX';
    const advisorName = user?.name || 'Tu asesor';

    const template = settings.templates?.quoteMessage?.trim();
    let draftText: string;

    if (template) {
      draftText = template
        .replace(/\{\{leadName\}\}/g, leadName)
        .replace(/\{\{quoteNumber\}\}/g, selectedQuote.quoteNumber || '')
        .replace(/\{\{savings\}\}/g, savings)
        .replace(/\{\{packageName\}\}/g, systemName)
        .replace(/\{\{amount\}\}/g, totalAmount)
        .replace(/\{\{companyName\}\}/g, settingsCompanyName)
        .replace(/\{\{advisorName\}\}/g, advisorName);
    } else {
      draftText = `Hola ${leadName}, te compartimos tu propuesta comercial:
      
Propuesta: ${systemName}
Inversión total: ${totalAmount}
Rendimiento/Ahorro Proyectado: ${savings}

Te adjunto el documento en formato PDF de alta definición para tu revisión detallada. ¿Qué te parece si agendamos una llamada de 5 minutos para resolver cualquier inquietud?`;
    }

    navigate(`/conversaciones?leadId=${selectedQuote.leadId}&draftMessage=${encodeURIComponent(draftText)}&mediaUrl=${encodeURIComponent(mediaUrl)}&mediaFilename=${encodeURIComponent(mediaFilename)}`);
  };

  const initCreate = () => {
    setFormData({
      quoteNumber: QuoteService.generateQuoteNumber(),
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      clientType: 'Residencial',
      status: 'borrador',
      currency: settings.commercial?.currency || 'MXN',
      items: [],
      subtotal: 0,
      discount: 0,
      taxes: 0,
      total: 0,
      remarks: 'Precios sujetos a cambio sin previo aviso. Esta cotización tiene una vigencia de 15 días.',
      advisorId: user?.id || '',
      advisorName: user?.name || '',
      advisorEmail: user?.email || '',
    });
    setSelectedPackageId('');
    setActivePresetIndex('none');
    setViewState('create');
  };

  const statusColors: Record<QuoteStatus, string> = {
    borrador: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    enviada: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    aprobada: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    rechazada: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    vencida: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  };

  return (
    <div className="space-y-6">
      {viewState === 'list' && (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Cotizaciones</h1>
            <button
              onClick={initCreate}
              className="bg-[#1877F2] hover:bg-[#1565D8] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
            >
              <Plus className="h-4 w-4 mr-2" />
              Nueva Cotización
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden relative min-h-[400px]">
             {isLoading && (
               <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center">
                 <Loader2 className="w-12 h-12 text-primary-500 animate-spin mb-4" />
                 <p className="text-slate-600 font-semibold animate-pulse text-sm">Sincronizando con la nube...</p>
               </div>
             )}

             {error && (
               <div className="absolute inset-0 bg-white dark:bg-slate-900 z-30 flex flex-col items-center justify-center p-6 text-center">
                 <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
                   <AlertCircle className="w-10 h-10 text-red-500" />
                 </div>
                 <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Error de Conexión</h3>
                 <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">{error}</p>
                 <button 
                   onClick={() => window.location.reload()}
                   className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white px-6 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity"
                 >
                   Reintentar
                 </button>
               </div>
             )}
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Cotización</th>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Nicho / Plantilla</th>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Cliente (Lead)</th>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Monto Final</th>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Estado</th>
                  <th className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-200">Vigencia</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {quotes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center">
                       <div className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
                          <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
                            <FolderOpen className="w-8 h-8 text-slate-400" />
                          </div>
                          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">Sin Cotizaciones</h3>
                          <p className="text-sm max-w-sm mb-4">Aún no se han generado cotizaciones. Elige una plantilla o haz una en blanco.</p>
                          <button onClick={initCreate} className="text-primary-600 font-medium hover:text-primary-700 flex items-center">
                            <Plus className="w-4 h-4 mr-1" /> Crear primera cotización
                          </button>
                       </div>
                    </td>
                  </tr>
                ) : (
                  quotes.map((quote) => {
                    const lead = leads.find(l => l.id === quote.leadId);
                    const qCurrency = quote.currency || settings.commercial?.currency || 'MXN';
                    return (
                      <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{quote.quoteNumber}</td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                          <span className="px-2.5 py-0.5 text-xs font-semibold uppercase bg-slate-100 dark:bg-slate-700 rounded-md">
                            {quote.niche || 'Paneles Solares'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{lead?.name || 'Lead Desconocido'}</td>
                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                          {getCurrencySymbol(qCurrency)}{quote.total?.toLocaleString('es-MX')} {qCurrency}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColors[quote.status]}`}>
                            {quote.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500">{quote.validUntil}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button 
                              onClick={() => {
                                setSelectedQuote(quote);
                                setFormData(quote);
                                setViewState('preview');
                              }}
                              className="text-primary-600 hover:text-primary-800 transition-colors dark:hover:text-primary-400 font-medium text-xs uppercase tracking-wider"
                            >
                              Ver / Enviar
                            </button>
                            <button 
                              onClick={() => {
                                setQuoteToDelete(quote);
                                setIsDeleteModalOpen(true);
                              }}
                              className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
                              title="Eliminar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Detail Preview Panel or Create Form View */}
      {viewState !== 'list' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col h-[calc(100vh-140px)] animate-zoom-in">
          {/* Header Action Bar */}
          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
            <button
              onClick={() => setViewState('list')}
              className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 flex items-center text-sm font-semibold transition-colors"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Volver a la lista
            </button>
            <div className="flex items-center gap-3">
              {viewState === 'preview' && (
                <button
                  type="button"
                  onClick={() => setViewState('create')}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:border-slate-500 transition-colors shadow-sm flex items-center print:hidden"
                >
                  <EyeOff className="w-4 h-4 mr-2" />
                  Editar
                </button>
              )}
              {viewState === 'preview' && (
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600 dark:hover:border-slate-500 transition-colors shadow-sm flex items-center print:hidden"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Imprimir / PDF
                </button>
              )}
              {viewState === 'preview' && (
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  disabled={isGeneratingPdf}
                  className={`px-4 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-lg shadow-emerald-500/20 flex items-center print:hidden ${isGeneratingPdf ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isGeneratingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
                  {isGeneratingPdf ? 'Generando PDF...' : 'Enviar por WhatsApp'}
                </button>
              )}
              {viewState === 'preview' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (selectedQuote) {
                      await updateQuoteStatus(selectedQuote.id, 'enviada');
                      addToast('Cotización marcada como enviada', 'success');
                      setViewState('list');
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-500/20 flex items-center print:hidden"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Marcar Enviada
                </button>
              )}
              {viewState === 'create' && (
                <button
                  type="submit"
                  form="quote-form"
                  className="px-4 py-2 text-sm font-medium text-white bg-[#1877F2] hover:bg-[#1565D8] rounded-lg transition-colors shadow-sm shadow-blue-500/20 flex items-center"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {selectedQuote ? 'Guardar Cambios' : 'Crear Cotización'}
                </button>
              )}
            </div>
          </div>

          {/* Body Content */}
          <div className="p-6 overflow-y-auto flex-1">
            {viewState === 'create' ? (
               <form id="quote-form" onSubmit={handleSave} className="max-w-4xl mx-auto space-y-8">
                 {/* Section 1: Lead & Base Info */}
                 <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Información General</h3>
                   <div className="grid grid-cols-2 gap-6">
                      <div className="col-span-2 md:col-span-1">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente (Lead) *</label>
                        <select required value={formData.leadId || ''} onChange={e => setFormData({...formData, leadId: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                          <option value="" disabled>Seleccione un lead...</option>
                          {leads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.city}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2 md:col-span-1">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Asesor Responsable *</label>
                        <select 
                          required 
                          value={formData.advisorId || ''} 
                          onChange={e => {
                            const selected = teamMembers.find(m => m.userId === e.target.value);
                            setFormData({
                              ...formData, 
                              advisorId: e.target.value,
                              advisorName: selected?.name || '',
                              advisorEmail: selected?.email || ''
                            });
                          }} 
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="" disabled>Seleccione asesor...</option>
                          {teamMembers.map(m => (
                            <option key={m.id} value={m.userId || ''}>{m.name} ({m.role})</option>
                          ))}
                        </select>
                      </div>

                      {/* Presets dropdown */}
                      <div className="col-span-2">
                        <div className="p-4 bg-primary-50/40 dark:bg-primary-950/10 border border-primary-150 dark:border-primary-900/30 rounded-2xl">
                          <label className="block text-sm font-bold text-primary-900 dark:text-primary-300 mb-1 flex items-center gap-2">
                            <Layers className="h-4.5 w-4.5 text-primary-500" />
                            Preajustes y Plantillas por Nicho de Negocio
                          </label>
                          <p className="text-xs text-slate-400 mb-3">Escoge un preajuste comercial para rellenar de inmediato las partidas de la cotización con conceptos profesionales.</p>
                          <select 
                            value={activePresetIndex} 
                            onChange={e => handleApplyPreset(e.target.value)} 
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-primary-500"
                          >
                            <option value="none">-- Personalizada / En Blanco --</option>
                            {INDUSTRY_PRESETS.map((p, idx) => (
                              <option key={idx} value={idx}>{p.niche} - {p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cargar desde Paquete Solar</label>
                        <select value={selectedPackageId} onChange={e => handlePackageSelect(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                          <option value="">Ninguno (Manual)</option>
                          {packages.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Días de Vigencia</label>
                        <input type="date" required value={formData.validUntil} onChange={e => setFormData({...formData, validUntil: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Divisa de Cotización</label>
                        <select
                          value={formData.currency}
                          onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500"
                        >
                          {CURRENCIES.map(curr => (
                            <option key={curr.code} value={curr.code}>{curr.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Rendimiento / Ahorro Proyectado ({getCurrencySymbol(formData.currency)})</label>
                        <input type="number" required value={formData.savingsEstimado || 0} onChange={e => setFormData({...formData, savingsEstimado: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                   </div>
                 </div>

                 {/* Section 2: Technical/Concept Info */}
                 <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Datos de la Propuesta</h3>
                   <div className="grid grid-cols-3 gap-6">
                      <div className="col-span-3">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Título de la Cotización / Nombre del Sistema *</label>
                        <input type="text" required placeholder="e.g. Sistema de Paneles Solares Premium o Comisión de Consultoría Estratégica" value={formData.systemRecommended || ''} onChange={e => setFormData({...formData, systemRecommended: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nicho / Sector</label>
                        <input type="text" placeholder="e.g. Bienes Raíces, Solar" value={formData.niche || ''} onChange={e => setFormData({...formData, niche: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Cliente</label>
                        <select value={formData.clientType} onChange={e => setFormData({...formData, clientType: e.target.value as any})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                          <option>Residencial</option>
                          <option>Comercial</option>
                          <option>Industrial</option>
                        </select>
                      </div>
                   </div>
                 </div>

                 {/* Section 3: Concepts Itemized Table */}
                 <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-200 dark:border-slate-700 pb-2">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Tag className="h-5 w-5 text-primary-500" />
                        Partidas de la Propuesta Comercial
                      </h3>
                      <button
                        type="button"
                        onClick={handleAddConcept}
                        className="flex items-center gap-1 text-xs font-bold text-primary-600 hover:underline"
                      >
                        <Plus className="h-4 w-4" />
                        Añadir Partida
                      </button>
                    </div>

                    <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 text-xs font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="px-4 py-3.5">Descripción / Concepto</th>
                            <th className="px-4 py-3.5 text-center" style={{ width: '100px' }}>Cantidad</th>
                            <th className="px-4 py-3.5 text-right" style={{ width: '160px' }}>Precio Unit.</th>
                            <th className="px-4 py-3.5 text-right" style={{ width: '160px' }}>Importe</th>
                            <th className="px-4 py-3.5 text-center" style={{ width: '60px' }}></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                          {formData.items && formData.items.length > 0 ? (
                            formData.items.map((item, idx) => (
                              <tr key={item.id || idx}>
                                <td className="px-4 py-3.5 relative">
                                  <input
                                    type="text"
                                    required
                                    placeholder="Escribe el concepto..."
                                    value={item.description}
                                    onChange={(e) => handleConceptFieldChange(idx, 'description', e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-primary-500 focus:outline-none text-sm"
                                  />
                                  {/* Suggestions dropdown */}
                                  {showCatalogSuggestionsIndex === idx && suggestionsList.length > 0 && (
                                    <div className="absolute left-4 right-4 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl mt-1 max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                                      {suggestionsList.map((catItem) => (
                                        <button
                                          key={catItem.id}
                                          type="button"
                                          onClick={() => handleSelectCatalogSuggestion(idx, catItem)}
                                          className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 flex justify-between items-center transition-colors"
                                        >
                                          <div className="min-w-0 flex-1">
                                            <span className="font-bold text-slate-900 dark:text-white text-xs block truncate">{catItem.name}</span>
                                            <span className="text-slate-400 text-[10px] block truncate max-w-sm">{catItem.description}</span>
                                          </div>
                                          <span className="font-bold text-primary-600 text-xs shrink-0 ml-4 bg-primary-50 dark:bg-primary-950/40 px-2 py-0.5 rounded">
                                            {getCurrencySymbol(catItem.currency)}{catItem.rate} {catItem.currency}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  <input
                                    type="number"
                                    min="1"
                                    required
                                    value={item.quantity || 1}
                                    onChange={(e) => handleConceptFieldChange(idx, 'quantity', Number(e.target.value))}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-primary-500 focus:outline-none text-center text-sm"
                                  />
                                </td>
                                <td className="px-4 py-3.5 text-right">
                                  <div className="relative flex items-center justify-end">
                                    <span className="absolute left-2.5 text-xs font-semibold text-slate-400">{getCurrencySymbol(formData.currency)}</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      required
                                      value={item.rate || 0}
                                      onChange={(e) => handleConceptFieldChange(idx, 'rate', Number(e.target.value))}
                                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-7 pr-3 py-1.5 focus:ring-1 focus:ring-primary-500 focus:outline-none text-right font-semibold text-sm"
                                    />
                                  </div>
                                </td>
                                <td className="px-4 py-3.5 text-right font-bold text-slate-900 dark:text-white text-sm">
                                  {getCurrencySymbol(formData.currency)}{(item.amount || 0).toLocaleString('es-MX')}
                                </td>
                                <td className="px-4 py-3.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveConcept(idx)}
                                    className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-xs">
                                No hay conceptos añadidos en la cotización. Utiliza el buscador inteligente de arriba, elige un preajuste de industria o pulsa "Añadir Partida".
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                 {/* Section 4: Totals Summary & Terms */}
                 <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Resumen y Términos</h3>
                    <div className="grid grid-cols-2 gap-6 items-start">
                        <div className="space-y-4">
                           <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Términos y Condiciones</label>
                            <textarea rows={5} value={formData.remarks || ''} onChange={e => setFormData({...formData, remarks: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 resize-none text-xs leading-relaxed" />
                           </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Subtotal</span>
                              <div className="relative flex items-center">
                                <span className="absolute left-2 text-xs font-semibold text-slate-400">{getCurrencySymbol(formData.currency)}</span>
                                <input type="number" value={formData.subtotal || 0} onChange={e => handlePriceChange('subtotal', Number(e.target.value))} className="w-36 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-6 pr-2 py-1 text-right font-bold text-slate-900 dark:text-white" />
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Descuento Comercial</span>
                              <div className="relative flex items-center">
                                <span className="absolute left-2 text-xs font-semibold text-red-400">-</span>
                                <input type="number" value={formData.discount || 0} onChange={e => handlePriceChange('discount', Number(e.target.value))} className="w-36 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-6 pr-2 py-1 text-right font-semibold text-red-500" />
                              </div>
                            </div>
                            <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-4">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">IVA ({settings.commercial?.taxRatePercent ?? 16}%)</span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {getCurrencySymbol(formData.currency)}{formData.taxes?.toLocaleString('es-MX')} {formData.currency}
                              </span>
                            </div>
                            <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-4">
                              <span className="text-sm font-bold text-slate-900 dark:text-white">Inversión Final</span>
                              <span className="text-2xl font-black text-primary-600 dark:text-primary-400">
                                {getCurrencySymbol(formData.currency)}{formData.total?.toLocaleString('es-MX')} {formData.currency}
                              </span>
                            </div>
                        </div>
                    </div>
                 </div>
               </form>
            ) : (
                /* PDF Interactive Previewer */
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-2xl p-5 flex items-center gap-4">
                        <Info className="h-6 w-6 text-primary-500 shrink-0" />
                        <div>
                          <h4 className="text-sm font-bold text-blue-900 dark:text-blue-300">Previsualización de Documento de Alta Fidelidad</h4>
                          <p className="text-xs text-slate-500 leading-relaxed mt-0.5">
                            Este documento representa la versión que recibirá tu cliente final. Al hacer clic en "Enviar por WhatsApp", el sistema compilará automáticamente el archivo PDF, lo alojará en la nube en tiempo real, generará el link directo de descarga y lo pre-completará en tu bandeja de chat.
                          </p>
                        </div>
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-2xl bg-slate-100 p-8 flex justify-center">
                        <div className="bg-white text-slate-900 p-12 shadow-md w-full max-w-[800px] aspect-[1/1.41] relative flex flex-col justify-between" style={{ fontFamily: 'system-ui, sans-serif' }}>
                            {/* Inner Preview visualizer */}
                            <div>
                                <div className="flex justify-between items-start border-b border-slate-150 pb-6">
                                    <div>
                                        <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-lg mb-3">S</div>
                                        <h2 className="text-xl font-black uppercase tracking-tight">{settings.company?.tradeName || 'Paneles Solares MX'}</h2>
                                        <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest block mt-0.5">Cotización Comercial</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-2xl font-black text-slate-900 block">{formData.quoteNumber}</span>
                                        <span className="text-xs text-slate-400 block mt-1">Fecha: {formData.date}</span>
                                        <span className="text-xs text-slate-400 block">Vencimiento: {formData.validUntil}</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6 py-6 border-b border-slate-150 text-xs">
                                    <div>
                                        <strong className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">Destinatario (Cliente)</strong>
                                        <span className="font-bold text-slate-900 text-sm block">{leads.find(l => l.id === formData.leadId)?.name || 'Cliente'}</span>
                                        <span className="text-slate-500 block">{leads.find(l => l.id === formData.leadId)?.city || 'Ciudad de México'}</span>
                                        <span className="text-slate-500 block">{leads.find(l => l.id === formData.leadId)?.phone || 'WhatsApp'}</span>
                                    </div>
                                    <div>
                                        <strong className="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">Asesor Responsable</strong>
                                        <span className="font-bold text-slate-900 text-sm block">{formData.advisorName || 'Tu Asesor'}</span>
                                        <span className="text-slate-500 block">{formData.advisorEmail || ''}</span>
                                    </div>
                                </div>

                                <div className="py-6">
                                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Conceptos de Cotización</h4>
                                    <table className="w-full text-xs text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold">
                                                <th className="p-3">Partida / Concepto</th>
                                                <th className="p-3 text-center" style={{ width: '80px' }}>Cant.</th>
                                                <th className="p-3 text-right" style={{ width: '120px' }}>Precio</th>
                                                <th className="p-3 text-right" style={{ width: '120px' }}>Importe</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {formData.items && formData.items.length > 0 ? (
                                              formData.items.map((item, i) => (
                                                  <tr key={i}>
                                                      <td className="p-3 font-semibold text-slate-800">{item.description}</td>
                                                      <td className="p-3 text-center">{item.quantity}</td>
                                                      <td className="p-3 text-right">{getCurrencySymbol(formData.currency)}{item.rate?.toLocaleString('es-MX')}</td>
                                                      <td className="p-3 text-right font-bold">{getCurrencySymbol(formData.currency)}{item.amount?.toLocaleString('es-MX')}</td>
                                                  </tr>
                                              ))
                                            ) : (
                                              <tr>
                                                  <td className="p-3 font-semibold text-slate-800">{formData.systemRecommended || 'Servicio Profesional'}</td>
                                                  <td className="p-3 text-center">1</td>
                                                  <td className="p-3 text-right">{getCurrencySymbol(formData.currency)}{formData.subtotal?.toLocaleString('es-MX')}</td>
                                                  <td className="p-3 text-right font-bold">{getCurrencySymbol(formData.currency)}{formData.subtotal?.toLocaleString('es-MX')}</td>
                                              </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div className="border-t border-slate-150 pt-6">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="max-w-[400px]">
                                        {formData.remarks && (
                                            <div className="text-[10px] text-slate-400 whitespace-pre-line leading-relaxed">
                                                <strong className="block text-slate-600 mb-1">Términos y condiciones:</strong>
                                                {formData.remarks}
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 w-[280px] space-y-1.5 text-xs">
                                        <div className="flex justify-between text-slate-500">
                                            <span>Subtotal</span>
                                            <span className="font-semibold text-slate-850">{getCurrencySymbol(formData.currency)}{formData.subtotal?.toLocaleString('es-MX')}</span>
                                        </div>
                                        {Number(formData.discount) > 0 && (
                                            <div className="flex justify-between text-red-500">
                                                <span>Descuento</span>
                                                <span className="font-semibold">-{getCurrencySymbol(formData.currency)}{formData.discount?.toLocaleString('es-MX')}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between text-slate-500">
                                            <span>IVA ({settings.commercial?.taxRatePercent ?? 16}%)</span>
                                            <span className="font-semibold text-slate-850">{getCurrencySymbol(formData.currency)}{formData.taxes?.toLocaleString('es-MX')}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-900 border-t border-slate-200 pt-2 font-black text-sm">
                                            <span>Inversión Total</span>
                                            <span className="text-primary-600">{getCurrencySymbol(formData.currency)}{formData.total?.toLocaleString('es-MX')} {formData.currency}</span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[9px] text-slate-300 text-center uppercase tracking-widest font-black">Generado automáticamente por la suite inteligente de SmartFlow Hub OS</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden PDF Template with Safe Styles */}
      {(viewState === 'preview' && selectedQuote) && (
        <QuotePdfTemplate 
          quote={selectedQuote} 
          lead={leads.find(l => l.id === selectedQuote.leadId)}
          settings={settingsLoading ? null : settings}
        />
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden animate-zoom-in">
            <div className="p-6">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Eliminar cotización</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">
                ¿Seguro que deseas eliminar la cotización <span className="font-bold text-slate-700 dark:text-slate-200">{quoteToDelete?.quoteNumber}</span>? Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 px-6 py-4 flex justify-end gap-3">
              <button 
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setQuoteToDelete(null);
                }}
                disabled={isDeleting}
                className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors uppercase tracking-wider text-[10px]"
              >
                Cancelar
              </button>
              <button 
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-6 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-lg shadow-red-500/30 flex items-center disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Eliminar cotización
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
