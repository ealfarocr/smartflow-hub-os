import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// GUARDA ESTRUCTURAL (no necesita emulador). Cloud Storage Security Rules permite como
// MÁXIMO 2 documentos Firestore DISTINTOS por evaluación; con más, la regla deniega
// (storage/unauthorized). El emulador NO aplica ese límite, así que sin esta guarda
// un tercer firestore.get/exists (o un helper que lo haga) volvería a romper el
// Live Video en producción sin que ningún test lo note.
const FIRESTORE_DOC_LIMIT = 2;

/** Documentos Firestore distintos que toca una condición, incluyendo los helpers que leen Firestore. */
export function distinctFirestoreDocs(condition: string): string[] {
  const docs = new Set<string>();
  const direct = /firestore\.(?:get|exists)\(\s*\/databases\/\(default\)\/documents\/([A-Za-z_]+)\/(\$\([^)]*\))/g;
  for (const m of condition.matchAll(direct)) docs.add(`${m[1]}/${m[2].replace(/\s+/g, ' ')}`);
  // Helpers de storage.rules que internamente consultan Firestore.
  if (/\bisSuperAdmin\s*\(/.test(condition)) docs.add('users/request.auth.uid');
  if (/\bisTenantMember\s*\(/.test(condition)) docs.add("memberships/$(request.auth.uid + '_' + tenantId)");
  return [...docs];
}

/** Condición del `allow write` del match indicado. */
export function writeConditionOf(rules: string, matchPrefix: string): string {
  const src = rules.replace(/\r\n/g, '\n');
  const start = src.indexOf(`match /${matchPrefix}`);
  if (start < 0) throw new Error(`No existe match /${matchPrefix}`);
  const open = src.indexOf('{', src.indexOf('{fileName}', start));
  const end = src.indexOf('\n    }', open); // cierre del match (4 espacios)
  const block = src.slice(open, end);
  const w = block.match(/allow write:\s*if([\s\S]*?);/);
  if (!w) throw new Error('allow write no encontrado');
  return w[1];
}

describe('chat-live-video: límite de 2 documentos Firestore en el WRITE', () => {
  const rules = readFileSync('storage.rules', 'utf8');
  const condition = writeConditionOf(rules, 'chat-live-video/');

  it('el WRITE accede a EXACTAMENTE membership + conversation (2 documentos)', () => {
    const docs = distinctFirestoreDocs(condition);
    expect(docs.length).toBeLessThanOrEqual(FIRESTORE_DOC_LIMIT);
    expect(docs.map(d => d.split('/')[0]).sort()).toEqual(['conversations', 'memberships']);
  });

  it('no depende de isSuperAdmin() (users/{uid} sería el 3er documento) ni de isTenantMember()', () => {
    expect(condition).not.toMatch(/isSuperAdmin\s*\(/);
    expect(condition).not.toMatch(/\bfirestore\.(?:get|exists)\([^)]*\/users\//);
  });

  it('conserva todas las exigencias de aislamiento', () => {
    expect(condition).toMatch(/request\.auth != null/);
    expect(condition).toMatch(/request\.auth\.uid == uid/);
    expect(condition).toMatch(/\.data\.status == 'active'/);
    expect(condition).toMatch(/\.data\.role != 'Solo lectura'/);
    expect(condition).toMatch(/conversations\/\$\(conversationId\)\)\.data\.tenantId == tenantId/);
    expect(condition).toMatch(/request\.resource\.size < 5 \* 1024 \* 1024/);
    expect(condition).toMatch(/request\.resource\.contentType\.matches\('video\/\.\*'\)/);
  });

  it('el contador detecta la regla anterior (3 documentos) — la guarda no es decorativa', () => {
    const old = `request.auth != null && request.auth.uid == uid
      && ( isSuperAdmin()
        || (firestore.exists(/databases/(default)/documents/memberships/$(request.auth.uid + '_' + tenantId))
            && firestore.get(/databases/(default)/documents/memberships/$(request.auth.uid + '_' + tenantId)).data.status == 'active'))
      && firestore.exists(/databases/(default)/documents/conversations/$(conversationId))`;
    expect(distinctFirestoreDocs(old).length).toBe(3);
  });

  it('las 3 lecturas de la misma membership cuentan como un solo documento', () => {
    const memberships = distinctFirestoreDocs(condition).filter(d => d.startsWith('memberships/'));
    expect(memberships.length).toBe(1);
  });
});
