import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { setDoc, doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';

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
