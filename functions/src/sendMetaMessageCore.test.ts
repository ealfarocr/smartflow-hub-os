import { describe, it, expect, vi } from 'vitest';
import { checkConversationSendAccess } from './sendMessageAuth';
import { runSendMetaMessage, GRAPH_MESSAGES_URL, type SendMetaMessageDeps } from './sendMetaMessageCore';

const TOKEN = 'EAAB-secret-token-123';

interface Scenario {
  superAdmin?: boolean;
  membership?: { status: string; role: string } | null;
  conv?: Record<string, any> | null;
  integration?: Record<string, any> | null;
  graph?: { ok: boolean; status: number; body: any } | 'throw';
}

function setup(s: Scenario = {}) {
  const fetchFn = vi.fn(async (_url: string, _init: any) => {
    const g = s.graph ?? { ok: true, status: 200, body: { message_id: 'm.graph1' } };
    if (g === 'throw') throw new Error(`network down at ${TOKEN}`);
    return { ok: g.ok, status: g.status, json: async () => g.body };
  });
  const persistMessage = vi.fn(async (_c: string, _m: any) => 'msg-1');
  const findActiveIntegration = vi.fn(async (_t: string, _p: any) =>
    s.integration === undefined
      ? { tenantId: 'tA', provider: 'instagram', accessToken: TOKEN, isActive: true }
      : s.integration
  );
  const deps: SendMetaMessageDeps = {
    isSuperAdmin: async () => s.superAdmin ?? false,
    getMembership: async () =>
      s.membership === undefined ? { status: 'active', role: 'Asesor Comercial' } : s.membership,
    getConversation: async () =>
      s.conv === undefined
        ? { tenantId: 'tA', source: 'instagram', platformId: 'PSID1', advisorId: 'u1' }
        : s.conv,
    findActiveIntegration,
    fetchFn,
    persistMessage,
    randomId: () => 'rnd',
  };
  return { deps, fetchFn, persistMessage, findActiveIntegration };
}

const data = { conversationId: 'c1', text: 'hola', tenantId: 'tA' };
const run = (deps: SendMetaMessageDeps, d: any = data, ...rest: [uid?: string | undefined]) =>
  runSendMetaMessage(deps, { uid: rest.length ? rest[0] : 'u1', data: d });
const code = async (p: Promise<any>) => p.then(() => 'OK', (e) => e.code as string);

