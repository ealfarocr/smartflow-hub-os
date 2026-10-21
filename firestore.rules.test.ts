import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { setDoc, doc, getDoc, deleteDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';

// LOOP Fase 20, casos 14-16 — aislamiento multi-tenant y privacidad de las
// 4 colecciones nuevas (vendor_credentials, trusted_devices, work_sessions,
// work_status_events) + el endurecimiento de user_presence. Corre contra el
// emulador REAL de Firestore (no un mock de las Rules) — requiere
// `firebase emulators:start --only firestore` corriendo en el puerto de
// firebase.json antes de `npm run test`.

const PROJECT_ID = 'smartflow-rules-test';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed con Admin SDK (bypassa Rules) — memberships 'active' para que
  // isTenantMember/isTenantAdmin resuelvan durante los tests.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'memberships', 'vendorA_tenantA'), {
      tenantId: 'tenantA', userId: 'vendorA', status: 'active', role: 'Asesor Comercial',
    });
    await setDoc(doc(db, 'memberships', 'ownerA_tenantA'), {
      tenantId: 'tenantA', userId: 'ownerA', status: 'active', role: 'Owner',
    });
    await setDoc(doc(db, 'memberships', 'vendorB_tenantB'), {
      tenantId: 'tenantB', userId: 'vendorB', status: 'active', role: 'Asesor Comercial',
    });
  });
});

describe('caso 14 — tenant A no puede leer presencia de tenant B', () => {
  it('user_presence de otro tenant es ilegible', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_presence', 'tenantB_vendorB'), {
        uid: 'vendorB', tenantId: 'tenantB', status: 'online',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(getDoc(doc(vendorA, 'user_presence', 'tenantB_vendorB')));
  });

  it('trusted_devices de otro tenant es ilegible', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trusted_devices', 'device-b1'), {
        tenantId: 'tenantB', userId: 'vendorB', status: 'active', label: 'x',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(getDoc(doc(vendorA, 'trusted_devices', 'device-b1')));
  });

  it('work_sessions de otro tenant es ilegible', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'work_sessions', 'sess-b1'), {
        tenantId: 'tenantB', userId: 'vendorB', activeSeconds: 0, idleSeconds: 0, status: 'working',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(getDoc(doc(vendorA, 'work_sessions', 'sess-b1')));
  });
});

describe('caso 15 — un asesor no puede editar la presencia de otro asesor', () => {
  it('vendorA no puede escribir user_presence de vendorA-otro dentro del mismo tenant', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'memberships', 'vendorA2_tenantA'), {
        tenantId: 'tenantA', userId: 'vendorA2', status: 'active', role: 'Asesor Comercial',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA2'), {
      uid: 'vendorA2', tenantId: 'tenantA', status: 'online',
    }));
  });

  it('vendorA no puede leer user_presence de vendorA2 (no es Owner/Admin)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'memberships', 'vendorA2_tenantA'), {
        tenantId: 'tenantA', userId: 'vendorA2', status: 'active', role: 'Asesor Comercial',
      });
      await setDoc(doc(ctx.firestore(), 'user_presence', 'tenantA_vendorA2'), {
        uid: 'vendorA2', tenantId: 'tenantA', status: 'online',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(getDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA2')));
  });
});

describe('caso 16 — Owner/Admin sí puede leer la presencia de su equipo', () => {
  it('ownerA lee user_presence de vendorA (mismo tenant)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_presence', 'tenantA_vendorA'), {
        uid: 'vendorA', tenantId: 'tenantA', status: 'online',
      });
    });
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertSucceeds(getDoc(doc(ownerA, 'user_presence', 'tenantA_vendorA')));
  });

  it('ownerA lee trusted_devices de su tenant', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trusted_devices', 'device-a1'), {
        tenantId: 'tenantA', userId: 'vendorA', status: 'active', label: 'x',
      });
    });
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertSucceeds(getDoc(doc(ownerA, 'trusted_devices', 'device-a1')));
  });
});

