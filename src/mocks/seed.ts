import { Lead, Package } from '@/types';

export const mockLeads: Lead[] = [
  {
    id: 'l-1',
    tenantId: 't-1',
    name: 'Carlos Mendoza',
    phone: '5512345678',
    city: 'Monterrey',
    clientType: 'Residencial',
    keyData: '$2,500 MX bimestral',
    advisorId: 'u-1',
    source: 'WhatsApp',
    stage: 'Nuevo',
    lastActivity: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    orderIndex: 0
  },
  {
    id: 'l-2',
    tenantId: 't-1',
    name: 'Empresa Alpha S.A.',
    phone: '8119876543',
    city: 'Guadalajara',
    clientType: 'Comercial',
    keyData: 'Tarifa GDMTO',
    advisorId: 'u-1',
    source: 'Facebook',
    stage: 'Seguimiento',
    lastActivity: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    orderIndex: 0
  }
];

export const mockPackages: Package[] = [
  {
    id: 'p-1',
    tenantId: 't-1',
    name: 'Residencial Básico 4 Paneles',
    clientType: 'Residencial',
    powerKw: 2.2,
    panelsCount: 4,
    inverter: 'Microinversor Hoymiles 2000W',
    savingsEstimado: 1200,
    price: 45000,
    description: 'Ideal para consumos bimestrales menores a $1,500 MX.',
    isActive: true
  }
];
