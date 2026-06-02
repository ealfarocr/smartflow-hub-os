import { collection, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../src/lib/firebase';

const TOOLS = [
  { id: 't1', key: 'hasCrm',          label: 'CRM & Pipeline',    desc: 'Gestión de leads y embudo de ventas comercial.',         iconName: 'Users',        color: '#3b82f6', isActive: true, order: 0 },
  { id: 't2', key: 'hasQuotes',       label: 'Cotizaciones',       desc: 'Generación de propuestas técnicas y PDFs.',             iconName: 'FileText',     color: '#8b5cf6', isActive: true, order: 1 },
  { id: 't3', key: 'hasPackages',     label: 'Catálogo / Paquetes',desc: 'Administración de productos y servicios.',             iconName: 'Package',      color: '#f59e0b', isActive: true, order: 2 },
  { id: 't4', key: 'hasAgenda',       label: 'Agenda & Visitas',   desc: 'Calendario de instalaciones y visitas técnicas.',       iconName: 'Calendar',     color: '#10b981', isActive: true, order: 3 },
  { id: 't5', key: 'hasIntegrations', label: 'Integraciones',      desc: 'Conexión con Meta API y servicios externos.',           iconName: 'Blocks',       color: '#ec4899', isActive: true, order: 4 },
];

async function seed() {
  console.log("Iniciando carga de herramientas en la Librería...");
  for (const tool of TOOLS) {
    await setDoc(doc(db, 'available_tools', tool.id), tool);
    console.log(`✅ Registrada: ${tool.label}`);
  }
  console.log("Librería de Herramientas lista.");
}

seed();
