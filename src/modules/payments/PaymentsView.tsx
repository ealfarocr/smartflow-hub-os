import { useState, useEffect } from 'react';
import {
  Plus, Search, Link as LinkIcon, Copy,
  ExternalLink, TrendingUp, Wallet, DollarSign,
  Mail, Info, CreditCard, CheckCircle2, ChevronDown, ChevronUp
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { CreatePaymentLinkModal } from './CreatePaymentLinkModal';

const field = 'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors dark:text-white';
const lbl = 'text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block';

export const PaymentsView = () => {
  const { activeMembership } = useAuthStore();
  const {
    updateSettings,
    paypalEmail: savedPaypalEmail,
    sinpePhone: savedSinpePhone,
    sinpeOwner: savedSinpeOwner,
    sinpeId: savedSinpeId,
    bankAccounts: savedBankAccounts
  } = useSettingsStore();
  const { addToast } = useUIStore();

  const [paypalEmail, setPaypalEmail]     = useState(savedPaypalEmail || '');
  const [sinpePhone, setSinpePhone]       = useState(savedSinpePhone || '');
  const [sinpeOwner, setSinpeOwner]       = useState(savedSinpeOwner || '');
  const [sinpeId, setSinpeId]             = useState(savedSinpeId || '');
  const [bankAccounts, setBankAccounts]   = useState(savedBankAccounts || '');
  const [isSaving, setIsSaving]           = useState(false);
  const [isSavingLocal, setIsSavingLocal] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [paymentLinks, setPaymentLinks]   = useState<any[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [searchQuery, setSearchQuery]     = useState('');
  const [activeTab, setActiveTab]         = useState<'links' | 'history'>('links');
  const [showPaypal, setShowPaypal]       = useState(!savedPaypalEmail);
  const [showLocal, setShowLocal]         = useState(!savedSinpePhone && !savedBankAccounts);

  const fetchLinks = async () => {
    if (!activeMembership?.tenantId) return;
    setIsLoading(true);
    try {
      const { PaymentService } = await import('@/services/firebase/PaymentService');
      const links = await PaymentService.listRequests(activeMembership.tenantId);
      setPaymentLinks(links);
    } catch { /* silent */ } finally { setIsLoading(false); }
  };

  useEffect(() => {
    if (savedPaypalEmail) setPaypalEmail(savedPaypalEmail);
    if (savedSinpePhone)  setSinpePhone(savedSinpePhone);
    if (savedSinpeOwner)  setSinpeOwner(savedSinpeOwner);
    if (savedSinpeId)     setSinpeId(savedSinpeId);
    if (savedBankAccounts) setBankAccounts(savedBankAccounts);
    fetchLinks();
  }, [savedPaypalEmail, savedSinpePhone, savedSinpeOwner, savedSinpeId, savedBankAccounts, activeMembership?.tenantId]);

  const handleSavePaypal = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSaving(true);
    try {
      await updateSettings(activeMembership.tenantId, { paypalEmail });
      addToast('PayPal vinculado correctamente', 'success');
      setShowPaypal(false);
    } catch { addToast('Error al guardar', 'error'); }
    finally { setIsSaving(false); }
  };

  const handleSaveLocal = async () => {
    if (!activeMembership?.tenantId) return;
    setIsSavingLocal(true);
    try {
      await updateSettings(activeMembership.tenantId, { sinpePhone, sinpeOwner, sinpeId, bankAccounts });
      addToast('Métodos locales guardados', 'success');
      setShowLocal(false);
    } catch { addToast('Error al guardar', 'error'); }
    finally { setIsSavingLocal(false); }
  };

  const totalCollected = paymentLinks.filter(l => l.status === 'paid').reduce((a, l) => a + l.amount, 0);
  const pendingCount   = paymentLinks.filter(l => l.status === 'pending').length;

  const filtered = paymentLinks.filter(l =>
    l.customer?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.concept?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const statusStyle = (s: string) =>
    s === 'paid'    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20' :
    s === 'pending' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20' :
                     'bg-slate-100 text-slate-500';

  const statusDot = (s: string) =>
    s === 'paid' ? 'bg-emerald-500' : s === 'pending' ? 'bg-amber-500' : 'bg-slate-400';

  const statusLabel = (s: string) =>
    s === 'paid' ? 'Pagado' : s === 'pending' ? 'Pendiente' : 'Expirado';

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">

      {/* ── Header ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1877F2]/10 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-[#1877F2]" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">Links de Pago</h1>
              <p className="text-xs text-slate-400 font-medium">Cobra desde WhatsApp de forma segura</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Mini KPIs */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 rounded-xl">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">${totalCollected.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/10 rounded-xl">
                <LinkIcon className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-black text-amber-700 dark:text-amber-400">{pendingCount} pendientes</span>
              </div>
            </div>
            <button onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl shadow-sm shadow-[#1877F2]/20 transition-all">
              <Plus className="w-3.5 h-3.5" /> Nuevo link
            </button>
          </div>
        </div>
      </div>

      {/* ── Config Cards Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* PayPal */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <button onClick={() => setShowPaypal(p => !p)}
            className="w-full px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${savedPaypalEmail ? 'bg-emerald-50' : 'bg-[#1877F2]/10'}`}>
                <Wallet className={`w-4 h-4 ${savedPaypalEmail ? 'text-emerald-500' : 'text-[#1877F2]'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-900 dark:text-white">PayPal Business</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pagos internacionales</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {savedPaypalEmail && (
                <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                  <CheckCircle2 className="w-3 h-3" /> Vinculado
                </span>
              )}
              {showPaypal ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </button>

          {showPaypal && (
            <div className="p-5 space-y-4">
              <div>
                <label className={lbl}>Email de tu cuenta PayPal Business</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                  <input type="email" placeholder="ejemplo@paypal.com" value={paypalEmail}
                    onChange={e => setPaypalEmail(e.target.value)}
                    className={`${field} pl-10`} />
                </div>
              </div>

              {/* Commission note */}
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/20 rounded-xl p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[10px] font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Comisión PayPal</span>
                </div>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                  ~5.4% + $0.30 por transacción. Al cobrar $1,000 recibes ~$945 netos.
                </p>
              </div>

              <div className="flex gap-2">
                {savedPaypalEmail === paypalEmail && savedPaypalEmail ? (
                  <div className="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black text-center">
                    ✓ Cuenta vinculada y activa
                  </div>
                ) : (
                  <button onClick={handleSavePaypal} disabled={isSaving || !paypalEmail.includes('@')}
                    className="flex-1 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white rounded-xl text-xs font-black disabled:opacity-40 transition-colors">
                    {isSaving ? 'Guardando...' : 'Vincular cuenta'}
                  </button>
                )}
                <a href="https://www.paypal.com/bizsignup/" target="_blank" rel="noopener noreferrer"
                  className="px-3 py-2.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-500 rounded-xl transition-colors flex items-center" title="Abrir PayPal Business">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Local Payments */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
          <button onClick={() => setShowLocal(p => !p)}
            className="w-full px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${(savedSinpePhone || savedBankAccounts) ? 'bg-emerald-50' : 'bg-[#1877F2]/10'}`}>
                <CreditCard className={`w-4 h-4 ${(savedSinpePhone || savedBankAccounts) ? 'text-emerald-500' : 'text-[#1877F2]'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-900 dark:text-white">Pagos Locales</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">SINPE · SPEI · Pix · Transferencias</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(savedSinpePhone || savedBankAccounts) && (
                <span className="flex items-center gap-1 text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg">
                  <CheckCircle2 className="w-3 h-3" /> Configurado
                </span>
              )}
              {showLocal ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </div>
          </button>

          {showLocal && (
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Teléfono / SINPE móvil</label>
                  <input type="text" placeholder="8888-8888" value={sinpePhone}
                    onChange={e => setSinpePhone(e.target.value)} className={field} />
                </div>
                <div>
                  <label className={lbl}>Cédula / RFC / NIT</label>
                  <input type="text" placeholder="1-1234-1234" value={sinpeId}
                    onChange={e => setSinpeId(e.target.value)} className={field} />
                </div>
              </div>
              <div>
                <label className={lbl}>Nombre del titular</label>
                <input type="text" placeholder="Juan Pérez" value={sinpeOwner}
                  onChange={e => setSinpeOwner(e.target.value)} className={field} />
              </div>
              <div>
                <label className={lbl}>Cuentas / IBAN / CLABE (una por línea)</label>
                <textarea rows={3} value={bankAccounts}
                  onChange={e => setBankAccounts(e.target.value)}
                  placeholder={"BAC San José (Costa Rica)\nIBAN: CR630102000010020030\n\nBBVA Bancomer (México)\nCLABE: 012180001502003004"}
                  className={`${field} resize-none`} />
              </div>

              {/* Zero fee note */}
              <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/20 rounded-xl p-3 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 leading-relaxed">
                  <strong>Cero comisiones.</strong> Las transferencias y pagos móviles locales son 100% gratuitos. El cliente verá botones rápidos para copiar tu info.
                </p>
              </div>

              <button onClick={handleSaveLocal} disabled={isSavingLocal}
                className="w-full py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white rounded-xl text-xs font-black disabled:opacity-40 transition-colors">
                {isSavingLocal ? 'Guardando...' : 'Guardar métodos locales'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Links Table ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
        {/* Table header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
            <button onClick={() => setActiveTab('links')}
              className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${activeTab === 'links' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              Links Activos
            </button>
            <button onClick={() => setActiveTab('history')}
              className={`px-4 py-1.5 rounded-lg text-xs font-black transition-all ${activeTab === 'history' ? 'bg-white dark:bg-slate-800 text-[#1877F2] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
              Historial
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
            <input type="text" placeholder="Buscar cliente o concepto..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium outline-none focus:border-[#1877F2]/40 transition-colors w-56" />
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-12 px-5 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
          <div className="col-span-5 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente / Concepto</div>
          <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Monto</div>
          <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado</div>
          <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha</div>
          <div className="col-span-1" />
        </div>

        {isLoading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#1877F2]/30 border-t-[#1877F2] rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">Cargando links...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <LinkIcon className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-black text-slate-400 mb-1">Sin links aún</p>
            <p className="text-xs text-slate-300 mb-5">Creá tu primer link de pago para empezar a cobrar.</p>
            <button onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl transition-colors">
              <Plus className="w-3.5 h-3.5" /> Crear link
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {filtered.map(link => (
              <div key={link.id} className="grid grid-cols-12 items-center px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors group">
                {/* Cliente */}
                <div className="col-span-5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#1877F2]/10 flex items-center justify-center text-xs font-black text-[#1877F2] shrink-0">
                    {link.customer?.charAt(0).toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">{link.customer}</p>
                    <p className="text-[10px] text-slate-400 truncate">{link.concept}</p>
                  </div>
                </div>
                {/* Monto */}
                <div className="col-span-2">
                  <p className="text-sm font-black text-slate-900 dark:text-white">${link.amount?.toLocaleString()}</p>
                </div>
                {/* Estado */}
                <div className="col-span-2">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-widest ${statusStyle(link.status)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusDot(link.status)}`} />
                    {statusLabel(link.status)}
                  </span>
                </div>
                {/* Fecha */}
                <div className="col-span-2">
                  <p className="text-[10px] text-slate-400 font-bold">
                    {link.createdAt?.seconds
                      ? new Date(link.createdAt.seconds * 1000).toLocaleDateString('es', { day: '2-digit', month: 'short' })
                      : link.date || '—'}
                  </p>
                </div>
                {/* Actions */}
                <div className="col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="p-1.5 hover:bg-[#1877F2]/10 text-slate-400 hover:text-[#1877F2] rounded-lg transition-colors" title="Copiar">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button className="p-1.5 hover:bg-[#1877F2]/10 text-slate-400 hover:text-[#1877F2] rounded-lg transition-colors" title="Ver">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {isCreateModalOpen && (
        <CreatePaymentLinkModal onClose={() => { setIsCreateModalOpen(false); fetchLinks(); }} />
      )}
    </div>
  );
};