describe('sendMetaMessage — acceso', () => {
  it('A. sin autenticar -> denied', async () => {
    const { deps } = setup();
    expect(await code(run(deps, data, undefined))).toBe('unauthenticated');
  });
  it('B. membresía inactiva -> denied', async () => {
    const { deps, fetchFn } = setup({ membership: { status: 'suspended', role: 'Admin' } });
    expect(await code(run(deps))).toBe('permission-denied');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('B2. sin membresía -> denied', async () => {
    const { deps } = setup({ membership: null });
    expect(await code(run(deps))).toBe('permission-denied');
  });
  it('C. Solo lectura -> denied', async () => {
    const { deps } = setup({ membership: { status: 'active', role: 'Solo lectura' } });
    expect(await code(run(deps))).toBe('permission-denied');
  });
  it('D. usuario Tenant A + conversación de Tenant B -> denied, sin escritura ni Graph', async () => {
    const { deps, fetchFn, persistMessage } = setup({
      membership: { status: 'active', role: 'Admin' },
      conv: { tenantId: 'tB', source: 'instagram', platformId: 'PSIDB', advisorId: 'x' },
    });
    expect(await code(run(deps))).toBe('permission-denied');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(persistMessage).not.toHaveBeenCalled();
  });
  it('E. Asesor A + conversación del asesor B -> denied', async () => {
    const { deps, persistMessage } = setup({ conv: { tenantId: 'tA', source: 'instagram', platformId: 'P', advisorId: 'u2' } });
    expect(await code(run(deps))).toBe('permission-denied');
    expect(persistMessage).not.toHaveBeenCalled();
  });
  it('F. Admin mismo tenant (conversación de otro asesor) -> allowed', async () => {
    const { deps } = setup({
      membership: { status: 'active', role: 'Admin' },
      conv: { tenantId: 'tA', source: 'instagram', platformId: 'P', advisorId: 'u2' },
    });
    expect(await code(run(deps))).toBe('OK');
  });
  it('G. Owner mismo tenant, conversación sin asesor -> allowed', async () => {
    const { deps } = setup({
      membership: { status: 'active', role: 'Owner' },
      conv: { tenantId: 'tA', source: 'instagram', platformId: 'P' },
    });
    expect(await code(run(deps))).toBe('OK');
  });
  it('H. Asesor asignado -> allowed', async () => {
    const { deps } = setup();
    expect(await code(run(deps))).toBe('OK');
  });
  it('I. Técnico asignado -> allowed', async () => {
    const { deps } = setup({ membership: { status: 'active', role: 'Técnico' } });
    expect(await code(run(deps))).toBe('OK');
  });
  it('J. Técnico en conversación de otro asesor -> denied', async () => {
    const { deps } = setup({
      membership: { status: 'active', role: 'Técnico' },
      conv: { tenantId: 'tA', source: 'instagram', platformId: 'P', advisorId: 'u2' },
    });
    expect(await code(run(deps))).toBe('permission-denied');
  });
  it('K. conversación sin asesor + Asesor normal -> denied', async () => {
    const { deps } = setup({ conv: { tenantId: 'tA', source: 'instagram', platformId: 'P', advisorId: null } });
    expect(await code(run(deps))).toBe('permission-denied');
  });
  it('SuperAdmin sin membresía sobre su tenant -> allowed; sobre otro tenant -> denied', async () => {
    const ok = setup({ superAdmin: true, membership: null, conv: { tenantId: 'tA', source: 'instagram', platformId: 'P' } });
    expect(await code(run(ok.deps))).toBe('OK');
    const bad = setup({ superAdmin: true, membership: null, conv: { tenantId: 'tB', source: 'instagram', platformId: 'P' } });
    expect(await code(run(bad.deps))).toBe('permission-denied');
  });
});

describe('sendMetaMessage — source e integración', () => {
  it('L. source del request != source de la conversación -> failed-precondition', async () => {
    const { deps, fetchFn } = setup();
    expect(await code(run(deps, { ...data, source: 'facebook' }))).toBe('failed-precondition');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('L2. sin source en el request -> se deriva de la conversación', async () => {
    const { deps, findActiveIntegration } = setup();
    expect(await code(run(deps))).toBe('OK');
    expect(findActiveIntegration).toHaveBeenCalledWith('tA', 'instagram');
  });
  it('M. conversación WhatsApp -> denied', async () => {
    const { deps, fetchFn } = setup({ conv: { tenantId: 'tA', source: 'whatsapp', platformId: 'P', advisorId: 'u1' } });
    expect(await code(run(deps))).toBe('permission-denied');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('M2. conversación sin source (legacy WhatsApp) -> denied', async () => {
    const { deps } = setup({ conv: { tenantId: 'tA', platformId: 'P', advisorId: 'u1' } });
    expect(await code(run(deps))).toBe('permission-denied');
  });
  it('N. provider de la integración != source -> denied', async () => {
    const { deps, fetchFn } = setup({ integration: { tenantId: 'tA', provider: 'facebook', accessToken: TOKEN } });
    expect(await code(run(deps))).toBe('failed-precondition');
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('N2. integración de otro tenant -> denied', async () => {
    const { deps } = setup({ integration: { tenantId: 'tB', provider: 'instagram', accessToken: TOKEN } });
    expect(await code(run(deps))).toBe('failed-precondition');
  });
  it('N3. sin integración activa -> failed-precondition', async () => {
    const { deps } = setup({ integration: null });
    expect(await code(run(deps))).toBe('failed-precondition');
  });
  it('O. accessToken ausente -> failed-precondition', async () => {
    const { deps, fetchFn } = setup({ integration: { tenantId: 'tA', provider: 'instagram' } });
    expect(await code(run(deps))).toBe('failed-precondition');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('sendMetaMessage — envío y persistencia', () => {
  it('P. Instagram válida -> success; token solo en cabecera Authorization', async () => {
    const { deps, fetchFn, persistMessage } = setup();
    const r = await run(deps);
    expect(r).toMatchObject({ success: true, status: 'sent', messageId: 'msg-1', externalId: 'm.graph1', errorMessage: null });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(GRAPH_MESSAGES_URL);
    expect(url).not.toContain('access_token');
    expect(url).not.toContain(TOKEN);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({ recipient: { id: 'PSID1' }, message: { text: 'hola' } });
    expect(persistMessage).toHaveBeenCalledWith('c1', expect.objectContaining({ status: 'sent', metaErrorDetail: null }));
  });
  it('Q. Facebook/Messenger válida -> success', async () => {
    const { deps, findActiveIntegration } = setup({
      conv: { tenantId: 'tA', source: 'facebook', platformId: 'PSID2', advisorId: 'u1' },
      integration: { tenantId: 'tA', provider: 'facebook', accessToken: TOKEN },
    });
    const r = await run(deps);
    expect(r.success).toBe(true);
    expect(findActiveIntegration).toHaveBeenCalledWith('tA', 'facebook');
  });
  it('R. fallo de Graph -> failed persistido, detalle seguro, sin token', async () => {
    const { deps, persistMessage } = setup({
      graph: { ok: false, status: 400, body: { error: { message: `Invalid token ${TOKEN}`, type: 'OAuthException', code: 190, fbtrace_id: 'AbC' } } },
    });
    const r = await run(deps);
    expect(r).toMatchObject({ success: false, status: 'failed' });
    const saved = persistMessage.mock.calls[0][1];
    expect(saved.status).toBe('failed');
    expect(saved.metaErrorDetail).toEqual({ httpStatus: 400, type: 'OAuthException', code: 190, subcode: null, fbtraceId: 'AbC' });
    expect(JSON.stringify([r, saved])).not.toContain(TOKEN);
  });
  it('R2. excepción de red -> failed persistido, sin token', async () => {
    const { deps, persistMessage } = setup({ graph: 'throw' });
    const r = await run(deps);
    expect(r.status).toBe('failed');
    expect(persistMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([r, persistMessage.mock.calls[0][1]])).not.toContain(TOKEN);
  });
});

describe('checkConversationSendAccess', () => {
  it('políticas puras', () => {
    expect(checkConversationSendAccess({ isSuperAdmin: false, role: 'Owner', conversationAdvisorId: null, uid: 'u' }).allowed).toBe(true);
    expect(checkConversationSendAccess({ isSuperAdmin: false, role: 'Asesor Comercial', conversationAdvisorId: '', uid: 'u' })).toEqual({ allowed: false, reason: 'unassigned-conversation' });
    expect(checkConversationSendAccess({ isSuperAdmin: false, role: 'Técnico', conversationAdvisorId: 'x', uid: 'u' })).toEqual({ allowed: false, reason: 'not-assigned-advisor' });
  });
});