describe('vendor_credentials — inalcanzable desde el cliente bajo cualquier rol', () => {
  it('ni siquiera el propio Owner del tenant puede leerlo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'vendor_credentials', 'vendorA_tenantA'), {
        tenantId: 'tenantA', pinHash: 'x', pinSalt: 'y',
      });
    });
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(getDoc(doc(ownerA, 'vendor_credentials', 'vendorA_tenantA')));
  });
  it('escritura directa desde el cliente también falla', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(setDoc(doc(ownerA, 'vendor_credentials', 'vendorA_tenantA'), { pinHash: 'x' }));
  });
});

describe('trusted_devices — escritura directa desde el cliente siempre falla (solo Admin SDK)', () => {
  it('ni el propio dueño puede auto-registrar un dispositivo por escritura directa', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'trusted_devices', 'device-fake'), {
      tenantId: 'tenantA', userId: 'vendorA', status: 'active', label: 'Auto-otorgado',
    }));
  });
});

// CHECKPOINT DE SEGURIDAD (post-Bloque 5): work_sessions y work_status_events
// pasaron de "self-write" a "if false" total — el cliente ya NO puede
// crear ni actualizar estos documentos por ningún camino, ni siquiera los
// propios. Todo pasa por setOperationalStatus/tickPresence (Admin SDK, ver
// functions/src/index.ts), que nunca están sujetas a estas Rules.
describe('work_sessions — cliente sin write directo bajo ningún caso (checkpoint de seguridad)', () => {
  it('vendorA no puede CREAR su propio work_session directamente', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'work_sessions', 'sess-fake'), {
      tenantId: 'tenantA', userId: 'vendorA', activeSeconds: 0, idleSeconds: 0, status: 'working',
    }));
  });
  it('vendorA no puede falsificar startedAt/endedAt de un work_session ya existente', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'work_sessions', 'sess-a1'), {
        tenantId: 'tenantA', userId: 'vendorA', startedAt: new Date('2026-01-01'), endedAt: null,
        activeSeconds: 0, idleSeconds: 0, status: 'working',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'work_sessions', 'sess-a1'), {
      tenantId: 'tenantA', userId: 'vendorA', startedAt: new Date('2020-01-01'), endedAt: new Date(),
      activeSeconds: 999999, idleSeconds: 0, status: 'working',
    }, { merge: true }));
  });
  it('vendorA no puede inflar activeSeconds/idleSeconds de un work_session ya existente', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'work_sessions', 'sess-a2'), {
        tenantId: 'tenantA', userId: 'vendorA', activeSeconds: 0, idleSeconds: 0, status: 'working',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'work_sessions', 'sess-a2'), { activeSeconds: 14400 }, { merge: true }));
  });
});

describe('work_status_events — cliente sin write directo bajo ningún caso (checkpoint de seguridad)', () => {
  it('vendorA no puede crear su propio evento directamente', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'work_status_events', 'ev1'), {
      tenantId: 'tenantA', userId: 'vendorA', fromStatus: null, toStatus: 'working',
    }));
  });
  it('nadie puede modificar un evento ya creado (append-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'work_status_events', 'ev1'), {
        tenantId: 'tenantA', userId: 'vendorA', fromStatus: null, toStatus: 'working',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'work_status_events', 'ev1'), {
      tenantId: 'tenantA', userId: 'vendorA', fromStatus: 'working', toStatus: 'lunch',
    }));
  });
});

describe('user_presence — el cliente no puede tocar operationalStatus/activeWorkSessionId por su cuenta (checkpoint de seguridad)', () => {
  it('crear un user_presence propio CON operationalStatus seteado falla', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA'), {
      uid: 'vendorA', tenantId: 'tenantA', status: 'online', operationalStatus: 'working',
    }));
  });
  it('crear un user_presence propio SIN operationalStatus (heartbeat normal) sigue funcionando', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertSucceeds(setDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA'), {
      uid: 'vendorA', tenantId: 'tenantA', status: 'online', lastSeenAt: new Date().toISOString(),
    }));
  });
  it('actualizar el propio user_presence intentando fijar operationalStatus="working" falla', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_presence', 'tenantA_vendorA'), {
        uid: 'vendorA', tenantId: 'tenantA', status: 'online',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(setDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA'), {
      operationalStatus: 'working',
    }, { merge: true }));
  });
  it('actualizar el propio user_presence con campos de heartbeat normales (status/lastSeenAt) sigue funcionando', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_presence', 'tenantA_vendorA'), {
        uid: 'vendorA', tenantId: 'tenantA', status: 'online',
      });
    });
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertSucceeds(setDoc(doc(vendorA, 'user_presence', 'tenantA_vendorA'), {
      status: 'idle', lastSeenAt: new Date().toISOString(),
    }, { merge: true }));
  });
});

