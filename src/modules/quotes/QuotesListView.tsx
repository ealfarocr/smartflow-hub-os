import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuoteStore } from '@/stores/quoteStore';
import { useLeadStore } from '@/stores/leadStore';
import { usePackageStore } from '@/stores/packageStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUserStore } from '@/stores/userStore';
import { Quote, QuoteStatus } from '@/types';
import { QuoteService } from '@/services/firebase/QuoteService';
import { Plus, FileText, ChevronLeft, Save, EyeOff, Send, FolderOpen, Loader2, AlertCircle, MessageCircle, Trash2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { QuotePdfTemplate } from './QuotePdfTemplate';

export const QuotesListView = () => {
  const { quotes, createQuote, updateQuoteStatus, subscribe: subscribeQuotes, isLoading, error } = useQuoteStore();
  const { leads, subscribe: subscribeLeads } = useLeadStore();
  const { packages, subscribe: subscribePackages } = usePackageStore();
  const { user, activeMembership } = useAuthStore();
  const { addToast } = useUIStore();
  const { subscribe: subscribeSettings, isLoading: settingsLoading, ...settings } = useSettingsStore();
  const { teamMembers, subscribe: subscribeUsers } = useUserStore();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (activeMembership?.tenantId) {
      const unsubscribeQuotes = subscribeQuotes(activeMembership.tenantId);
      const unsubscribeLeads = subscribeLeads(activeMembership.tenantId);
      const unsubscribeSettings = subscribeSettings(activeMembership.tenantId);
      const unsubscribeUsers = subscribeUsers(activeMembership.tenantId);
      const unsubscribePackages = subscribePackages(activeMembership.tenantId);
      return () => {
        unsubscribeQuotes();
        unsubscribeLeads();
        unsubscribeSettings();
        unsubscribeUsers();
        unsubscribePackages();
      };
    }
  }, [activeMembership?.tenantId, subscribeQuotes, subscribeLeads, subscribeSettings, subscribeUsers, subscribePackages]);
  
  const [viewState, setViewState] = useState<'list' | 'create' | 'preview'>('list');
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { deleteQuote } = useQuoteStore();

  // Form State
  const [formData, setFormData] = useState<Partial<Quote>>({
    quoteNumber: `COT-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString().split('T')[0],
    validUntil: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
    clientType: 'Residencial',
    status: 'borrador',
    subtotal: 0,
    discount: 0,
    taxes: 0,
    total: 0,
    remarks: 'Precios sujetos a cambio sin previo aviso. Esta cotización tiene una vigencia de 15 días.',
  });

  const [selectedPackageId, setSelectedPackageId] = useState<string>('');

  const calculateTotals = (subtotalRaw: number, discountRaw: number) => {
    const sub = subtotalRaw;
    const taxRate = (settings.commercial?.taxRatePercent ?? 16) / 100;
    const tax = (sub - discountRaw) * taxRate;
    const tot = sub - discountRaw + tax;
    return { sub, tax, tot };
  };

  const handlePackageSelect = (pkgId: string) => {
    setSelectedPackageId(pkgId);
    const pkg = packages.find(p => p.id === pkgId);
    if (pkg) {
      const { sub, tax, tot } = calculateTotals(pkg.price, formData.discount || 0);
      setFormData(prev => ({
        ...prev,
        clientType: pkg.clientType,
        powerKw: pkg.powerKw,
        panelsCount: pkg.panelsCount,
        inverter: pkg.inverter,
        savingsEstimado: pkg.savingsEstimado,
        systemRecommended: pkg.name,
        subtotal: sub,
        taxes: tax,
        total: tot
      }));
    }
  };

  const handlePriceChange = (field: 'subtotal' | 'discount', value: number) => {
    const newSub = field === 'subtotal' ? value : (formData.subtotal || 0);
    const newDesc = field === 'discount' ? value : (formData.discount || 0);
    
    const { sub, tax, tot } = calculateTotals(newSub, newDesc);
    setFormData(prev => ({
      ...prev,
      subtotal: sub,
      discount: newDesc,
      taxes: tax,
      total: tot
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMembership?.tenantId || !user?.id) return;
    
    // Trim validations
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

    // Helper to ensure all images are loaded before canvas capture
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

    // Helper to convert remote image to base64 to bypass CORS issues
    const getBase64Image = async (url: string): Promise<string> => {
      try {
        const response = await fetch(url, { mode: 'cors' });
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            console.log('[PDF_ENGINE_V3] logo converted to dataUrl');
            resolve(reader.result as string);
          };
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

      // 1. Pre-convert all images in the template to Base64
      const images = element.querySelectorAll('img');
      for (const img of Array.from(images)) {
        if (img.src && (img.src.startsWith('http') || img.src.startsWith('https'))) {
          const base64 = await getBase64Image(img.src);
          img.src = base64;
        }
      }

      await waitForImages(element);
      await new Promise(resolve => setTimeout(resolve, 800)); // Layout stability

      const canvas = await html2canvas(element, { 
        scale: 2, 
        useCORS: true, 
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      
      // PDF_ENGINE_V3: Use mm and A4 for precision
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      // Layer 1: Template capture
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

      // Layer 2: MANUAL LOGO INJECTION (FIX DEFINITIVO V3)
      // Usar asset local fijo como se solicitó para máxima confiabilidad
      const localLogoPath = '/brand/logo-energia-inteligente-bcs.png';
      try {
        console.log('[PDF_ENGINE_V3] local logo loaded (attempting fetch)');
        const logoBase64 = await getBase64Image(localLogoPath);
        console.log('[PDF_ENGINE_V3] logo base64 ready');
        
        // Coordenadas fijas solicitadas: x: 14, y: 12, width: 28, height: 28 (mm)
        pdf.addImage(logoBase64, 'PNG', 14, 12, 28, 28);
        console.log('[PDF_ENGINE_V3] addImage executed');
      } catch (logoErr) {
        console.warn('[PDF_ENGINE_V3] Local logo failed, attempting fallback to settings logoUrl');
        const fallbackLogoUrl = settings?.branding?.logoUrl;
        if (fallbackLogoUrl) {
          try {
            const fallbackBase64 = await getBase64Image(fallbackLogoUrl);
            pdf.addImage(fallbackBase64, 'PNG', 14, 12, 28, 28);
            console.log('[PDF_ENGINE_V3] fallback addImage executed');
          } catch (err2) {
            console.error('[PDF_ENGINE_V3] Both local and remote logo failed');
          }
        }
      }
      
      const pdfBlob = pdf.output('blob');
      
      // Unique filename
      mediaFilename = `Cotizacion-${selectedQuote.quoteNumber}-${Date.now()}.pdf`;

      const storage = getStorage();
      const storageRef = ref(storage, `quotes/${activeMembership.tenantId}/${mediaFilename}`);
      
      await uploadBytes(storageRef, pdfBlob, {
        contentType: 'application/pdf',
      });
      mediaUrl = await getDownloadURL(storageRef);
      console.log('[PDF_ENGINE_V3] file uploaded:', mediaUrl);
      console.log('[PDF_ENGINE_V3] whatsapp mediaUrl ready');

    } catch (e) {
      console.error('[PDF_ENGINE_V3] Error:', e);
      addToast('Error al generar PDF V3', 'error');
      setIsGeneratingPdf(false);
      return; 
    }

    setIsGeneratingPdf(false);

    console.log('Quote Lead ID:', selectedQuote.leadId);
    let leadName = 'Cliente';
    const lead = leads.find(l => l.id === selectedQuote.leadId);
    
    if (lead) {
      console.log('Found Lead:', lead);
      leadName = lead.name;
    } else {
      console.warn('Lead no encontrado en el store, procesando con nombre genérico');
      addToast('El lead no se pudo cargar localmente, pero redirigiremos a Conversaciones', 'info');
    }

    const systemName = selectedQuote.systemRecommended ? selectedQuote.systemRecommended.trim() : 'Sistema personalizado';
    const currency = settings.commercial?.currency || 'MX';
    const totalAmount = selectedQuote.total ? `$${selectedQuote.total.toLocaleString('es-MX')} ${currency}` : 'Por confirmar';
    const savings = selectedQuote.savingsEstimado ? `$${selectedQuote.savingsEstimado.toLocaleString('es-MX')} ${currency}` : 'Por calcular';
    const settingsCompanyName = settings.company?.tradeName || settings.company?.legalName || 'Paneles Solares MX';
    const advisorName = user?.name || 'Tu asesor';

    // Use template from settings if available, otherwise default
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
      draftText = `Hola ${leadName}, te compartimos tu cotización de paneles solares:

Sistema recomendado: ${systemName}
Inversión estimada: ${totalAmount}
Ahorro bimestral proyectado: ${savings}

¿Deseas que agendemos una visita técnica para validar tu consumo y darte la propuesta final?`;
    }

    console.log('Draft Message Generado:', draftText);
    navigate(`/conversaciones?leadId=${selectedQuote.leadId}&draftMessage=${encodeURIComponent(draftText)}&mediaUrl=${encodeURIComponent(mediaUrl)}&mediaFilename=${encodeURIComponent(mediaFilename)}`);
  };

  const initCreate = () => {
    setFormData({
      quoteNumber: QuoteService.generateQuoteNumber(),
      date: new Date().toISOString().split('T')[0],
      validUntil: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0],
      clientType: 'Residencial',
      status: 'borrador',
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
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
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
                 <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6">
                   {error.includes('index') 
                     ? 'Falta un índice en la base de datos. Esto suele ocurrir tras una actualización del sistema. Por favor, contacta a soporte.' 
                     : error}
                 </p>
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
                    <td colSpan={6} className="px-6 py-20 text-center">
                       <div className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
                         <div className="bg-slate-100 dark:bg-slate-800 p-4 rounded-full mb-4">
                           <FolderOpen className="w-8 h-8 text-slate-400" />
                         </div>
                         <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">Sin Cotizaciones</h3>
                         <p className="text-sm max-w-sm mb-4">Aún no se han generado cotizaciones. Selecciona un Lead y crea tu primera propuesta comercial.</p>
                         <button onClick={initCreate} className="text-primary-600 font-medium hover:text-primary-700 flex items-center">
                           <Plus className="w-4 h-4 mr-1" /> Crear primera cotización
                         </button>
                       </div>
                    </td>
                  </tr>
                ) : (
                  quotes.map((quote) => {
                    const lead = leads.find(l => l.id === quote.leadId);
                    return (
                      <tr key={quote.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">{quote.quoteNumber}</td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{lead?.name || 'Lead Desconocido'}</td>
                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white border-l border-slate-100 dark:border-slate-800">${quote.total.toLocaleString('es-MX')} {settings.commercial?.currency || 'MX'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColors[quote.status]}`}>
                            {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
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
                              Ver / Editar
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

      {(viewState === 'create' || (viewState === 'preview' && selectedQuote)) && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col h-full max-h-[calc(100vh-8rem)]">
          {/* Header Action Bar */}
          <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center shrink-0 print:hidden">
            <button 
              onClick={() => setViewState('list')}
              className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center font-medium transition-colors"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              Volver a la lista
            </button>
            <div className="flex gap-3">
              {viewState === 'preview' && (
                <button
                  type="button"
                  onClick={() => setViewState('create')} // re-use create view as edit
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
                  className={`px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/50 transition-colors shadow-sm flex items-center print:hidden ${isGeneratingPdf ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors shadow-sm shadow-primary-500/20 flex items-center"
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
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cliente (Lead) *</label>
                        <select required value={formData.leadId || ''} onChange={e => setFormData({...formData, leadId: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                          <option value="" disabled>Seleccione un lead...</option>
                          {leads.map(l => <option key={l.id} value={l.id}>{l.name} - {l.city}</option>)}
                        </select>
                      </div>
                      <div>
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
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cargar desde Paquete</label>
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
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Consumo Est. Bimensual (kWh)</label>
                        <input type="number" required value={formData.consumptionEstimadoKwh || 0} onChange={e => setFormData({...formData, consumptionEstimadoKwh: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                   </div>
                 </div>

                 {/* Section 2: Technical Info */}
                 <div className="space-y-4">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Datos Técnicos Generados</h3>
                   <div className="grid grid-cols-3 gap-6">
                      <div className="col-span-3">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Nombre del Sistema</label>
                        <input type="text" required value={formData.systemRecommended || ''} onChange={e => setFormData({...formData, systemRecommended: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Cant. Paneles</label>
                        <input type="number" required value={formData.panelsCount || 0} onChange={e => setFormData({...formData, panelsCount: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Potencia Total (kW)</label>
                        <input type="number" step="0.1" required value={formData.powerKw || 0} onChange={e => setFormData({...formData, powerKw: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div className="col-span-1">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Cliente</label>
                        <select value={formData.clientType} onChange={e => setFormData({...formData, clientType: e.target.value as any})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500">
                          <option>Residencial</option>
                          <option>Comercial</option>
                          <option>Industrial</option>
                        </select>
                      </div>
                      <div className="col-span-3">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Microinversor / Inversor Central</label>
                        <input type="text" required value={formData.inverter || ''} onChange={e => setFormData({...formData, inverter: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                      </div>
                   </div>
                 </div>

                 {/* Section 3: Financial Info */}
                 <div className="space-y-4">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2">Propuesta Económica</h3>
                    <div className="grid grid-cols-2 gap-6 items-start">
                        <div className="space-y-4">
                           <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Ahorro Bi-mestral Proyectado ({settings.commercial?.currency || 'MX'})</label>
                            <input type="number" required value={formData.savingsEstimado || 0} onChange={e => setFormData({...formData, savingsEstimado: Number(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500" />
                           </div>
                           <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Observaciones</label>
                            <textarea rows={4} value={formData.remarks || ''} onChange={e => setFormData({...formData, remarks: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 resize-none" />
                           </div>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Subtotal</span>
                              <input type="number" value={formData.subtotal || 0} onChange={e => handlePriceChange('subtotal', Number(e.target.value))} className="w-32 bg-white dark:bg-slate-800 border-none text-right rounded font-semibold text-slate-900 dark:text-white p-1" />
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Descuento</span>
                              <input type="number" value={formData.discount || 0} onChange={e => handlePriceChange('discount', Number(e.target.value))} className="w-32 bg-white dark:bg-slate-800 border-none text-right text-red-500 rounded font-semibold p-1" />
                            </div>
                            <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-4">
                              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">IVA (16%)</span>
                              <span className="font-semibold text-slate-900 dark:text-white">${formData.taxes?.toLocaleString('es-MX')} {settings.commercial?.currency || 'MX'}</span>
                            </div>
                            <div className="flex justify-between items-center border-t border-slate-200 dark:border-slate-700 pt-4">
                              <span className="text-lg font-bold text-slate-900 dark:text-white">Inversión Final</span>
                              <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">${formData.total?.toLocaleString('es-MX')} {settings.commercial?.currency || 'MX'}</span>
                            </div>
                        </div>
                    </div>
                 </div>
               </form>
            ) : (
                /* Preview Mode */
                <div id="quote-preview-container" className="max-w-3xl mx-auto bg-white dark:bg-slate-900 shadow-xl rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden print:w-[800px] print:shadow-none print:border-none uppercase-first">
                    {/* Header Dynamic Selection */}
                    {(() => {
                      // Get fresh state from store
                      const settingsState = useSettingsStore.getState();
                      const pc = settingsState.branding?.primaryColor || '#2563eb';
                      const sc = settingsState.branding?.secondaryColor || '#0f172a';
                      const ac = settingsState.branding?.accentColor || '#f59e0b';
                      const logoUrl = settingsState.branding?.logoUrl;
                      const companyName = settingsState.company?.tradeName || settingsState.company?.legalName || 'Paneles Solares MX';
                      const headerStyle = settingsState.branding?.quoteHeaderStyle || 'modern';

                      const renderIdentity = (isLight: boolean) => (
                        <div className="flex items-center gap-6">
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="h-20 w-auto max-w-[280px] object-contain" />
                          ) : (
                            <h1 className={`text-3xl font-black tracking-tighter ${isLight ? 'text-white' : 'text-slate-900'}`} style={!isLight ? { color: pc } : {}}>{companyName.toUpperCase()}</h1>
                          )}
                          <div className={`flex flex-col justify-center border-l-2 pl-6 py-1 ${isLight ? 'border-white/20' : 'border-slate-200'}`}>
                            <p className={`font-extrabold text-xl leading-tight tracking-tight ${isLight ? 'text-white' : 'text-slate-900'}`}>{companyName}</p>
                            <p className={`font-bold text-[11px] uppercase tracking-[0.25em] mt-1.5 ${isLight ? 'text-white/70' : 'text-slate-400'}`}>Propuesta Técnica y Comercial</p>
                          </div>
                        </div>
                      );

                      if (headerStyle === 'classic') {
                        return (
                          <div className="p-10 text-white" style={{ backgroundColor: pc }}>
                            <div className="flex justify-between items-center">
                              {renderIdentity(true)}
                              <div className="text-right">
                                <p className="text-3xl font-black tracking-tighter">{formData.quoteNumber}</p>
                                <p className="text-[10px] text-white/60 mt-2 uppercase tracking-widest font-bold">Fecha: {formData.date}</p>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (headerStyle === 'minimal') {
                        return (
                          <div className="p-10 bg-white dark:bg-slate-950 border-b-2 border-slate-100 dark:border-slate-800">
                            <div className="flex justify-between items-center">
                              {renderIdentity(false)}
                              <div className="text-right">
                                <p className="text-2xl font-black tracking-tighter" style={{ color: pc }}>{formData.quoteNumber}</p>
                                <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">Fecha: {formData.date}</p>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      // Default Modern
                      return (
                        <div className="p-10 text-white" style={{ background: `linear-gradient(135deg, ${pc}, ${sc})` }}>
                          <div className="flex justify-between items-center">
                            {renderIdentity(true)}
                            <div className="text-right flex flex-col items-end gap-3">
                                <div className="px-6 py-2 rounded-full font-black text-sm shadow-xl shadow-black/20" style={{ backgroundColor: ac }}>{formData.quoteNumber}</div>
                                <p className="text-[10px] text-white/70 uppercase tracking-[0.2em] font-bold">Emitido: {formData.date}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    
                    <div className="p-10 space-y-10">
                        <div className="grid grid-cols-2 gap-10">
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: settings?.branding?.primaryColor || '#2563eb' }}>Preparado Para</h4>
                                <p className="text-lg font-bold text-slate-900 dark:text-white">{leads.find(l => l.id === formData.leadId)?.name}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{leads.find(l => l.id === formData.leadId)?.city} • {formData.clientType}</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{leads.find(l => l.id === formData.leadId)?.phone}</p>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: settings?.branding?.primaryColor || '#2563eb' }}>Información del Sistema</h4>
                                <ul className="space-y-2 text-sm">
                                    <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                                        <span className="text-slate-500">Configuración</span>
                                        <span className="font-semibold text-slate-900 dark:text-white text-right w-1/2">{formData.systemRecommended}</span>
                                    </li>
                                    <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                                        <span className="text-slate-500">Potencia Instalada</span>
                                        <span className="font-semibold text-slate-900 dark:text-white text-right w-1/2">{formData.powerKw} kW</span>
                                    </li>
                                    <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                                        <span className="text-slate-500">Cant. Módulos</span>
                                        <span className="font-semibold text-slate-900 dark:text-white text-right w-1/2">{formData.panelsCount} Uds</span>
                                    </li>
                                    <li className="flex justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
                                        <span className="text-slate-500">Inversor</span>
                                        <span className="font-semibold text-slate-900 dark:text-white text-right w-1/2">{formData.inverter}</span>
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="bg-[#f0f9ff] dark:bg-[#082f49]/30 rounded-xl p-6 flex justify-between items-center border border-blue-100 dark:border-blue-900/50">
                            <div>
                                <p className="text-sm font-semibold text-blue-900 dark:text-blue-300">Ahorro Bimestral Proyectado</p>
                                <p className="text-3xl font-black text-blue-600 dark:text-blue-400 mt-1">${formData.savingsEstimado?.toLocaleString('es-MX')} {settings.commercial?.currency || 'MX'}</p>
                            </div>
                            <FileText className="h-16 w-16 text-blue-200 dark:text-blue-900" />
                        </div>

                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                             <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold uppercase text-xs tracking-wider">Concepto</th>
                                        <th className="px-6 py-4 font-semibold uppercase text-xs tracking-wider text-right">Monto</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                    <tr>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">Subtotal del Sistema</td>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white text-right">${formData.subtotal?.toLocaleString('es-MX')}</td>
                                    </tr>
                                    {Number(formData.discount) > 0 && (
                                        <tr>
                                            <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">Descuento Comercial</td>
                                            <td className="px-6 py-4 font-medium text-red-500 text-right">-${formData.discount?.toLocaleString('es-MX')}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">IVA ({settings.commercial?.taxRatePercent ?? 16}%)</td>
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-white text-right">${formData.taxes?.toLocaleString('es-MX')}</td>
                                    </tr>
                                </tbody>
                                <tfoot className="bg-slate-50 dark:bg-slate-900/50">
                                    <tr>
                                        <td className="px-6 py-6 font-bold text-lg text-slate-900 dark:text-white text-right">INVERSIÓN TOTAL</td>
                                        <td className="px-6 py-6 font-black text-2xl text-primary-600 dark:text-primary-400 text-right">${formData.total?.toLocaleString('es-MX')}</td>
                                    </tr>
                                </tfoot>
                             </table>
                        </div>

                        {formData.remarks && (
                            <div className="text-xs text-slate-500 whitespace-pre-line border-t border-slate-200 dark:border-slate-800 pt-6">
                                <strong className="block mb-2">Términos y Condiciones:</strong>
                                {formData.remarks}
                            </div>
                        )}
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
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
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
