import admin from 'firebase-admin';
import axios from 'axios';

// Connect to production Firestore
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "paneles-solares-bcs-mx"
  });
}

const db = admin.firestore();

// Exact function body of chatWithAgent but with a mocked request
async function testChatWithAgent(request) {
  try {
    if (!request.auth) throw new Error('Usuario no autenticado');

    const { messages, tenantId } = request.data;

    console.log('[chatWithAgent] tenantId:', tenantId, '| messages:', messages?.length);

    if (!tenantId) throw new Error('tenantId requerido');
    if (!messages?.length) throw new Error('messages requerido');

    // Use a placeholder or read the key from settings if present
    // Let's get settings first
    const settingsDoc = await db.collection('settings').doc(tenantId).get();
    const raw = settingsDoc.data() || {};
    const agentConfig = raw.aiAgentConfig || { knowledgeFiles: [], productFiles: [] };
    const features = raw.features || {};
    const businessName = raw.tradeName || raw.companyName || 'el negocio';

    console.log('[chatWithAgent] Loaded settings. businessName:', businessName);

    // Límite mensual de consultas según plan
    const LIMIT_FREE = 20;      // trial sin módulo IA activo
    const LIMIT_PAID = 300;     // hasAiAgent activo
    const queryLimit = features.hasAiAgent ? LIMIT_PAID : LIMIT_FREE;

    console.log('[chatWithAgent] queryLimit:', queryLimit);

    // Verificar y actualizar contador mensual de uso
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const usageRef = db.collection('usage').doc(tenantId);
    const usageSnap = await usageRef.get();
    const usageData = usageSnap.data() || {};
    const chatUsage = usageData.chatAgent || { count: 0, month: currentMonth };

    console.log('[chatWithAgent] chatUsage:', chatUsage);

    // Resetear contador si cambió el mes
    if (chatUsage.month !== currentMonth) {
      chatUsage.count = 0;
      chatUsage.month = currentMonth;
    }

    if (chatUsage.count >= queryLimit) {
      throw new Error(`Limit reached: ${queryLimit}`);
    }

    // Construir contexto desde archivos con content extraído
    const allFiles = [
      ...(agentConfig.knowledgeFiles || []),
      ...(agentConfig.productFiles || []),
    ];

    console.log('[chatWithAgent] allFiles:', allFiles.length);

    const knowledgeContext = allFiles
      .filter((f) => f.content)
      .map((f) => `=== ${f.name} ===\n${f.content}`)
      .join('\n\n');

    console.log('[chatWithAgent] knowledgeContext length:', knowledgeContext.length);

    const platformKnowledgeCRM = `SMARTFLOW HUB OS — CRM multicanal con IA para negocios que venden por WhatsApp.
MÓDULOS:
- CRM Base: GRATIS
- WhatsApp Coexistente: $69/mes
- Agente IA 24/7: $49/mes
- Auditor IA: $25/mes
- Links de Pago: $12/mes
- Cotizaciones PDF: $15/mes
- Catálogo Digital: $27/mes
- Agenda Inteligente: $20/mes
- Pack completo: máximo $197/mes`;

    const systemPrompt = knowledgeContext
      ? `Eres el asistente virtual oficial de ${businessName}.
DOCUMENTOS DE ENTRENAMIENTO (máxima prioridad — definen tu identidad y conocimiento):
${knowledgeContext}`
      : `Eres Sofía, asesora de SmartFlow Hub OS. Eres consultora, no vendedora.
${platformKnowledgeCRM}`;

    console.log('[chatWithAgent] Calling OpenAI API...');
    
    // Note: since we don't have the OpenAI Key in this local environment, we can check if we get an API key error
    // or if the function fails *before* calling OpenAI (e.g. database logic).
    // Let's print the apiKey presence
    const apiKey = process.env.OPENAI_API_KEY || 'SK_MOCK_KEY_FOR_TEST';
    console.log('[chatWithAgent] apiKey length:', apiKey.length);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        max_tokens: 500,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('[chatWithAgent] OpenAI call succeeded!');
    return response.data;
  } catch (err) {
    console.error('[chatWithAgent] EXCEPTION THROWN:');
    console.error(err);
  }
}

// Run test
testChatWithAgent({
  auth: { uid: 'test_uid' },
  data: {
    tenantId: 't-1779680745567',
    messages: [
      { role: 'user', content: 'precios de los lotes y quintas' }
    ]
  }
});