describe('login_handles — inalcanzable desde el cliente (checkpoint de seguridad)', () => {
  it('nadie puede leer el índice de usuarios de un tenant (evitaría enumeración)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'login_handles', 'tenantA_michelle'), {
        tenantId: 'tenantA', membershipId: 'm1',
      });
    });
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(getDoc(doc(ownerA, 'login_handles', 'tenantA_michelle')));
  });
  it('escritura directa desde el cliente falla', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(setDoc(doc(ownerA, 'login_handles', 'tenantA_michelle'), { membershipId: 'm1' }));
  });
});

// LOOP Fase 9 (canary Embedded Signup) — bug real encontrado: la regla de
// integrations usaba "resource.data.tenantId || request.resource.data.tenantId"
// como si fuera un "usar resource, si no existe usar request" al estilo JS.
// El operador || de Firestore Rules exige booleanos en ambos lados; con
// resource.data.tenantId como string no vacío, eso tira un error de tipo
// ("Received: [string] Expected: [bool]") y Firestore trata cualquier error
// de evaluación de regla como DENY — sin importar el rol. Confirmado con el
// emulador real: rompía el read/delete para TODO usuario (Owner, Admin, e
// incluso SuperAdmin, porque el error aborta la expresión completa antes de
// llegar al || isSuperAdmin()) sobre cualquier doc EXISTENTE. Fix: para
// read/delete, resource siempre existe (no se puede leer/borrar lo que no
// existe), así que el fallback a request nunca hacía falta ahí.
describe('integrations — read (get y list) tras el fix del bug de tipos en ||', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'memberships', 'adminA_tenantA'), { tenantId: 'tenantA', userId: 'adminA', status: 'active', role: 'Admin' });
      await setDoc(doc(db, 'users', 'superadmin1'), { isSuperAdmin: true });
      await setDoc(doc(db, 'integrations', 'intA'), { tenantId: 'tenantA', provider: 'whatsapp', isActive: true, phoneNumberId: '123', accessToken: 'tok' });
      await setDoc(doc(db, 'integrations', 'intB'), { tenantId: 'tenantB', provider: 'whatsapp', isActive: true, phoneNumberId: '456', accessToken: 'tok2' });
    });
  });

  it('Owner de tenantA lee su propia integración (get)', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertSucceeds(getDoc(doc(ownerA, 'integrations', 'intA')));
  });

  it('Owner de tenantA lee su propia integración (list — shape real de IntegrationService.getWhatsAppConfig)', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    const q = query(collection(ownerA, 'integrations'), where('tenantId', '==', 'tenantA'), where('provider', '==', 'whatsapp'), limit(1));
    await assertSucceeds(getDocs(q));
  });

  it('Admin de tenantA lee la integración de su tenant', async () => {
    const adminA = testEnv.authenticatedContext('adminA').firestore();
    await assertSucceeds(getDoc(doc(adminA, 'integrations', 'intA')));
  });

  it('Asesor Comercial de tenantA NO puede leer la integración', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(getDoc(doc(vendorA, 'integrations', 'intA')));
  });

  it('Owner de tenantA NO puede leer la integración de tenantB (get)', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(getDoc(doc(ownerA, 'integrations', 'intB')));
  });

  it('Owner de tenantA NO puede leer integraciones de tenantB vía query', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    const q = query(collection(ownerA, 'integrations'), where('tenantId', '==', 'tenantB'), where('provider', '==', 'whatsapp'), limit(1));
    await assertFails(getDocs(q));
  });

  it('SuperAdmin lee la integración de cualquier tenant', async () => {
    const sa = testEnv.authenticatedContext('superadmin1').firestore();
    await assertSucceeds(getDoc(doc(sa, 'integrations', 'intA')));
    await assertSucceeds(getDoc(doc(sa, 'integrations', 'intB')));
  });
});

