import { useState, useEffect } from 'react';
import {
  Plus, Search, Receipt, Copy,
  ExternalLink, TrendingUp, Wallet, DollarSign,
  Mail, Info, CreditCard, CheckCircle2, ChevronDown, ChevronUp,
  X, User, Trash2, Send
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { CreatePaymentLinkModal } from './CreatePaymentLinkModal';
import { PaymentService, LocalPaymentMethod } from '@/services/firebase/PaymentService';
import type { BankAccount } from '@/services/firebase/SettingsService';

const field = 'w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border-2 border-transparent focus:border-[#1877F2]/30 rounded-xl outline-none text-sm font-medium transition-colors dark:text-white';
const lbl = 'text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block';

const methodLabel = (m?: string) => m === 'sinpe' ? 'SINPE Móvil' : m === 'bank' ? 'Transferencia bancaria' : '—';

/**
 * Modal de confirmación de pago manual — solo se renderiza si el link está
 * pending y el que abre el listado ya pasó el gate de rol (Owner/Admin) en
 * PaymentsView. La regla real vive en firestore.rules (isTenantAdmin); este
 * gate en UI solo evita mostrar la acción a quien no puede usarla.
 */
const MarkAsPaidModal = ({ link, onClose, onConfirmed }: { link: any; onClose: () => void; onConfirmed: () => void }) => {
  const { addToast } = useUIStore();
  const { activeMembership, user } = useAuthStore();
  const availableMethods: LocalPaymentMethod[] = (link.enabledMethods || []).filter((m: string) => m === 'sinpe' || m === 'bank');
  const [method, setMethod] = useState<LocalPaymentMethod | ''>(availableMethods[0] || '');
  const [reference, setReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!method || !activeMembership?.userId) return;
    setIsSubmitting(true);
    try {
      await PaymentService.markAsPaid(link.id, {
        paymentMethod: method,
        paymentReference: reference.trim() || undefined,
        paidByUid: activeMembership.userId,
        paidByName: activeMembership.name || user?.name || activeMembership.email || 'Admin',
      });
      addToast('Pago confirmado', 'success');
      onConfirmed();
      onClose();
    } catch (err: any) {
      addToast(err?.message || 'No se pudo confirmar el pago', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40 animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="bg-emerald-500 p-6 text-white relative">
          <button onClick={onClose} className="absolute right-5 top-5 p-1.5 hover:bg-white/10 rounded-xl transition-colors">
            <X className="w-4 h-4 text-white/70" />
          </button>
          <h3 className="text-lg font-black tracking-tight">Confirmar pago recibido</h3>
          <p className="text-white/70 text-[10px] font-bold uppercase tracking-[0.2em]">Registro administrativo — no valida el banco automáticamente</p>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</span>
              <span className="text-sm font-black text-slate-900 dark:text-white">{link.customer}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concepto</span>
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 text-right">{link.concept}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monto</span>
              <span className="text-sm font-black text-emerald-600">${link.amount?.toLocaleString()} {link.currency}</span>
            </div>
          </div>

          <div>
            <label className={lbl}>Método de pago recibido</label>
            {availableMethods.length === 0 ? (
              <p className="text-xs text-amber-600 font-medium">Este cobro no tiene métodos locales habilitados.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {availableMethods.map(m => (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className={`py-3 rounded-xl text-xs font-black border-2 transition-colors ${method === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}>
                    {methodLabel(m)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={lbl}>Referencia / comprobante (opcional)</label>
            <input type="text" placeholder="Ej: últimos 4 dígitos, número de comprobante" value={reference}
              onChange={e => setReference(e.target.value)} className={field} />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} disabled={isSubmitting}
              className="flex-1 py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-40">
              Cancelar
            </button>
            <button onClick={handleConfirm} disabled={isSubmitting || !method}
              className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-40">
              {isSubmitting ? 'Confirmando...' : 'Confirmar pago recibido'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  const [bankAccounts, setBankAccounts]   = useState<BankAccount[]>(savedBankAccounts || []);

  const addBankAccount = () => {
    setBankAccounts(prev => [...prev, { id: crypto.randomUUID(), bankName: '', accountNumber: '', owner: '' }]);
  };
  const updateBankAccount = (id: string, patch: Partial<BankAccount>) => {
    setBankAccounts(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  };
  const removeBankAccount = (id: string) => {
    setBankAccounts(prev => prev.filter(a => a.id !== id));
  };
  const [isSaving, setIsSaving]           = useState(false);
  const [isSavingLocal, setIsSavingLocal] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [paymentLinks, setPaymentLinks]   = useState<any[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [searchQuery, setSearchQuery]     = useState('');
  const [activeTab, setActiveTab]         = useState<'links' | 'history'>('links');
  const [showPaypal, setShowPaypal]       = useState(!savedPaypalEmail);
  const [showLocal, setShowLocal]         = useState(!savedSinpePhone && !savedBankAccounts);
  const [markPaidLink, setMarkPaidLink]   = useState<any | null>(null);

  // Solo Owner/Admin pueden confirmar pagos manuales — la regla real vive en
  // firestore.rules (isTenantAdmin), esto solo evita mostrar la acción a
  // quien no puede usarla.
  const canMarkAsPaid = activeMembership?.role === 'Owner' || activeMembership?.role === 'Admin';

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
    if (savedBankAccounts && savedBankAccounts.length > 0) setBankAccounts(savedBankAccounts);
    fetchLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPaypalEmail, savedSinpePhone, savedSinpeOwner, savedSinpeId, JSON.stringify(savedBankAccounts), activeMembership?.tenantId]);

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
      const cleanBankAccounts = bankAccounts.filter(a => a.accountNumber.trim());
      await updateSettings(activeMembership.tenantId, { sinpePhone, sinpeOwner, sinpeId, bankAccounts: cleanBankAccounts });
      addToast('Instrucciones de pago locales guardadas', 'success');
      setShowLocal(false);
    } catch { addToast('Error al guardar', 'error'); }
    finally { setIsSavingLocal(false); }
  };

  const totalCollected = paymentLinks.filter(l => l.status === 'paid').reduce((a, l) => a + l.amount, 0);
  const pendingCount   = paymentLinks.filter(l => l.status === 'pending').length;

  // "Links Activos" = todavía accionables (pending/expired). "Historial" =
  // ya resueltos (paid) — antes ambos tabs mostraban la misma lista completa,
  // el tab no filtraba nada.
  const filtered = paymentLinks
    .filter(l => activeTab === 'history' ? l.status === 'paid' : l.status !== 'paid')
    .filter(l =>
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
              <Receipt className="w-5 h-5 text-[#1877F2]" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900 dark:text-white">Cobros</h1>
              <p className="text-xs text-slate-400 font-medium">Organizá cómo tus clientes te pagan desde WhatsApp</p>
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
                <Receipt className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-black text-amber-700 dark:text-amber-400">{pendingCount} pendientes</span>
              </div>
            </div>
            <button onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl shadow-sm shadow-[#1877F2]/20 transition-all">
              <Send className="w-3.5 h-3.5" /> Enviar instrucciones de pago
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
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${(savedSinpePhone || (savedBankAccounts && savedBankAccounts.length > 0)) ? 'bg-emerald-50' : 'bg-[#1877F2]/10'}`}>
                <CreditCard className={`w-4 h-4 ${(savedSinpePhone || (savedBankAccounts && savedBankAccounts.length > 0)) ? 'text-emerald-500' : 'text-[#1877F2]'}`} />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-900 dark:text-white">Instrucciones de Pago Locales</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">SINPE · SPEI · Pix · Transferencias</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(savedSinpePhone || (savedBankAccounts && savedBankAccounts.length > 0)) && (
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
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={lbl}>Cuentas bancarias / IBAN</label>
                  <button type="button" onClick={addBankAccount}
                    className="flex items-center gap-1 text-[10px] font-black text-[#1877F2] uppercase tracking-widest hover:underline">
                    <Plus className="w-3 h-3" /> Agregar cuenta
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 -mt-1">
                  Cada cuenta se muestra por separado, con su propio botón de copiar — no como un bloque de texto único.
                </p>
                {bankAccounts.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2">Sin cuentas agregadas todavía.</p>
                ) : (
                  <div className="space-y-2">
                    {bankAccounts.map((acc) => (
                      <div key={acc.id} className="bg-slate-50 dark:bg-slate-900 rounded-xl p-3 space-y-2 border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <input type="text" placeholder="Nombre del banco (Ej: BAC San José)" value={acc.bankName}
                            onChange={e => updateBankAccount(acc.id, { bankName: e.target.value })}
                            className={`${field} py-2 text-xs`} />
                          <button type="button" onClick={() => removeBankAccount(acc.id)}
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0" title="Quitar cuenta">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <input type="text" placeholder="Cuenta / IBAN / CLABE" value={acc.accountNumber}
                          onChange={e => updateBankAccount(acc.id, { accountNumber: e.target.value })}
                          className={`${field} py-2 text-xs font-mono`} />
                        <input type="text" placeholder="Titular de la cuenta (opcional)" value={acc.owner || ''}
                          onChange={e => updateBankAccount(acc.id, { owner: e.target.value })}
                          className={`${field} py-2 text-xs`} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Zero fee note */}
              <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/20 rounded-xl p-3 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 leading-relaxed">
                  <strong>Cero comisiones.</strong> SmartFlow no procesa ni retiene el dinero — solo organiza y muestra tus datos de cobro. El pago va directo del cliente a tu cuenta.
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
              Pendientes
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
          <div className="col-span-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente / Concepto</div>
          <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Monto</div>
          {activeTab === 'history' ? (
            <>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Método</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Pagado el</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Confirmó</div>
            </>
          ) : (
            <>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Estado</div>
              <div className="col-span-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha</div>
              <div className="col-span-2" />
            </>
          )}
        </div>

        {isLoading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#1877F2]/30 border-t-[#1877F2] rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-400 font-medium">Cargando links...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-14 text-center">
            <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
            <p className="text-sm font-black text-slate-400 mb-1">Sin cobros aún</p>
            <p className="text-xs text-slate-300 mb-5">Enviá tus primeras instrucciones de pago para empezar a cobrar.</p>
            <button onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1877F2] hover:bg-blue-600 text-white text-xs font-black rounded-xl transition-colors">
              <Send className="w-3.5 h-3.5" /> Enviar instrucciones
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50 dark:divide-slate-700/50">
            {filtered.map(link => (
              <div key={link.id} className="grid grid-cols-12 items-center px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors group">
                {/* Cliente */}
                <div className="col-span-4 flex items-center gap-3">
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

                {activeTab === 'history' ? (
                  <>
                    {/* Método */}
                    <div className="col-span-2">
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{methodLabel(link.paymentMethod)}</p>
                      {link.paymentReference && (
                        <p className="text-[9px] text-slate-400 truncate" title={link.paymentReference}>Ref: {link.paymentReference}</p>
                      )}
                    </div>
                    {/* Pagado el */}
                    <div className="col-span-2">
                      <p className="text-[10px] text-slate-400 font-bold">
                        {link.paidAt?.seconds
                          ? new Date(link.paidAt.seconds * 1000).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
                          : '—'}
                      </p>
                    </div>
                    {/* Confirmó */}
                    <div className="col-span-2 flex items-center gap-1.5">
                      <User className="w-3 h-3 text-slate-300 shrink-0" />
                      <p className="text-xs font-bold text-slate-600 dark:text-slate-300 truncate">{link.paidByName || '—'}</p>
                    </div>
                  </>
                ) : (
                  <>
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
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      {link.status === 'pending' && canMarkAsPaid && (
                        <button onClick={() => setMarkPaidLink(link)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors opacity-0 group-hover:opacity-100">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar pago
                        </button>
                      )}
                      <button className="p-1.5 hover:bg-[#1877F2]/10 text-slate-400 hover:text-[#1877F2] rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Copiar">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button className="p-1.5 hover:bg-[#1877F2]/10 text-slate-400 hover:text-[#1877F2] rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Ver">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isCreateModalOpen && (
        <CreatePaymentLinkModal onClose={() => { setIsCreateModalOpen(false); fetchLinks(); }} />
      )}

      {markPaidLink && (
        <MarkAsPaidModal
          link={markPaidLink}
          onClose={() => setMarkPaidLink(null)}
          onConfirmed={fetchLinks}
        />
      )}
    </div>
  );
};
