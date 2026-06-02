import React from 'react';
import { Quote, Lead } from '@/types';
import { TenantSettings } from '@/services/firebase/SettingsService';
import { FileText } from 'lucide-react';

interface Props {
  quote: Partial<Quote>;
  lead?: Lead;
  settings?: TenantSettings | null;
}

// Defaults if no settings
const D = {
  primary: '#2563eb',
  secondary: '#0f172a',
  accent: '#f59e0b',
  name: 'PANELESMX',
  taxRate: 16,
  currency: 'MX',
};

export const QuotePdfTemplate: React.FC<Props> = ({ quote, lead, settings }) => {
  const s = settings;
  const pc = s?.branding?.primaryColor || D.primary;
  const sc = s?.branding?.secondaryColor || D.secondary;
  const ac = s?.branding?.accentColor || D.accent;
  const logoUrl = s?.branding?.logoUrl || '';
  const headerStyle = s?.branding?.quoteHeaderStyle || 'modern';
  const companyName = s?.company?.tradeName || s?.company?.legalName || D.name;
  const phone = s?.company?.phone || '';
  const email = s?.company?.email || '';
  const address = s?.company?.physicalAddress || '';
  const website = s?.company?.website || '';
  const taxRate = s?.commercial?.taxRatePercent ?? D.taxRate;
  const currency = quote.currency || s?.commercial?.currency || D.currency;
  const paymentTerms = s?.commercial?.defaultPaymentTerms || '';

  const getCurrencySymbol = (currencyCode?: string) => {
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

  // Light tint of primary for backgrounds (simple opacity approach via hex)
  const primaryLight = pc + '18'; // ~10% opacity
  const primaryMid = pc + '30';

  // Company identity block (logo or text)
  const renderIdentity = (style: 'light' | 'dark', height = 80) => {
    const textColor = style === 'light' ? '#ffffff' : sc;
    const subColor = style === 'light' ? 'rgba(255,255,255,0.85)' : '#64748b';

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        {logoUrl ? (
          <div style={{ minWidth: '120px', display: 'flex', justifyContent: 'center' }}>
            <img 
              src={logoUrl} 
              alt={companyName} 
              crossOrigin="anonymous" 
              style={{ 
                height: `${height}px`, 
                width: 'auto', 
                maxWidth: '280px', 
                objectFit: 'contain',
                filter: style === 'light' ? 'brightness(0) invert(1)' : 'none' // Simple trick if logo is dark on dark
              }} 
            />
          </div>
        ) : (
          <div style={{ 
            width: '80px', 
            height: '80px', 
            backgroundColor: style === 'light' ? 'rgba(255,255,255,0.1)' : pc + '10',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${style === 'light' ? 'rgba(255,255,255,0.2)' : pc + '20'}`
          }}>
            <FileText style={{ width: '40px', height: '40px', color: style === 'light' ? '#ffffff' : pc }} />
          </div>
        )}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          borderLeft: `3px solid ${style === 'light' ? 'rgba(255,255,255,0.3)' : pc}`, 
          paddingLeft: '32px',
          minHeight: '80px'
        }}>
          <p style={{ 
            color: textColor, 
            fontWeight: 900, 
            fontSize: '28px', 
            margin: 0, 
            lineHeight: 1, 
            letterSpacing: '-1px',
            textTransform: 'uppercase'
          }}>
            {companyName}
          </p>
          <p style={{ 
            color: subColor, 
            marginTop: '8px', 
            fontWeight: 800, 
            fontSize: '11px', 
            margin: '8px 0 0 0', 
            textTransform: 'uppercase', 
            letterSpacing: '3px' 
          }}>
            Propuesta Técnica y Comercial
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      id="quote-pdf-template-safe"
      className="uppercase-first"
      style={{
        position: 'fixed',
        left: '-9999px',
        top: '-9999px',
        width: '1000px', // Increased canvas width for better resolution
        backgroundColor: '#ffffff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ════════════════ HEADER ════════════════ */}
      {headerStyle === 'classic' && (
        <div style={{ padding: '56px 64px', backgroundColor: pc }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {renderIdentity('light')}
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ 
                backgroundColor: '#ffffff', 
                padding: '12px 32px', 
                borderRadius: '8px', 
                color: pc, 
                fontWeight: 900, 
                fontSize: '24px', 
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                marginBottom: '8px'
              }}>
                {quote.quoteNumber}
              </div>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Emisión: {quote.date}</p>
              <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.9)', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Vence: {quote.validUntil}</p>
            </div>
          </div>
        </div>
      )}

      {headerStyle === 'modern' && (
        <div style={{ padding: '64px', background: `linear-gradient(135deg, ${pc}, ${sc})`, position: 'relative', overflow: 'hidden' }}>
          {/* Decorative element */}
          <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '200px', height: '200px', background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }}></div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
            {renderIdentity('light')}
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
              <div style={{ 
                backgroundColor: ac, 
                padding: '14px 40px', 
                borderRadius: '50px', 
                color: '#ffffff', 
                fontWeight: 900, 
                fontSize: '20px', 
                boxShadow: '0 8px 25px rgba(0,0,0,0.25)',
                border: '2px solid rgba(255,255,255,0.2)'
              }}>
                {quote.quoteNumber}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px' }}>Emisión: {quote.date}</p>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px' }}>Válido: {quote.validUntil}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {headerStyle === 'minimal' && (
        <div style={{ padding: '56px 64px', backgroundColor: '#ffffff', borderBottom: `4px solid ${pc + '20'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {renderIdentity('dark')}
            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ color: pc, fontWeight: 900, fontSize: '32px', letterSpacing: '-1.5px', marginBottom: '4px' }}>
                {quote.quoteNumber}
              </div>
              <div style={{ height: '4px', width: '60px', backgroundColor: ac, borderRadius: '2px', marginBottom: '8px' }}></div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px' }}>Emisión: {quote.date}</p>
              <p style={{ fontSize: '12px', color: '#64748b', margin: 0, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px' }}>Vence: {quote.validUntil}</p>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ BODY ════════════════ */}
      <div style={{ padding: '40px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
        {/* Client + System info */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: pc, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px', marginTop: 0 }}>Preparado Para</h4>
            <p style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', margin: 0 }}>{lead?.name}</p>
            <p style={{ fontSize: '14px', color: '#475569', marginTop: '4px', marginBottom: 0 }}>{lead?.city} • {quote.clientType}</p>
            <p style={{ fontSize: '14px', color: '#475569', marginTop: '4px', marginBottom: 0 }}>{lead?.phone}</p>
          </div>
          <div>
            <h4 style={{ fontSize: '12px', fontWeight: 700, color: pc, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px', marginTop: 0 }}>Información del Sistema</h4>
            <div style={{ fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                <span style={{ color: '#64748b' }}>Configuración</span>
                <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right', width: '50%' }}>{quote.systemRecommended}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                <span style={{ color: '#64748b' }}>Potencia Instalada</span>
                <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right', width: '50%' }}>{quote.powerKw} kW</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                <span style={{ color: '#64748b' }}>Cant. Módulos</span>
                <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right', width: '50%' }}>{quote.panelsCount} Uds</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                <span style={{ color: '#64748b' }}>Inversor</span>
                <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right', width: '50%' }}>{quote.inverter}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Savings highlight */}
        <div style={{ backgroundColor: primaryLight, borderRadius: '12px', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${primaryMid}` }}>
          <div>
            <p style={{ fontSize: '14px', fontWeight: 600, color: sc, margin: 0 }}>Ahorro Bimestral Proyectado</p>
            <p style={{ fontSize: '30px', fontWeight: 900, color: pc, marginTop: '4px', marginBottom: 0 }}>{getCurrencySymbol(currency)}{quote.savingsEstimado?.toLocaleString('es-MX')} {currency}</p>
          </div>
          <FileText size={64} color={primaryMid} />
        </div>

        {/* Financial table (Itemized for Multi-niche) */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: '14px', textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead style={{ backgroundColor: '#f8fafc', color: '#64748b' }}>
              <tr>
                <th style={{ padding: '16px 24px', fontWeight: 600, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px' }}>Concepto / Partida</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', width: '100px', textAlign: 'center' }}>Cant.</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', width: '150px', textAlign: 'right' }}>Precio Unit.</th>
                <th style={{ padding: '16px 24px', fontWeight: 600, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', width: '150px', textAlign: 'right' }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {quote.items && quote.items.length > 0 ? (
                quote.items.map((item, idx) => (
                  <tr key={item.id || idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a' }}>{item.description}</td>
                    <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a', textAlign: 'center' }}>{item.quantity}</td>
                    <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>{getCurrencySymbol(currency)}{item.rate?.toLocaleString('es-MX')}</td>
                    <td style={{ padding: '16px 24px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>{getCurrencySymbol(currency)}{item.amount?.toLocaleString('es-MX')}</td>
                  </tr>
                ))
              ) : (
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a' }}>{quote.systemRecommended || 'Servicio o Sistema Estándar'}</td>
                  <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a', textAlign: 'center' }}>1</td>
                  <td style={{ padding: '16px 24px', fontWeight: 500, color: '#0f172a', textAlign: 'right' }}>{getCurrencySymbol(currency)}{quote.subtotal?.toLocaleString('es-MX')}</td>
                  <td style={{ padding: '16px 24px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>{getCurrencySymbol(currency)}{quote.subtotal?.toLocaleString('es-MX')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals Summary */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
          <div style={{ width: '350px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#64748b' }}>
              <span>Subtotal</span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>{getCurrencySymbol(currency)}{quote.subtotal?.toLocaleString('es-MX')}</span>
            </div>
            {Number(quote.discount) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#ef4444' }}>
                <span>Descuento</span>
                <span style={{ fontWeight: 600 }}>-{getCurrencySymbol(currency)}{quote.discount?.toLocaleString('es-MX')}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#64748b' }}>
              <span>IVA ({taxRate}%)</span>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>{getCurrencySymbol(currency)}{quote.taxes?.toLocaleString('es-MX')}</span>
            </div>
            <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '12px', marginTop: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>
              <span>Inversión Total</span>
              <span style={{ fontSize: '20px', fontWeight: 900, color: pc }}>{getCurrencySymbol(currency)}{quote.total?.toLocaleString('es-MX')} {currency}</span>
            </div>
          </div>
        </div>

        {/* Terms + Payment terms */}
        {(quote.remarks || paymentTerms) && (
          <div style={{ fontSize: '12px', color: '#64748b', whiteSpace: 'pre-line', borderTop: '1px solid #e2e8f0', paddingTop: '24px' }}>
            {quote.remarks && (
              <>
                <strong style={{ display: 'block', marginBottom: '8px', color: '#475569' }}>Términos y Condiciones:</strong>
                {quote.remarks}
              </>
            )}
            {paymentTerms && (
              <div style={{ marginTop: quote.remarks ? '16px' : '0' }}>
                <strong style={{ display: 'block', marginBottom: '8px', color: '#475569' }}>Condiciones de Pago:</strong>
                {paymentTerms}
              </div>
            )}
          </div>
        )}

        {/* Footer with company info */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', fontSize: '11px', color: '#94a3b8' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
            {phone && <span>📞 {phone}</span>}
            {email && <span>✉ {email}</span>}
            {website && <span>🌐 {website}</span>}
            {address && <span>📍 {address}</span>}
          </div>
          <div style={{ marginTop: '8px', opacity: 0.8 }}>
            Paneles Solares MX • PDF_ENGINE_V3_LOGO_FIX
          </div>
        </div>
      </div>
    </div>
  );
};