// FIX URGENTE — Owner local solo veía su propio usuario en /usuarios.
// Causa raíz real: NO era esta query (list sobre memberships con
// where('tenantId','==',...)) — esa ya funcionaba bien, confirmado acá
// abajo con el dataset real de USADITOS (10 memberships, 1 Owner activo +
// 9 prepared con userId:null). El bug estaba en useUserStore.subscribe,
// que además llamaba getUserProfile(m.userId) — un getDoc sobre
// users/{uid} de CADA compañero — y esa colección solo permite leer el
// propio perfil o SuperAdmin. Un getDoc rechazado adentro de un
// Promise.all tira TODO el lote, así que teamMembers se quedaba pegado en
// el primer snapshot (antes de que hubiera un segundo miembro con userId
// real). El fix fue dejar de leer users/{uid} de otros — este describe
// cubre los 7 escenarios pedidos, todos contra la query real de
// memberships, sin ningún getUserProfile de por medio.
describe('FIX — Owner/Admin local ve el equipo completo de su tenant (no solo a sí mismo)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // Dataset real de USADITOS: 1 Owner activo (ID {uid}_{tenantId}), 1
      // Admin activo, 1 Asesor activo, varios prepared/pending con
      // userId:null, y uno suspended con userId real.
      await setDoc(doc(db, 'memberships', 'ownerA_tenantA'), { tenantId: 'tenantA', userId: 'ownerA', status: 'active', role: 'Owner', name: 'EDUARDO ADMIN' });
      await setDoc(doc(db, 'memberships', 'adminA_tenantA'), { tenantId: 'tenantA', userId: 'adminA', status: 'active', role: 'Admin', name: 'Admin A' });
      await setDoc(doc(db, 'memberships', 'vendorA_tenantA'), { tenantId: 'tenantA', userId: 'vendorA', status: 'active', role: 'Asesor Comercial', name: 'Vendedor A' });
      await setDoc(doc(db, 'memberships', 'prepared1'), { tenantId: 'tenantA', userId: null, status: 'prepared', role: 'Asesor Comercial', name: 'Preparado 1' });
      await setDoc(doc(db, 'memberships', 'prepared2'), { tenantId: 'tenantA', userId: null, status: 'prepared', role: 'Asesor Comercial', name: 'Preparado 2' });
      await setDoc(doc(db, 'memberships', 'pending1'), { tenantId: 'tenantA', userId: null, status: 'pending', role: 'Owner', email: 'pendiente@x.com' });
      await setDoc(doc(db, 'memberships', 'suspendedA_tenantA'), { tenantId: 'tenantA', userId: 'suspendedA', status: 'suspended', role: 'Asesor Comercial', name: 'Suspendido A' });
      // Tenant B — para el caso de aislamiento cruzado.
      await setDoc(doc(db, 'memberships', 'ownerB_tenantB'), { tenantId: 'tenantB', userId: 'ownerB', status: 'active', role: 'Owner', name: 'Owner B' });
      await setDoc(doc(db, 'memberships', 'vendorB_tenantB'), { tenantId: 'tenantB', userId: 'vendorB', status: 'active', role: 'Asesor Comercial', name: 'Vendor B' });
      await setDoc(doc(db, 'users', 'superadmin1'), { isSuperAdmin: true });
    });
  });

  const listTenantMemberships = (db: ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore'] extends () => infer R ? R : never, tenantId: string) =>
    getDocs(query(collection(db, 'memberships'), where('tenantId', '==', tenantId)));

  it('1. Owner activo ve TODOS los usuarios de su tenant (7 de tenantA, incluidos prepared/pending/suspended)', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    const snap = await assertSucceeds(listTenantMemberships(ownerA, 'tenantA'));
    expect(snap.size).toBe(7);
  });

  it('2. Owner de tenantA NO ve usuarios de tenantB', async () => {
    // No hay membership ownerA_tenantB, así que isTenantAdmin('tenantB') ni
    // siquiera llega a evaluar false: falla al leer .data de un doc
    // inexistente, y como ninguna condición previa del OR fue true, la regla
    // deniega toda la query (no "éxito con 0 resultados" — denegación total,
    // que es un aislamiento cruzado más fuerte, no más débil).
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    await assertFails(listTenantMemberships(ownerA, 'tenantB'));
  });

  it('3. Admin activo ve el equipo completo del tenant (mismo alcance que Owner)', async () => {
    const adminA = testEnv.authenticatedContext('adminA').firestore();
    const snap = await assertSucceeds(listTenantMemberships(adminA, 'tenantA'));
    expect(snap.size).toBe(7);
  });

  it('4. Asesor Comercial NO obtiene privilegios de administración — la query de lista completa le falla', async () => {
    const vendorA = testEnv.authenticatedContext('vendorA').firestore();
    await assertFails(listTenantMemberships(vendorA, 'tenantA'));
  });

  it('5. prepared/pending con userId:null siguen apareciendo para el Owner', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    const snap = await assertSucceeds(listTenantMemberships(ownerA, 'tenantA'));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain('prepared1');
    expect(ids).toContain('prepared2');
    expect(ids).toContain('pending1');
  });

  it('6. suspended/inactive sigue visible para gestión (no desaparece de la lista)', async () => {
    const ownerA = testEnv.authenticatedContext('ownerA').firestore();
    const snap = await assertSucceeds(listTenantMemberships(ownerA, 'tenantA'));
    const suspended = snap.docs.find((d) => d.id === 'suspendedA_tenantA');
    expect(suspended).toBeDefined();
    expect(suspended?.data().status).toBe('suspended');
  });

  it('7. SuperAdmin sigue viendo el equipo completo de cualquier tenant', async () => {
    const sa = testEnv.authenticatedContext('superadmin1').firestore();
    const snapA = await assertSucceeds(listTenantMemberships(sa, 'tenantA'));
    const snapB = await assertSucceeds(listTenantMemberships(sa, 'tenantB'));
    expect(snapA.size).toBe(7);
    expect(snapB.size).toBe(2);
  });
});

