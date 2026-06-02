import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useLeadStore } from '@/stores/leadStore';
import { useUIStore } from '@/stores/uiStore';
import { CatalogItem } from '@/types';
import { CatalogService } from '@/services/firebase/CatalogService';
import { 
  Plus, Search, Grid, List, Edit2, Trash2, UploadCloud, FileText, 
  Send, X, Check, Loader2, Download, Tag, AlertCircle, Info, FileSpreadsheet,
  Image as ImageIcon, Camera, Upload, ChevronLeft, ChevronRight, MessageCircle
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase';

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

export const CatalogPageView = () => {
  const navigate = useNavigate();
  const { activeMembership } = useAuthStore();
  const { leads, subscribe: subscribeLeads } = useLeadStore();
  const { addToast } = useUIStore();
  
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Track active image index for each card
  const [activeImageIndices, setActiveImageIndices] = useState<Record<string, number>>({});

  // Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    description: '',
    rate: 0,
    currency: 'USD',
    unit: 'servicio',
    category: 'General',
    imageUrl: '',
    images: ['', '', ''] as string[]
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingIndex, setIsUploadingIndex] = useState<number | null>(null);

  // CSV Importer State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState({
    code: -1,
    name: -1,
    description: -1,
    rate: -1,
    currency: -1,
    unit: -1,
    category: -1,
    images: -1
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // WhatsApp Sender State
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [sharingItem, setSharingItem] = useState<CatalogItem | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [customMsgPrefix, setCustomMsgPrefix] = useState('¡Hola! Te comparto la información y costos del artículo que me solicitaste:');

  useEffect(() => {
    if (activeMembership?.tenantId) {
      setIsLoading(true);
      const unsubscribe = CatalogService.subscribeToCatalog(
        activeMembership.tenantId,
        (fetchedItems) => {
          setItems(fetchedItems);
          setIsLoading(false);
        },
        () => {
          addToast('Error al cargar catálogo', 'error');
          setIsLoading(false);
        }
      );

      const unsubscribeLeads = subscribeLeads(activeMembership.tenantId);

      return () => {
        unsubscribe();
        unsubscribeLeads();
      };
    }
  }, [activeMembership?.tenantId, subscribeLeads]);

  const categories = ['All', ...Array.from(new Set(items.map(item => item.category || 'General')))];

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (item.code && item.code.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleOpenCreate = () => {
    setEditingItem(null);
    setFormData({
      code: '',
      name: '',
      description: '',
      rate: 0,
      currency: 'USD',
      unit: 'servicio',
      category: 'General',
      imageUrl: '',
      images: ['', '', '']
    });
    setIsFormOpen(true);
  };

  const handleOpenEdit = (item: CatalogItem) => {
    setEditingItem(item);
    // Pad to at least 3 image slots
    const paddedImages = item.images && item.images.length > 0 
      ? [...item.images, '', '', ''].slice(0, 3) 
      : [item.imageUrl || '', '', ''];

    setFormData({
      code: item.code || '',
      name: item.name,
      description: item.description || '',
      rate: item.rate,
      currency: item.currency || 'USD',
      unit: item.unit || 'servicio',
      category: item.category || 'General',
      imageUrl: item.imageUrl || '',
      images: paddedImages
    });
    setIsFormOpen(true);
  };

  // Upload item images to Storage
  const handleImageFileChange = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeMembership?.tenantId) return;

    setIsUploadingIndex(index);
    const fileExtension = file.name.split('.').pop() || 'png';
    const storagePath = `catalog/${activeMembership.tenantId}/${Date.now()}_img_${index}.${fileExtension}`;
    const storageRef = ref(storage, storagePath);

    try {
      const snapshot = await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' });
      const downloadUrl = await getDownloadURL(snapshot.ref);

      const updatedImages = [...formData.images];
      updatedImages[index] = downloadUrl;

      // Primary image fallback
      const primaryUrl = updatedImages.find(u => u !== '') || '';

      setFormData(prev => ({
        ...prev,
        images: updatedImages,
        imageUrl: primaryUrl
      }));

      addToast(`Imagen ${index + 1} subida correctamente`, 'success');
    } catch (err) {
      console.error(err);
      addToast('Error al subir archivo de imagen', 'error');
    } finally {
      setIsUploadingIndex(null);
    }
  };

  const handleManualImageUrlChange = (index: number, value: string) => {
    const updatedImages = [...formData.images];
    updatedImages[index] = value;
    const primaryUrl = updatedImages.find(u => u !== '') || '';

    setFormData(prev => ({
      ...prev,
      images: updatedImages,
      imageUrl: primaryUrl
    }));
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      addToast('El nombre es obligatorio', 'error');
      return;
    }
    if (formData.rate < 0) {
      addToast('El precio no puede ser negativo', 'error');
      return;
    }

    setIsSubmitting(true);
    // Filter out blank image URLs
    const finalImages = formData.images.filter(img => img.trim() !== '');
    const finalPayload = {
      ...formData,
      images: finalImages,
      imageUrl: finalImages[0] || ''
    };

    try {
      if (editingItem) {
        await CatalogService.updateCatalogItem(editingItem.id, finalPayload);
        addToast('Artículo actualizado correctamente', 'success');
      } else {
        await CatalogService.createCatalogItem(activeMembership!.tenantId, finalPayload);
        addToast('Artículo añadido correctamente', 'success');
      }
      setIsFormOpen(false);
    } catch (err) {
      console.error(err);
      addToast('Error al guardar el artículo', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (id: string, name: string) => {
    if (window.confirm(`¿Seguro que deseas eliminar "${name}" del catálogo?`)) {
      try {
        await CatalogService.deleteCatalogItem(id);
        addToast('Artículo eliminado con éxito', 'success');
      } catch (err) {
        console.error(err);
        addToast('Error al eliminar artículo', 'error');
      }
    }
  };

  // --- CSV Processing ---
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (lines.length === 0) return;

      // Detect delimiter: check if there are more semicolons or commas in the first line
      const firstLine = lines[0];
      const commaCount = (firstLine.match(/,/g) || []).length;
      const semicolonCount = (firstLine.match(/;/g) || []).length;
      const delimiter = semicolonCount > commaCount ? ';' : ',';

      const headers = firstLine.split(delimiter).map(h => h.replace(/^"|"$/g, '').trim());
      setCsvHeaders(headers);

      const rows = lines.slice(1).map(line => {
        let cells: string[] = [];
        if (delimiter === ';') {
          cells = line.split(';').map(cell => cell.replace(/^"|"$/g, '').trim());
        } else {
          const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
          cells = matches ? matches.map(cell => cell.replace(/^"|"$/g, '').trim()) : line.split(',');
        }
        return cells;
      });
      setCsvRows(rows);

      const newMapping = {
        code: headers.findIndex(h => /codigo|sku|id|referencia/i.test(h)),
        name: headers.findIndex(h => /nombre|name|articulo|producto|servicio/i.test(h)),
        description: headers.findIndex(h => /descripcion|detalle|info/i.test(h)),
        rate: headers.findIndex(h => /precio|costo|rate|monto|valor/i.test(h)),
        currency: headers.findIndex(h => /divisa|moneda|currency/i.test(h)),
        unit: headers.findIndex(h => /unidad|medida|unit/i.test(h)),
        category: headers.findIndex(h => /categoria|category/i.test(h)),
        images: headers.findIndex(h => /imagen|imagenes|fotos|photos|image|images|urls/i.test(h))
      };
      setMapping(newMapping);
    };
    reader.readAsText(file);
  };

  const handleImportSubmit = async () => {
    if (mapping.name === -1 || mapping.rate === -1) {
      addToast('Debes mapear al menos los campos Nombre y Precio', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const importedItems: Partial<CatalogItem>[] = csvRows.map(row => {
        // Parse images column if present
        let parsedImages: string[] = [];
        if (mapping.images !== -1 && row[mapping.images]) {
          parsedImages = row[mapping.images]
            .split(/[;,\s|]+/) // supports split by comma, semicolon, space, or vertical bar
            .map(url => url.trim())
            .filter(url => url.length > 0);
        }

        const item: Partial<CatalogItem> = {
          name: row[mapping.name] || 'Artículo sin nombre',
          rate: Number(row[mapping.rate]) || 0,
          currency: mapping.currency !== -1 && row[mapping.currency] ? row[mapping.currency] : 'MXN',
          description: mapping.description !== -1 ? row[mapping.description] : '',
          code: mapping.code !== -1 ? row[mapping.code] : '',
          unit: mapping.unit !== -1 ? row[mapping.unit] : 'unidad',
          category: mapping.category !== -1 ? row[mapping.category] : 'Importado',
          images: parsedImages,
          imageUrl: parsedImages[0] || ''
        };
        return item;
      });

      await CatalogService.batchImportCatalogItems(activeMembership!.tenantId, importedItems);
      addToast(`Se importaron ${importedItems.length} artículos exitosamente`, 'success');
      setIsImportOpen(false);
      setCsvFile(null);
    } catch (err) {
      console.error(err);
      addToast('Error al importar archivo CSV', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const downloadSampleCsv = () => {
    const csvContent = "data:text/csv;charset=utf-8,Codigo,Nombre,Descripcion,Precio,Moneda,Unidad,Categoria,Imagenes\nKIT01,Panel Solar Premium 550W,Celulas monocristalinas alta eficiencia,340,USD,unidad,Solar,https://example.com/img1.jpg;https://example.com/img2.jpg;https://example.com/img3.jpg\nSERV02,Mantenimiento Preventivo,Limpieza de modulos e inspeccion de inversor,1500,MXN,servicio,Servicio,https://images.unsplash.com/photo-1620038650443-462f8b6883e3\nPROD03,Seguro Automotriz Todo Riesgo,Cobertura amplia sin deducible,12000,MXN,anio,Autos,https://images.unsplash.com/photo-1549399542-7e3f8b79c341";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "plantilla_catalogo_imagenes.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- WhatsApp Sharing ---
  const handleOpenShare = (item: CatalogItem) => {
    setSharingItem(item);
    setSelectedLeadId('');
    setIsShareOpen(true);
  };

  const handleSendWhatsApp = () => {
    if (!sharingItem) return;
    const lead = leads.find(l => l.id === selectedLeadId);
    if (!lead) {
      addToast('Selecciona un lead destinatario', 'error');
      return;
    }

    const priceFormatted = `${getCurrencySymbol(sharingItem.currency)}${sharingItem.rate.toLocaleString('es-MX')} ${sharingItem.currency}`;
    const imgUrls = sharingItem.images && sharingItem.images.length > 0 
      ? `\n*Imágenes del Producto:*\n` + sharingItem.images.map((img, i) => `${i + 1}. ${img}`).join('\n')
      : '';

    const textMsg = `${customMsgPrefix}\n\n*${sharingItem.name.toUpperCase()}*\n_${sharingItem.description || 'Sin descripción disponible'}_\n\n*Precio:* ${priceFormatted} por ${sharingItem.unit || 'unidad'}\n*Código:* ${sharingItem.code || 'N/A'}${imgUrls}\n\nQuedo a tus órdenes para cualquier duda. 😊`;

    const primaryImage = sharingItem.images && sharingItem.images.length > 0 
      ? sharingItem.images[0] 
      : (sharingItem.imageUrl || '');

    const searchParams = new URLSearchParams();
    searchParams.set('leadId', lead.id);
    searchParams.set('draftMessage', textMsg);
    if (primaryImage) {
      searchParams.set('mediaUrl', primaryImage);
      searchParams.set('mediaFilename', `${sharingItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_img.png`);
    }

    navigator.clipboard.writeText(textMsg);
    addToast('Redirigiendo al chat en Conversaciones...', 'success');

    navigate(`/conversaciones?${searchParams.toString()}`);
    setIsShareOpen(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Upper header action bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Tag className="h-8 w-8 text-primary-500" />
            Catálogo de Productos
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            Administra tus productos con soporte de hasta 3 imágenes de alta definición, carga masiva inteligente y compartición automatizada.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button 
            onClick={() => setIsImportOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/50 shadow-sm transition-all flex-1 md:flex-none"
          >
            <UploadCloud className="h-4 w-4" />
            Importar Excel / CSV
          </button>
          <button 
            onClick={handleOpenCreate}
            className="flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#1565D8] rounded-xl shadow-lg shadow-blue-500/20 transition-all flex-1 md:flex-none"
          >
            <Plus className="h-4 w-4" />
            Nuevo Artículo
          </button>
        </div>
      </div>

      {/* Control bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-center justify-between shadow-sm">
        <div className="relative w-full md:max-w-md">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-5 w-5 text-slate-400" />
          </span>
          <input
            type="text"
            placeholder="Buscar por nombre, código o descripción..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
          <div className="flex gap-1.5 overflow-x-auto max-w-full no-scrollbar pb-1 md:pb-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                  selectedCategory === cat 
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {cat === 'All' ? 'Todos' : cat}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden md:block" />

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="h-10 w-10 text-primary-500 animate-spin" />
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-3 font-semibold">Cargando catálogo comercial...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-16 text-center shadow-sm">
          <Tag className="h-12 w-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-1">Tu catálogo está vacío</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm max-w-sm mx-auto mb-6">
            Aún no has agregado productos o servicios. Créalos individualmente con fotos o impórtalos en lote desde Excel.
          </p>
          <div className="flex justify-center gap-3">
            <button 
              onClick={handleOpenCreate}
              className="px-5 py-2.5 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#1565D8] rounded-xl transition-all"
            >
              Crear artículo
            </button>
            <button 
              onClick={() => setIsImportOpen(true)}
              className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            >
              Carga Masiva
            </button>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid mode */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map(item => {
            const displayImages = item.images && item.images.length > 0 
              ? item.images 
              : [item.imageUrl || ''];
            
            const currentImgIndex = activeImageIndices[item.id] || 0;
            const activeImgUrl = displayImages[currentImgIndex] || '/brand/placeholder-product.png';

            return (
              <div 
                key={item.id}
                className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 rounded-3xl overflow-hidden hover:shadow-xl dark:hover:border-primary-500/30 dark:hover:shadow-primary-950/20 transition-all duration-300 group flex flex-col h-full"
              >
                {/* Image Gallery Header */}
                <div className="relative h-48 w-full bg-slate-100 dark:bg-slate-950 overflow-hidden">
                  <img 
                    src={activeImgUrl} 
                    alt={item.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/brand/placeholder-product.png';
                    }}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent opacity-60" />
                  
                  {/* Category Pill */}
                  <div className="absolute top-4 left-4">
                    <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-wider bg-[#1877F2] text-white rounded-full shadow">
                      {item.category || 'General'}
                    </span>
                  </div>

                  {/* SKU Overlay */}
                  {item.code && (
                    <div className="absolute top-4 right-4">
                      <span className="text-[10px] font-mono text-slate-200 bg-slate-950/40 backdrop-blur-sm px-2 py-0.5 rounded-md font-bold">
                        {item.code}
                      </span>
                    </div>
                  )}

                  {/* Multi-Image Hover Tabs Indicator */}
                  {displayImages.length > 1 && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                      {displayImages.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setActiveImageIndices(prev => ({ ...prev, [item.id]: i }))}
                          onMouseEnter={() => setActiveImageIndices(prev => ({ ...prev, [item.id]: i }))}
                          className={`h-2 rounded-full transition-all duration-300 ${i === currentImgIndex ? 'w-4 bg-primary-500' : 'w-2 bg-white/60 hover:bg-white'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Body details */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white group-hover:text-primary-500 transition-colors line-clamp-1 mb-1.5">
                      {item.name}
                    </h3>
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed line-clamp-3 whitespace-pre-wrap">
                      {item.description || 'Sin descripción detallada.'}
                    </p>

                    {/* Tiny visual strip of all available photos */}
                    {displayImages.length > 1 && (
                      <div className="flex gap-2 mt-4">
                        {displayImages.map((img, idx) => (
                          <div 
                            key={idx}
                            onMouseEnter={() => setActiveImageIndices(prev => ({ ...prev, [item.id]: idx }))}
                            className={`h-10 w-10 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${idx === currentImgIndex ? 'border-primary-500 scale-105 shadow' : 'border-slate-200 dark:border-slate-800 opacity-60 hover:opacity-100'}`}
                          >
                            <img 
                              src={img} 
                              alt="thumbnail" 
                              className="h-full w-full object-cover" 
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/brand/placeholder-product.png';
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-800/80 mt-4 pt-4 flex justify-between items-end">
                    <div>
                      <span className="block text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-0.5">Precio</span>
                      <span className="text-2xl font-black text-slate-900 dark:text-white">
                        {getCurrencySymbol(item.currency)}{item.rate.toLocaleString('es-MX')}
                        <span className="text-xs text-slate-400 dark:text-slate-500 font-bold ml-1">
                          {item.currency} / {item.unit || 'ud'}
                        </span>
                      </span>
                    </div>
                    
                    <div className="flex gap-1">
                      <button 
                        onClick={() => handleOpenShare(item)}
                        title="Enviar por WhatsApp"
                        className="p-2 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800"
                      >
                        <Send className="h-4.5 w-4.5" />
                      </button>
                      <button 
                        onClick={() => handleOpenEdit(item)}
                        title="Editar artículo"
                        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors border border-transparent hover:border-blue-200 dark:hover:border-blue-800"
                      >
                        <Edit2 className="h-4.5 w-4.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteItem(item.id, item.name)}
                        title="Eliminar artículo"
                        className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-800"
                      >
                        <Trash2 className="h-4.5 w-4.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table mode */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/40 text-slate-500 text-[11px] font-black uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-4">Foto</th>
                  <th className="px-6 py-4">Código / SKU</th>
                  <th className="px-6 py-4">Nombre</th>
                  <th className="px-6 py-4">Categoría</th>
                  <th className="px-6 py-4">Descripción</th>
                  <th className="px-6 py-4 text-right">Precio unitario</th>
                  <th className="px-6 py-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                {filteredItems.map(item => {
                  const mainPhoto = item.images && item.images.length > 0 ? item.images[0] : (item.imageUrl || '');
                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-950 overflow-hidden border border-slate-200 dark:border-slate-800">
                          <img 
                            src={mainPhoto || '/brand/placeholder-product.png'} 
                            alt="thumb" 
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = '/brand/placeholder-product.png';
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-xs text-slate-400">{item.code || '-'}</td>
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">{item.name}</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded-md">
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-w-xs truncate">{item.description || 'Sin descripción'}</td>
                      <td className="px-6 py-4 text-right font-black text-slate-900 dark:text-white">
                        {getCurrencySymbol(item.currency)}{item.rate.toLocaleString('es-MX')} 
                        <span className="text-[10px] text-slate-400 font-bold ml-1">{item.currency}/{item.unit || 'ud'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2 justify-center">
                          <button 
                            onClick={() => handleOpenShare(item)}
                            className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/25 rounded-md transition-all"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => handleOpenEdit(item)}
                            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/25 rounded-md transition-all"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteItem(item.id, item.name)}
                            className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/25 rounded-md transition-all"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: INDIVIDUAL FORM CREATION ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[92vh] animate-zoom-in">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/30">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {editingItem ? 'Editar Artículo' : 'Nuevo Artículo de Catálogo'}
              </h3>
              <button 
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveItem} className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* Images Section (Minimum 3 files/URLs option) */}
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <ImageIcon className="h-4 w-4 text-primary-500" />
                  Imágenes del Artículo (Mínimo 3 Opciones / URLs)
                </label>
                <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                  Sube directamente imágenes desde tu dispositivo a nuestra base de almacenamiento seguro, o bien introduce enlaces directos de la web.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {formData.images.map((imgUrl, idx) => (
                    <div 
                      key={idx} 
                      className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 flex flex-col items-center relative hover:border-primary-500/30 transition-colors"
                    >
                      <div className="h-20 w-full rounded-xl bg-slate-100 dark:bg-slate-900 overflow-hidden border border-slate-200/60 dark:border-slate-800 relative flex items-center justify-center mb-3 group">
                        {imgUrl ? (
                          <>
                            <img src={imgUrl} alt={`preview-${idx}`} className="h-full w-full object-cover" />
                            <button
                              type="button"
                              onClick={() => handleManualImageUrlChange(idx, '')}
                              className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold"
                            >
                              Eliminar Foto
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 text-center px-2">
                            {isUploadingIndex === idx ? (
                              <Loader2 className="h-6 w-6 text-primary-500 animate-spin" />
                            ) : (
                              <>
                                <Camera className="h-6 w-6 mb-1 text-slate-300" />
                                <span className="text-[9px] uppercase tracking-widest font-bold">Imagen {idx + 1}</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Manual input file trigger */}
                      <label className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 rounded-lg py-1.5 px-3 text-center text-[10px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors mb-2 shadow-sm">
                        <Upload className="h-3 w-3 text-primary-500" />
                        Subir Foto
                        <input 
                          type="file" 
                          accept="image/*" 
                          onChange={(e) => handleImageFileChange(idx, e)} 
                          className="hidden" 
                        />
                      </label>

                      {/* Direct URL entry field */}
                      <input
                        type="text"
                        placeholder="Pegar enlace de imagen..."
                        value={imgUrl}
                        onChange={(e) => handleManualImageUrlChange(idx, e.target.value)}
                        className="w-full px-2 py-1 text-[10px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md focus:outline-none focus:ring-1 focus:ring-primary-500 text-center"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código / SKU</label>
                  <input
                    type="text"
                    placeholder="e.g. SOL-550W"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoría</label>
                  <input
                    type="text"
                    placeholder="e.g. Solar, Software, Autos"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre del Producto / Servicio *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mantenimiento Preventivo o Panel Solar 550W"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descripción Comercial</label>
                <textarea
                  rows={2}
                  placeholder="Describe de qué trata el producto o servicio..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Precio Unitario *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0"
                    placeholder="0.00"
                    value={formData.rate || ''}
                    onChange={(e) => setFormData({ ...formData, rate: Number(e.target.value) })}
                    className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Divisa</label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full px-3 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {CURRENCIES.map(curr => (
                      <option key={curr.code} value={curr.code}>{curr.code}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unidad de Medida</label>
                <input
                  type="text"
                  placeholder="e.g. unidad, servicio, hora, m2, mes"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="border-t border-slate-100 dark:border-slate-800 pt-5 flex justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-[#1877F2] hover:bg-[#1565D8] rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-50 transition-all"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingItem ? 'Guardar Cambios' : 'Crear Artículo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: BULK EXCEL/CSV IMPORTER ── */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-zoom-in">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/30">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="h-6 w-6 text-emerald-500" />
                Asistente de Importación de Catálogo
              </h3>
              <button 
                onClick={() => setIsImportOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {!csvFile ? (
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-primary-500 dark:hover:border-primary-500 bg-slate-50 dark:bg-slate-800/20 rounded-2xl p-12 text-center cursor-pointer transition-all hover:scale-[1.01] group"
                >
                  <UploadCloud className="h-12 w-12 text-slate-400 dark:text-slate-600 group-hover:text-primary-500 mx-auto mb-4 transition-colors" />
                  <h4 className="text-base font-bold text-slate-700 dark:text-slate-300 mb-1">Arrastra tu archivo CSV aquí</h4>
                  <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mx-auto mb-6">
                    Sube tu base de datos de productos. El sistema soporta cualquier orden de columnas incluyendo enlaces de imágenes divididos por comas o punto y comas.
                  </p>
                  <input 
                    ref={fileInputRef}
                    type="file" 
                    accept=".csv" 
                    onChange={handleCsvUpload} 
                    className="hidden" 
                  />
                  <button 
                    type="button"
                    className="px-4 py-2 text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400 rounded-lg group-hover:bg-blue-100 transition-all"
                  >
                    Seleccionar Archivo
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Check className="h-5 w-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-bold text-emerald-800 dark:text-emerald-400">{csvFile.name}</p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-500">{csvRows.length} filas detectadas</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setCsvFile(null)}
                      className="text-xs text-red-500 hover:underline font-bold"
                    >
                      Remover
                    </button>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Mapeador de Columnas Inteligente:</h4>
                    <p className="text-xs text-slate-400 mb-4">
                      Asocia las columnas de tu archivo CSV con los campos que requiere SmartFlow para sincronizarlo correctamente.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Nombre de Producto / Servicio *</label>
                        <select
                          value={mapping.name}
                          onChange={(e) => setMapping({ ...mapping, name: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- Seleccionar columna --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Precio / Tarifa *</label>
                        <select
                          value={mapping.rate}
                          onChange={(e) => setMapping({ ...mapping, rate: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- Seleccionar columna --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Código de Referencia / SKU</label>
                        <select
                          value={mapping.code}
                          onChange={(e) => setMapping({ ...mapping, code: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- No importar SKU (N/A) --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Descripción Comercial</label>
                        <select
                          value={mapping.description}
                          onChange={(e) => setMapping({ ...mapping, description: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- Sin descripción --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Moneda / Divisa</label>
                        <select
                          value={mapping.currency}
                          onChange={(e) => setMapping({ ...mapping, currency: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- Forzar "MXN" para todos --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500">Categoría</label>
                        <select
                          value={mapping.category}
                          onChange={(e) => setMapping({ ...mapping, category: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- Agrupar en "Importado" --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-col col-span-2 gap-1 bg-primary-50/30 dark:bg-primary-950/10 p-3 rounded-xl border border-primary-100/50 dark:border-primary-900/30">
                        <label className="text-xs font-black text-primary-900 dark:text-primary-300 flex items-center gap-1.5">
                          <ImageIcon className="h-4 w-4 text-primary-500" />
                          Mapear Columna de Imágenes (URLs separadas por punto y coma o espacio)
                        </label>
                        <p className="text-[10px] text-slate-400 mb-2">Escoge la columna que contiene los enlaces de las fotos para cargarlos de forma masiva.</p>
                        <select
                          value={mapping.images}
                          onChange={(e) => setMapping({ ...mapping, images: Number(e.target.value) })}
                          className="px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:ring-1 focus:ring-primary-500 focus:outline-none"
                        >
                          <option value={-1}>-- No importar imágenes (N/A) --</option>
                          {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-col md:flex-row justify-between items-center gap-4">
                <button
                  type="button"
                  onClick={downloadSampleCsv}
                  className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline"
                >
                  <Download className="h-4 w-4" />
                  Descargar plantilla CSV modelo
                </button>

                <div className="flex gap-2 w-full md:w-auto justify-end">
                  <button
                    type="button"
                    onClick={() => setIsImportOpen(false)}
                    className="px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  {csvFile && (
                    <button
                      type="button"
                      onClick={handleImportSubmit}
                      disabled={isSubmitting}
                      className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                    >
                      {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Confirmar Importación
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: WHATSAPP DIRECT SHARE ── */}
      {isShareOpen && sharingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden animate-zoom-in">
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/30">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Send className="h-5 w-5 text-emerald-500" />
                Compartir por WhatsApp
              </h3>
              <button 
                onClick={() => setIsShareOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-150 dark:border-slate-700/50">
                <p className="text-[10px] uppercase font-black tracking-wider text-slate-400 mb-1">Artículo seleccionado</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{sharingItem.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{sharingItem.description || 'Sin descripción'}</p>
                <p className="text-sm font-black text-blue-600 dark:text-blue-400 mt-2">
                  {getCurrencySymbol(sharingItem.currency)}{sharingItem.rate.toLocaleString('es-MX')} {sharingItem.currency}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Seleccionar Lead (CRM) *</label>
                <select
                  required
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">-- Elige un prospecto --</option>
                  {leads.map(lead => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} ({lead.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mensaje de Introducción</label>
                <textarea
                  rows={2}
                  value={customMsgPrefix}
                  onChange={(e) => setCustomMsgPrefix(e.target.value)}
                  className="w-full px-3 py-2 text-xs text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setIsShareOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-lg shadow-emerald-500/20"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Abrir WhatsApp Web
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