// AJUSTE FINAL DE PERMISOS — el catálogo es el PRODUCTO MAESTRO del negocio.
// Antes, create/update/delete pedían solo isTenantMember, así que un Asesor
// Comercial podía alterar el catálogo saltándose la UI (y ahora que el módulo
// /catalogo quedó cerrado por rol, la Rule era el único control que faltaba).
// Leer sigue abierto a cualquier miembro activo: el asesor consulta el catálogo
// DESDE la conversación para elegir un producto y mandárselo al cliente.
describe('Catálogo — leer todos, administrar solo Owner/Admin', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'memberships', 'ownerCat_tCat'), { tenantId: 'tCat', userId: 'ownerCat', status: 'active', role: 'Owner' });
      await setDoc(doc(db, 'memberships', 'adminCat_tCat'), { tenantId: 'tCat', userId: 'adminCat', status: 'active', role: 'Admin' });
      await setDoc(doc(db, 'memberships', 'asesorCat_tCat'), { tenantId: 'tCat', userId: 'asesorCat', status: 'active', role: 'Asesor Comercial' });
      await setDoc(doc(db, 'catalog', 'itemCat'), { tenantId: 'tCat', name: 'Cuna de madera', rate: 45000 });
    });
  });

  it('el Asesor SÍ puede leer el catálogo (lo necesita desde la conversación)', async () => {
    const db = testEnv.authenticatedContext('asesorCat').firestore();
    await assertSucceeds(getDoc(doc(db, 'catalog', 'itemCat')));
  });

  it('el Asesor NO puede crear un producto maestro', async () => {
    const db = testEnv.authenticatedContext('asesorCat').firestore();
    await assertFails(setDoc(doc(db, 'catalog', 'itemNuevo'), { tenantId: 'tCat', name: 'Inventado', rate: 1 }));
  });

  it('el Asesor NO puede editar un producto maestro', async () => {
    const db = testEnv.authenticatedContext('asesorCat').firestore();
    await assertFails(setDoc(doc(db, 'catalog', 'itemCat'), { tenantId: 'tCat', name: 'Precio cambiado', rate: 1 }));
  });

  it('el Asesor NO puede borrar un producto maestro', async () => {
    const db = testEnv.authenticatedContext('asesorCat').firestore();
    await assertFails(deleteDoc(doc(db, 'catalog', 'itemCat')));
  });

  it('el Owner administra el catálogo con normalidad', async () => {
    const db = testEnv.authenticatedContext('ownerCat').firestore();
    await assertSucceeds(setDoc(doc(db, 'catalog', 'itemOwner'), { tenantId: 'tCat', name: 'Coche', rate: 60000 }));
    await assertSucceeds(setDoc(doc(db, 'catalog', 'itemCat'), { tenantId: 'tCat', name: 'Cuna', rate: 50000 }));
    await assertSucceeds(deleteDoc(doc(db, 'catalog', 'itemCat')));
  });

  it('el Admin también', async () => {
    const db = testEnv.authenticatedContext('adminCat').firestore();
    await assertSucceeds(setDoc(doc(db, 'catalog', 'itemAdmin'), { tenantId: 'tCat', name: 'Andadera', rate: 20000 }));
  });

  it('un Owner de OTRO negocio no toca este catálogo', async () => {
    const db = testEnv.authenticatedContext('ownerAjeno').firestore();
    await assertFails(setDoc(doc(db, 'catalog', 'itemAjeno'), { tenantId: 'tCat', name: 'Intruso', rate: 1 }));
  });
});

// ==============================================================================
// CORRECCIÓN 01 — AISLAMIENTO SERVER-SIDE POR ASESOR (CASOS A HASTA O)
// ==============================================================================
describe('CORRECCIÓN 01 — Aislamiento Server-Side por Asesor', () => {
  const T_SEC = 'tSec';
  const T_OTHER = 'tOther';

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();

      // Memberships tenant T_SEC
      await setDoc(doc(db, 'memberships', 'ownerSec_tSec'), {
        tenantId: T_SEC, userId: 'ownerSec', status: 'active', role: 'Owner',
      });
      await setDoc(doc(db, 'memberships', 'adminSec_tSec'), {
        tenantId: T_SEC, userId: 'adminSec', status: 'active', role: 'Admin',
      });
      await setDoc(doc(db, 'memberships', 'advisorA_tSec'), {
        tenantId: T_SEC, userId: 'advisorA', status: 'active', role: 'Asesor Comercial',
      });
      await setDoc(doc(db, 'memberships', 'advisorB_tSec'), {
        tenantId: T_SEC, userId: 'advisorB', status: 'active', role: 'Asesor Comercial',
      });
      await setDoc(doc(db, 'memberships', 'suspendedAdv_tSec'), {
        tenantId: T_SEC, userId: 'suspendedAdv', status: 'suspended', role: 'Asesor Comercial',
      });

      // Memberships tenant T_OTHER
      await setDoc(doc(db, 'memberships', 'ownerOther_tOther'), {
        tenantId: T_OTHER, userId: 'ownerOther', status: 'active', role: 'Owner',
      });
      await setDoc(doc(db, 'memberships', 'advisorOther_tOther'), {
        tenantId: T_OTHER, userId: 'advisorOther', status: 'active', role: 'Asesor Comercial',
      });

      // Settings Modo Libre por defecto para T_SEC
      await setDoc(doc(db, 'settings', T_SEC), {
        multiAgentConfig: { isAutoDistributionEnabled: false },
      });

      // Leads en T_SEC
      await setDoc(doc(db, 'leads', 'leadA'), {
        tenantId: T_SEC, advisorId: 'advisorA', name: 'Lead de A', stage: 'Nuevo',
      });
      await setDoc(doc(db, 'leads', 'leadB'), {
        tenantId: T_SEC, advisorId: 'advisorB', name: 'Lead de B', stage: 'Nuevo',
      });

      // Leads en T_OTHER
      await setDoc(doc(db, 'leads', 'leadOther'), {
        tenantId: T_OTHER, advisorId: 'advisorOther', name: 'Lead Other', stage: 'Nuevo',
      });

      // Conversaciones en T_SEC
      await setDoc(doc(db, 'conversations', 'convA'), {
        tenantId: T_SEC, advisorId: 'advisorA', status: 'open', lastMessage: 'hola A',
      });
      await setDoc(doc(db, 'conversations', 'convB'), {
        tenantId: T_SEC, advisorId: 'advisorB', status: 'open', lastMessage: 'hola B',
      });
      await setDoc(doc(db, 'conversations', 'convUnassigned'), {
        tenantId: T_SEC, advisorId: null, status: 'open', lastMessage: 'alguien?',
      });

      // Mensajes en convA y convB
      await setDoc(doc(db, 'conversations', 'convA', 'messages', 'msgA1'), {
        text: 'Mensaje A', sender: 'advisor',
      });
      await setDoc(doc(db, 'conversations', 'convB', 'messages', 'msgB1'), {
        text: 'Mensaje B', sender: 'advisor',
      });

      // Conversaciones en T_OTHER
      await setDoc(doc(db, 'conversations', 'convOther'), {
        tenantId: T_OTHER, advisorId: 'advisorOther', status: 'open',
      });
    });
  });

  // A. Advisor A lee su propio lead: ALLOW
  it('A. Advisor A lee su propio lead: ALLOW', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertSucceeds(getDoc(doc(db, 'leads', 'leadA')));
  });

  // B. Advisor A lee lead de Advisor B: DENY (direct get)
  it('B. Advisor A lee lead de Advisor B: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(getDoc(doc(db, 'leads', 'leadB')));
  });

  // C. Advisor A actualiza lead de Advisor B: DENY
  it('C. Advisor A actualiza lead de Advisor B: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(setDoc(doc(db, 'leads', 'leadB'), {
      tenantId: T_SEC, advisorId: 'advisorB', name: 'Hackeado', stage: 'Ganado',
    }, { merge: true }));
  });

  // D. Advisor A lee su conversación: ALLOW
  it('D. Advisor A lee su conversación: ALLOW', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertSucceeds(getDoc(doc(db, 'conversations', 'convA')));
  });

  // E. Advisor A lee conversación de Advisor B: DENY
  it('E. Advisor A lee conversación de Advisor B: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(getDoc(doc(db, 'conversations', 'convB')));
  });

  // F. Advisor A cambia advisorId de su registro hacia otro usuario: DENY
  it('F. Advisor A cambia advisorId de su lead o conversación: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    // Intenta transferir su lead a advisorB
    await assertFails(setDoc(doc(db, 'leads', 'leadA'), {
      tenantId: T_SEC, advisorId: 'advisorB', name: 'Transferido',
    }, { merge: true }));

    // Intenta transferir su conversación a advisorB
    await assertFails(setDoc(doc(db, 'conversations', 'convA'), {
      tenantId: T_SEC, advisorId: 'advisorB',
    }, { merge: true }));
  });

  // G. Advisor A cambia tenantId: DENY
  it('G. Advisor A cambia tenantId: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(setDoc(doc(db, 'leads', 'leadA'), {
      tenantId: T_OTHER, advisorId: 'advisorA',
    }, { merge: true }));
  });

  // H. Owner/Admin lee registros de cualquier asesor dentro de su tenant: ALLOW
  it('H. Owner/Admin lee registros de cualquier asesor dentro de su tenant: ALLOW', async () => {
    const dbOwner = testEnv.authenticatedContext('ownerSec').firestore();
    const dbAdmin = testEnv.authenticatedContext('adminSec').firestore();

    await assertSucceeds(getDoc(doc(dbOwner, 'leads', 'leadA')));
    await assertSucceeds(getDoc(doc(dbOwner, 'leads', 'leadB')));
    await assertSucceeds(getDoc(doc(dbOwner, 'conversations', 'convA')));
    await assertSucceeds(getDoc(doc(dbOwner, 'conversations', 'convB')));

    await assertSucceeds(getDoc(doc(dbAdmin, 'leads', 'leadA')));
    await assertSucceeds(getDoc(doc(dbAdmin, 'leads', 'leadB')));
    await assertSucceeds(getDoc(doc(dbAdmin, 'conversations', 'convA')));
    await assertSucceeds(getDoc(doc(dbAdmin, 'conversations', 'convB')));
  });

  // I. Owner/Admin cruza a otro tenant: DENY
  it('I. Owner/Admin cruza a otro tenant: DENY', async () => {
    const dbOwner = testEnv.authenticatedContext('ownerSec').firestore();
    await assertFails(getDoc(doc(dbOwner, 'leads', 'leadOther')));
    await assertFails(getDoc(doc(dbOwner, 'conversations', 'convOther')));
  });

  // J. Advisor cruza a otro tenant: DENY
  it('J. Advisor cruza a otro tenant: DENY', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(getDoc(doc(db, 'leads', 'leadOther')));
    await assertFails(getDoc(doc(db, 'conversations', 'convOther')));
  });

  // K. Modo Libre: conversación unassigned elegible puede ser leída: ALLOW
  it('K. Modo Libre: conversación unassigned elegible puede ser leída: ALLOW', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertSucceeds(getDoc(doc(db, 'conversations', 'convUnassigned')));
  });

  // L. Modo Auto: conversación unassigned NO es visible para advisor: DENY
  it('L. Modo Auto: conversación unassigned NO es visible para advisor: DENY', async () => {
    // Activamos auto-distribution en settings de T_SEC
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings', T_SEC), {
        multiAgentConfig: { isAutoDistributionEnabled: true },
      });
    });

    const db = testEnv.authenticatedContext('advisorA').firestore();
    await assertFails(getDoc(doc(db, 'conversations', 'convUnassigned')));

    // Pero Owner/Admin todavía pueden verla
    const dbOwner = testEnv.authenticatedContext('ownerSec').firestore();
    await assertSucceeds(getDoc(doc(dbOwner, 'conversations', 'convUnassigned')));
  });

  // M. Mensajes de conversación: aislamiento estricto
  it('M. Mensajes: Advisor A no puede leer ni escribir en mensajes de convB', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    // Leer propio mensaje: ALLOW
    await assertSucceeds(getDoc(doc(db, 'conversations', 'convA', 'messages', 'msgA1')));
    // Escribir en propia conversación: ALLOW
    await assertSucceeds(setDoc(doc(db, 'conversations', 'convA', 'messages', 'msgA2'), {
      text: 'Nuevo mensaje', sender: 'advisor',
    }));
    // Leer mensaje de convB: DENY
    await assertFails(getDoc(doc(db, 'conversations', 'convB', 'messages', 'msgB1')));
    // Escribir mensaje en convB: DENY
    await assertFails(setDoc(doc(db, 'conversations', 'convB', 'messages', 'msgB2'), {
      text: 'Inyección', sender: 'advisor',
    }));
  });

  // N. Suspended membership: DENY
  it('N. Suspended membership: DENY según reglas actuales', async () => {
    const db = testEnv.authenticatedContext('suspendedAdv').firestore();
    await assertFails(getDoc(doc(db, 'leads', 'leadA')));
    await assertFails(getDoc(doc(db, 'conversations', 'convA')));
  });

  // O. Direct creation: Advisor no puede crear lead con advisorId de otro usuario
  it('O. Create: Advisor no puede crear lead atribuyéndolo a otro asesor', async () => {
    const db = testEnv.authenticatedContext('advisorA').firestore();
    // Crearse a sí mismo: ALLOW
    await assertSucceeds(setDoc(doc(db, 'leads', 'leadNuevoA'), {
      tenantId: T_SEC, advisorId: 'advisorA', name: 'Propio',
    }));
    // Crear para advisorB: DENY
    await assertFails(setDoc(doc(db, 'leads', 'leadNuevoB'), {
      tenantId: T_SEC, advisorId: 'advisorB', name: 'Ajeno',
    }));
  });
});

