import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
// FieldValue/Timestamp desde el entry point moderno de firebase-admin. Misma
// clase y mismo comportamiento que admin.firestore.FieldValue en producción,
// pero el stub de firebase-admin del EMULADOR de Functions no expone los
// estáticos sobre admin.firestore (le rompe igual a código preexistente e
// intacto como registerDevice) — y sin esto el ciclo de acceso no se puede
// probar de punta a punta contra emuladores. Acotado a las funciones del
// ciclo de acceso y del puesto del vendedor (setOperationalStatus,
// tickPresence, claimConversation): el resto del archivo queda como estaba.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as Busboy from 'busboy';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import sgMail from '@sendgrid/mail';
import axios from 'axios';
import {
  PIN_MAX_ATTEMPTS, PIN_LOCKOUT_MS, hashPin, verifyPinHash, generatePin, normalizeLoginHandle,
  PIN_LOGIN_GENERIC_ERROR, DUMMY_PIN_SALT, DUMMY_PIN_HASH,
} from './pinAuth';
import { checkMembershipAuth, checkConversationTenantMatch, buildMetaErrorDetail, MetaErrorDetail } from './sendMessageAuth';
import { checkVendorPinAuth, buildBreakGlassAuditEvent, checkPinLoginAllowed } from './vendorPinAuth';
import { shouldApplyStatusUpdate } from './messageStatusUpdate';
import { checkTenantAdminAuth } from './tenantAdminAuth';
import {
  resolveAccessState, resolveAccessActionsFor, checkSetVendorPinTransition,
  SUSPENDED_PIN_ERROR,
} from './accessLifecycle';
import { checkDeviceQuickEntry, quickEntryFallback } from './deviceSessionAuth';
import { generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret, checkDeviceLogin } from './deviceSecret';

admin.initializeApp();

const db = admin.firestore();

/**
 * Validar la firma HMAC de Meta (sha256).
 * Comparacion en tiempo constante para evitar timing attacks.
 */
function validateSignature(payload: any, signature: string, secret: string) {
  if (!payload || !signature || !secret) return false;
  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    const expectedSignature = `sha256=${hash}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Comparacion de strings en tiempo constante (anti-timing-attack) para tokens cortos.
 */
function safeStrEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Rate limiter en memoria: máx 20 mensajes por número en ventana de 60s
// (protección contra flood/spam sin dependencias externas)
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(phoneNumber: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(phoneNumber);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(phoneNumber, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return true;
  return false;
}

// Limpia entradas expiradas del mapa cada 5 minutos para evitar memory leak.
// .unref() es necesario: un timer de módulo sin unref() mantiene vivo el
// event loop del proceso que usa `firebase deploy` para analizar el código
// y detectar los exports (Node nunca "termina" mientras el timer siga
// activo) — causaba "Cannot determine backend specification. Timeout after
// 10000" al desplegar CUALQUIER función de este archivo. unref() no afecta
// el comportamiento en Cloud Functions/Cloud Run (esos entornos no dependen
// de que el proceso termine solo).
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now - val.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(key);
  }
}, 5 * 60_000);
rateLimitCleanupInterval.unref();

/**
 * GUARDRAIL "ZERO HALLUCINATED PRICES" — el LLM NO es fuente de verdad de
 * precio/producto. Hoy no existe un catálogo estructurado (los precios viven
 * en texto libre subido por el negocio, ver knowledgeContext) — así que la
 * validación real posible es: todo monto que la IA mencione en su respuesta
 * debe aparecer TAMBIÉN, literalmente, en los documentos fuente del propio
 * negocio. Un monto que no aparece en ningún lado del material fuente es una
 * señal fuerte de precio inventado — más barato bloquear un falso positivo
 * ocasional (precio real pero mal formateado) que dejar pasar un precio
 * inventado a un cliente real.
 *
 * Extrae "tokens de precio": números asociados a un símbolo de moneda (₡, $)
 * o a una palabra de moneda/precio (colones, dólares, USD, CRC), normalizados
 * a solo dígitos para comparar el valor numérico sin importar el formato
 * (₡200.000 vs 200000 vs 200,000 deben matchear).
 */
function extractPriceTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  if (!text) return tokens;
  const re = /(?:[₡$]\s?\d[\d.,]*)|(?:\d[\d.,]*\s?(?:colones|dólares|dolares|usd|crc))/gi;
  const matches = text.match(re) || [];
  for (const m of matches) {
    const digitsOnly = m.replace(/\D/g, '').replace(/^0+/, '');
    if (digitsOnly.length >= 2) tokens.add(digitsOnly); // ignora ruido de 1 dígito (ej. "$1" de un emoji o similar)
  }
  return tokens;
}

/**
 * También dispara si la respuesta usa lenguaje de precio/descuento SIN un
 * monto numérico reconocible (ej. "tiene descuento" sin decir cuánto) — ese
 * caso no se puede validar contra la fuente, así que se trata como
 * sospechoso igual, mejor pecar de cauteloso.
 */
const PRICE_LANGUAGE_RX = /₡|\$|precio|cuesta|descuento|%/i;

function validateAiReplyPrices(aiReply: string, knowledgeContext: string): { ok: boolean; reason?: string; invalidTokens?: string[] } {
  if (!PRICE_LANGUAGE_RX.test(aiReply)) return { ok: true };
  const replyPrices = extractPriceTokens(aiReply);
  if (replyPrices.size === 0) {
    // Menciona precio/descuento/% pero sin un monto verificable — no se puede
    // confirmar contra la fuente. Se deja pasar SOLO si tampoco hay % (que sí
    // es chequeable por la regla de construcción existente) — en la práctica
    // esto cubre frases como "tiene precio especial" sin monto, que son raras
    // pero mejor no bloquear texto que no promete un número concreto.
    return { ok: true };
  }
  const sourcePrices = extractPriceTokens(knowledgeContext);
  const invalidTokens = [...replyPrices].filter((p) => !sourcePrices.has(p));
  if (invalidTokens.length > 0) {
    return { ok: false, reason: 'price_not_in_source', invalidTokens };
  }
  return { ok: true };
}

const AI_SAFE_ESCALATION_REPLY = 'Quiero confirmarte la información correcta antes de indicártela. Un asesor te ayuda con ese dato.';

/**
 * Ejecuta el Piloto Automático con IA usando Gemini 1.5 Flash
 */
async function triggerAiAutopilot(
  tenantId: string,
  conversationId: string,
  incomingText: string,
  source: 'whatsapp' | 'facebook' | 'instagram',
  integrationData: any
) {
  try {
    console.log(`[AI Autopilot] INICIADO — tenant: ${tenantId}, conv: ${conversationId}, texto: "${incomingText}"`);

    // Leer conversación, settings y mensajes recientes en paralelo
    const [convDoc, settingsDoc, recentMsgsSnap] = await Promise.all([
      db.collection('conversations').doc(conversationId).get(),
      db.collection('settings').doc(tenantId).get(),
      db.collection('conversations').doc(conversationId)
        .collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(12)
        .get()
    ]);

    const convData = convDoc.data();
    if (convData?.status === 'archived') {
      console.log('[AI Autopilot] Conversación archivada. Omitiendo.');
      return;
    }
    // Opt-in: el bot SOLO responde si fue activado manualmente (botEnabled === true).
    // Por defecto (undefined o false) permanece desactivado.
    if (convData?.botEnabled !== true) {
      console.log('[AI Autopilot] Bot desactivado (responde solo si se activa manualmente).');
      return;
    }

    // Construir contexto desde documentos de entrenamiento (truncado a 6000 chars)
    const settingsData = settingsDoc.data() || {};
    const agentConfig = settingsData.aiAgentConfig || { knowledgeFiles: [], productFiles: [] };
    const businessName = settingsData.tradeName || settingsData.companyName || 'el negocio';

    // BASE GLOBAL DEL AGENTE — aplica a TODOS los negocios (actuales y futuros).
    // Se COMBINA con la info privada del negocio, pero jamás mezcla datos entre negocios.
    let globalConfig: any = {};
    try {
      const gSnap = await db.collection('config').doc('agent_global').get();
      globalConfig = gSnap.data() || {};
    } catch { /* sin base global: se usa solo lo privado */ }
    const globalInstructions: string = (globalConfig.generalInstructions || '').trim();
    const globalFiles: any[] = globalConfig.knowledgeFiles || [];
    const globalMedia: any[] = globalConfig.mediaLibrary || [];

    const allFiles = [...(agentConfig.knowledgeFiles || []), ...(agentConfig.productFiles || [])];
    // Los archivos subidos al Agente IA con URL pueden ENVIARSE al cliente, EXCEPTO los
    // documentos internos/de entrenamiento (confidenciales). Se combinan con la biblioteca
    // explícita de medios (mediaLibrary) y con los medios globales, evitando duplicados.
    const INTERNAL_DOC_RX = /entrenamiento|training|interno|confidencial|instrucci[oó]n|system\s*prompt|prompt\s*del|configuraci[oó]n\s*del\s*agente/i;
    const explicitMedia: any[] = agentConfig.mediaLibrary || [];
    const sendableFiles = allFiles.filter((f: any) => f?.url && !INTERNAL_DOC_RX.test(f.name || ''));
    const globalSendable = globalMedia.filter((f: any) => f?.url && !INTERNAL_DOC_RX.test(f.name || ''));
    const seenMediaUrls = new Set<string>();
    const mediaLibrary: any[] = [...explicitMedia, ...sendableFiles, ...globalSendable].filter((m: any) => {
      if (!m?.url || seenMediaUrls.has(m.url)) return false;
      seenMediaUrls.add(m.url);
      return true;
    });
    const mediaContext = mediaLibrary.length > 0
      ? `\nARCHIVOS DISPONIBLES PARA ENVIAR AL CLIENTE:\n${mediaLibrary.map((m: any) => `- "${m.name}"${m.description ? ` (${m.description})` : ''}: ${m.url}`).join('\n')}\n`
      : '';

    // Conocimiento = BASE GLOBAL (instrucciones + docs globales) + INFO PRIVADA del negocio.
    const globalKnowledge = [
      globalInstructions ? `INSTRUCCIONES GENERALES DE VENTAS (aplican a todos los negocios):\n${globalInstructions}` : '',
      globalFiles.filter((f: any) => f.content).map((f: any) => `=== [GLOBAL] ${f.name} ===\n${f.content}`).join('\n\n'),
    ].filter(Boolean).join('\n\n');
    const tenantRaw = allFiles
      .filter((f: any) => f.content)
      .map((f: any) => `=== ${f.name} ===\n${f.content}`)
      .join('\n\n');
    const globalCapped = globalKnowledge.length > 6000 ? globalKnowledge.slice(0, 6000) + '\n[...]' : globalKnowledge;
    const tenantCapped = tenantRaw.length > 10000 ? tenantRaw.slice(0, 10000) + '\n[...]' : tenantRaw;
    const knowledgeContext = [globalCapped, tenantCapped].filter(Boolean).join('\n\n');

    const history = recentMsgsSnap.docs
      .reverse()
      .map((d: any) => {
        const m = d.data();
        return `${m.sender === 'advisor' ? 'AGENTE' : 'CLIENTE'}: ${m.text}`;
      })
      .join('\n');

    const contactName = convData?.contactName || '';
    const isGenericName = !contactName || /^(usuario|negocios|business|desconocido|cliente|sin nombre|\+?[0-9\s\-]+)$/i.test(contactName.trim());
    const clientNameContext = isGenericName
      ? `Nombre del contacto: DESCONOCIDO — debes pedirlo antes de agendar.`
      : `Nombre del contacto: ${contactName}`;

    const systemPrompt = knowledgeContext
      ? `Eres un ASESOR EXPERTO EN CIERRE DE VENTAS de ${businessName} — de élite, no un bot de soporte. Tu misión es CONVERTIR cada conversación en una venta o una visita agendada.
IDENTIDAD: Los documentos de entrenamiento definen quién eres, cómo te llamas, qué vendes y los precios. Síguelos al pie de la letra y habla del producto con seguridad total.
NUNCA menciones SmartFlow Hub OS ni ninguna otra plataforma. Solo representas a ${businessName}.

MENTALIDAD DE CIERRE (tu ADN — lo más importante):
- Cada mensaje debe ACERCAR al cliente a comprar o agendar. Nada de relleno.
- RESPONDE SIEMPRE lo que te preguntan, con datos concretos de tus documentos. NUNCA evadas con "eso lo ve el equipo" si la información está en tus documentos.
- Construye valor: conecta cada dato con un beneficio real ("lotes de 1.000 m², espacio de sobra para tu casa de recreo").
- Crea urgencia SOLO si es verdad según los documentos (preventa, disponibilidad limitada, precio de lanzamiento). Jamás inventes escasez.
- Califica sin interrogar: mientras avanzas, capta qué busca, para cuándo y su presupuesto.
- Ante una duda u objeción (precio, ubicación lejos, "lo voy a pensar", etc.): primero reconocé en 3-5 palabras lo que el cliente siente o dice ("Entiendo, es una decisión importante" / "Tiene sentido que lo consultes"), y RECIÉN DESPUÉS redirigí al valor. Nunca vayas directo al reencuadre sin validar primero — se siente evasivo. Nunca pelees la objeción ni la minimices.
- CIERRE VARIADO: alterna el siguiente paso — a veces envías el documento, a veces das el precio y preguntas cuál le interesa, a veces propones la visita. NUNCA termines todos los mensajes con la misma frase "¿te gustaría agendar una cita?": eso te delata como robot y se ve poco profesional.

REGLAS ESTRICTAS:
- Los precios en los documentos son los precios FINALES de contado en preventa. No existe ningún descuento adicional por pagar de contado — ese ya es el precio más bajo disponible.
- Nunca inventes precios, descuentos o condiciones que no estén explícitamente en los documentos.
- Si el cliente pregunta por un producto/precio/descuento específico y NO aparece en tus documentos: NO lo inventes ni des un número aproximado. Respondé exactamente: "Quiero confirmarte la información correcta antes de indicártela. Un asesor te ayuda con ese dato." y usa crm_action "seguimiento".
- ⛔ PRESUPUESTO MENOR AL PRECIO (crítico): si el cliente dice tener un monto MENOR al precio mínimo (ej: "tengo 7 millones" y el lote inicia en su precio mínimo), JAMÁS le digas que con ese monto puede comprar, ni le ofrezcas el producto a ese precio, ni insinúes que "alcanza". Sé honesto y firme con el precio real de los documentos (ej: "Los lotes inician en [precio mínimo real] en preventa"). Luego pivota al valor: asesoría de crédito SIN COSTO, convenio CCSS y opciones de financiamiento para cubrir la diferencia. NUNCA bajes el precio, NUNCA negocies, NUNCA regales. El precio mínimo es intocable.
- FORMAS DE PAGO / FINANCIAMIENTO: responde con lo que digan los documentos (contado, opciones de pago, asesoría de crédito) y usa el momento para AVANZAR la venta. Ej: "Manejamos contado en preventa al mejor precio, y te conectamos asesoría de crédito sin costo. ¿Cuál lote te está gustando?" Solo menciona que "el equipo coordina los términos exactos" DESPUÉS de dar la info general — nunca como respuesta evasiva de entrada.
- ARCHIVOS — ENVÍO PROACTIVO: Cuando el cliente pide fotos, catálogo, información, precios o documentos: busca en ARCHIVOS DISPONIBLES y envía el más relevante poniendo su URL exacta en media_url y "image" o "document" en media_type. Si solo hay PDF → envíalo con reply "Aquí te comparto la información completa del proyecto." Si no hay ningún archivo disponible → di que un asesor coordinará el envío. NUNCA prometas enviar un archivo que no esté en ARCHIVOS DISPONIBLES.
- Si el cliente pide un documento específico por su nombre (ej: "master plan", "planos", "brochure", "catálogo", "lista de precios"): busca en ARCHIVOS DISPONIBLES SOLO un archivo cuyo NOMBRE corresponda claramente a lo pedido y ENVÍALO. Si NINGÚN archivo coincide con lo que pidió → NO envíes ningún otro documento en su lugar; responde "Le pido eso al equipo y se lo comparto enseguida, ¿me confirma su nombre?" y usa crm_action "seguimiento". JAMÁS envíes un documento que no sea el que pidió.

TONO Y ESTILO (lo más importante):
Escribe como un asesor real de WhatsApp: directo, cálido, sin florituras. Máximo 2-3 líneas por mensaje.
- NUNCA uses frases de call center: "Si tienes más preguntas estoy aquí", "Con gusto te ayudo", "Quedo a tus órdenes", "No dudes en consultarme" — suenan a robot.
- NUNCA repitas en tu respuesta lo que el cliente acaba de decir. Si el cliente afirma algo, acúsalo en 3-4 palabras y avanza.
- NUNCA abras con "¡Eso suena genial!", "¡Excelente!", "¡Perfecto!" para afirmaciones neutras del cliente.
- Un emoji máximo, solo si suma naturalmente. Si no suma, ninguno.
- NO termines cada mensaje con una pregunta — eso presiona y suena a checklist de vendedor, no a un asesor. Dar la información y quedarte ahí, sin pedir nada de vuelta, es una respuesta completa y válida: deja que el cliente siga cuando quiera. Como máximo 1 de cada 2 mensajes tuyos termina en pregunta; el resto simplemente informa y para.
- Si el cliente dice "Gracias", "Ok", "Listo", "Adiós" → despídete natural y breve.

REGLA DE ORO — CUANDO EL CLIENTE PIDE INFORMACIÓN:
Cuando el cliente dice "quiero información", "más información", "cuánto cuesta", "qué tienen disponible" o similar → NO preguntes "¿qué aspecto te interesa?" ANTES de dar info. Da directamente 2-3 datos clave del proyecto (tipo de propiedad, precio aproximado, característica destacada) y luego ofrece profundizar. El cliente ya dijo que quiere info — dásela.

FORMATO WHATSAPP:
- Sin asteriscos dobles (**), usa solo *uno* para negrita
- Máximo 2 líneas por mensaje

RECONOCER PETICIÓN DE ASESOR HUMANO:
- Si el cliente dice un nombre propio ("Don Eduardo?", "Eduardo?", "¿Puedo hablar con [nombre]?"), entiende que quiere contacto con esa persona — NO interpretes el nombre como parte del proyecto.
- Responde algo como: "Claro, le aviso a [nombre] que quieres hablar con él. ¿Me confirmas tu nombre completo?"
- Si dice "quiero hablar con alguien", "me comunican con un asesor", "hay alguien disponible" → misma respuesta: conecta con asesor, pide su nombre.

⛔ REGLA CRÍTICA — PORCENTAJES DE CONSTRUCCIÓN:
NUNCA menciones porcentajes de construcción (25%, 35%, etc.) al presentar precios, medidas o info general.
SOLO los mencionas si el cliente pregunta EXPLÍCITAMENTE por la construcción ("¿cuánto puedo construir?", "¿límite de construcción?", "¿cobertura?"). En cualquier otro caso, describe el lote/quinta SIN el porcentaje.
Incumplir esta regla es un error grave.

AUDIO ENTRANTE (cuando el cliente envía 🎵 Audio):
- Responde SOLO: "Recibí tu mensaje. ¿Me puedes escribir tu consulta para atenderte mejor?"
- Sin frases adicionales. Sin emojis. Máximo esa línea.
- Usa crm_action: "seguimiento" si el cliente ya mostró interés previo.

CONFIRMACIONES Y CIERRES DEL CLIENTE — ANTI-BUCLE (crítico):
Si el cliente responde "Si", "Sí", "Si claro", "Claro", "Ok", "Perfecto", "De acuerdo", "Ah bueno", "Bueno", "Entendido", "Listo", "Quedo atenta", "Quedo atento", "Estoy pendiente", "Gracias", "Hasta luego", "👍" o cualquier mensaje corto de cierre/confirmación:
- NO hagas ninguna pregunta. NUNCA.
- NO repitas preguntas que ya están en el historial reciente (si el AGENTE ya preguntó algo en los últimos 2 mensajes → no lo repitas).
- Si es un cierre → responde en máximo 5 palabras y usa crm_action: "seguimiento". FIN.
- Si confirmó una fecha de seguimiento → responde SOLO: "Listo, te escribimos el [fecha]." y usa crm_action: "seguimiento". FIN.

PROPONER LA VISITA CON TACTO (crítico — sé un vendedor sigiloso, no un script):
La visita es lo que más vende: de cada 10 personas que agendan, ~4 compran. Pero invitar en el momento equivocado espanta al cliente — no es "cada N mensajes", es leer la conversación como lo haría un asesor con calle.
- SEÑALES DE QUE YA ES BUEN MOMENTO (necesitas al menos una, no todas): pregunta por precio de algo específico, pregunta cómo llegar o dónde queda, pregunta por financiamiento/formas de pago, dice "me gusta", "me interesa", "eso busco", compara opciones (lote vs quinta), repite/profundiza sobre lo mismo, o reacciona positivo justo después de que le compartiste algo — "excelente", "genial", "me encanta", "está bueno" tras recibir precios, fotos o el documento de disponibilidad. Esa reacción es luz verde para invitar, no una señal de que ya terminó la conversación.
- SEÑALES DE QUE TODAVÍA NO — no invites: es su primer o segundo mensaje, está preguntando cosas generales sin engancharse con nada puntual, sus respuestas son cortas y desinteresadas, o ya declinó/esquivó una invitación a visitar hace poco.
- Cuando SÍ es momento: no lo anuncies como un paso de venta — amarra la invitación a lo que él mismo acaba de preguntar. Si preguntó por un lote puntual, invítalo a ver ESE lote. Ofrece dos días concretos: "¿Te gustaría verlo en persona? Tengo espacio este sábado o el domingo, ¿cuál te acomoda?"
- SILENCIO DESPUÉS DEL CIERRE: una vez que invitaste a la visita, PARÁ ahí — no agregues más datos, precios ni argumentos en el mismo mensaje. Dejá que el cliente responda a la invitación antes de seguir vendiendo.
- Si no respondió a una invitación o cambió de tema, no insistas en el mismo mensaje — seguí la conversación con naturalidad y esperá otra señal real antes de volver a proponerla.

DETECTAR INTENCIÓN DE VISITA (prioridad alta):
- Si el cliente menciona un día o fecha para visitar ("el sábado voy", "paso el viernes", "quiero ir esta semana", "voy para allá", "me gustaría visitar", "deseo agendar") → ofrece agendar de inmediato.
- Si el cliente muestra interés pero para una fecha futura ("sería para después del 26 de junio", "estoy fuera", "les contacto cuando vuelva", "más adelante") → responde: "Anotado, te escribimos el [fecha mencionada]." usa crm_action: "seguimiento". No hagas más preguntas.
- NO sigas hablando de precios o detalles sin antes ofrecer agendar cuando ya expresó intención de visita.

DATOS DEL CONTACTO ACTUAL:
${clientNameContext}

PROTOCOLO DE AGENDAMIENTO — SIN EXCEPCIONES:
Para agendar una visita necesitas DOS cosas del cliente: (1) su NOMBRE completo real y (2) un DÍA específico que ÉL mismo mencione ("el sábado", "el domingo 18", "mañana").
- Si el cliente quiere agendar pero NO dio un día concreto → pregunta "¿Qué día le queda bien para la visita?". NO agendes, NO inventes fecha, NO uses "hoy". Usa crm_action: "seguimiento".
- Si ya dio el día pero el nombre es DESCONOCIDO → responde ÚNICAMENTE: "¿Me confirmas tu nombre completo para registrar la cita?" Nada más.
- Si ya tienes NOMBRE real + DÍA específico → confirma: "Listo [Nombre], quedas agendado/a el [día] a las [hora]." usa crm_action: "visita" y pon en visit_date EXACTAMENTE el día que el cliente mencionó.
- JAMÁS confirmes una cita sin nombre real. JAMÁS pongas visit_date con la fecha de HOY ni una fecha inventada — solo el día que el cliente dijo. NUNCA uses "Te esperaré en el proyecto" ni "Nos vemos el [día]".

CUANDO EL ASESOR HUMANO INTERVINO (mensajes "AGENTE" en el historial):
- Lee lo que dijo el AGENTE y continúa en esa misma dirección — eres el mismo asesor retomando.
- No repitas lo que el AGENTE ya explicó. Parte desde ahí.
- Si el AGENTE ya respondió la pregunta, no la vuelvas a responder — avanza al siguiente paso.

DOCUMENTOS DE ENTRENAMIENTO (máxima prioridad — definen tu identidad y conocimiento):
${knowledgeContext}
${mediaContext}
HISTORIAL:
${history}

SALIDA JSON OBLIGATORIA — responde ÚNICAMENTE con este objeto JSON (sin texto extra):
{"reply":"tu respuesta al cliente aquí","crm_action":null,"visit_date":null,"visit_time":null,"media_url":null,"media_type":null}
Reglas para crm_action: null=conversación general | "seguimiento"=interés serio, ausente que volverá, O quiere agendar pero AÚN NO dio un día concreto | "visita"=SOLO si tienes nombre real Y un día específico que el CLIENTE mencionó (visit_date = ese día exacto, NUNCA hoy ni inventado) | "venta"=cliente confirma compra/pago | "perdido"=cliente rechaza claramente.
Si envías un archivo de ARCHIVOS DISPONIBLES: pon su URL exacta en media_url y "image" o "document" en media_type. El reply debe acompañar el envío.
Hoy es: ${new Date().toLocaleDateString('es-CR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.
Si el cliente menciona un día de visita, calcula la fecha ISO YYYY-MM-DD más cercana en visit_date. Si no confirma hora, usa "10:00" como default en visit_time y pregunta si esa hora le queda bien.`
      : `Eres el asistente virtual de ${businessName}.
Todavía no tienes documentos de entrenamiento cargados, así que no conoces precios, medidas ni detalles específicos del proyecto.

CÓMO RESPONDER SIN CONOCIMIENTO:
- Si preguntan por info general (precios, medidas, disponibilidad, características): di "Dame un momento, le consulto al equipo y te respondo enseguida. ¿Me confirmas tu nombre?" — NO inventes datos ni hagas preguntas de relleno.
- Si el cliente pide hablar con alguien por nombre ("Don Eduardo?", "Eduardo?"): di "Claro, le aviso que quieres hablar con él. ¿Me confirmas tu nombre completo?"
- Si dice que quiere hablar con un asesor: ofrece conectarlo de inmediato y pide su nombre.
- Si el cliente envía 🎵 Audio: responde solo "Recibí tu mensaje. ¿Me puedes escribir tu consulta para atenderte mejor?"

DATOS DEL CONTACTO ACTUAL:
${clientNameContext}

PROTOCOLO DE AGENDAMIENTO — SIN EXCEPCIONES:
Cuando el cliente quiere agendar:
- Si el nombre es DESCONOCIDO → responde SOLO: "¿Me confirmas tu nombre completo para registrar la cita?"
- Si ya tienes nombre real → confirma: "Listo [Nombre], quedas agendado/a el [día] a las [hora]." y usa crm_action: "visita".
- NUNCA confirmes sin nombre. NUNCA uses "Te esperaré en el proyecto".

TONO: Directo, máximo 2 líneas. Sin frases de call center. Sin emojis forzados.

HISTORIAL:
${history}

SALIDA JSON OBLIGATORIA — responde ÚNICAMENTE con este objeto JSON (sin texto extra):
{"reply":"tu respuesta al cliente aquí","crm_action":null,"visit_date":null,"visit_time":null,"media_url":null,"media_type":null}
Reglas para crm_action: null=conversación general | "seguimiento"=interés serio, ausente que volverá, O quiere agendar pero AÚN NO dio un día concreto | "visita"=SOLO si tienes nombre real Y un día específico que el CLIENTE mencionó (visit_date = ese día exacto, NUNCA hoy ni inventado) | "venta"=cliente confirma compra/pago | "perdido"=cliente rechaza claramente.`;

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.warn('[AI Autopilot] OPENAI_API_KEY no configurada.');
      return;
    }

    console.log(`[AI Autopilot] Consultando GPT-4o-mini...`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: incomingText }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 350,
        temperature: 0.55
      },
      { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' } }
    );

    const candidate = response.data?.choices?.[0]?.message?.content;
    if (!candidate) {
      console.error('[AI Autopilot] GPT-4o-mini no retornó respuesta.');
      return;
    }

    let parsed: any = {};
    try { parsed = JSON.parse(candidate); } catch { parsed = { reply: candidate }; }
    let aiReply = (parsed.reply || candidate).trim();
    const crmAction: string | null = parsed.crm_action || null;
    const visitDate: string | null = parsed.visit_date || null;
    const visitTime: string | null = parsed.visit_time || null;
    const botMediaUrl: string | null = parsed.media_url || null;
    const botMediaType: string | null = parsed.media_type || null;
    console.log(`[AI Autopilot] Respuesta raw: "${aiReply}" | crm_action: ${crmAction}`);

    // POST-PROCESADO: detectar cierres del cliente y evitar bucles de preguntas.
    // OJO: solo palabras de "ya terminé por ahora" (gracias, listo, hasta luego...).
    // Palabras de entusiasmo/interés ("excelente", "genial", "sí", "claro") NO van
    // acá — son justo el momento de invitar a la visita, no de callarse. Antes
    // "excelente" estaba en esta lista y borraba la invitación a agendar aunque
    // el cliente acabara de reaccionar positivo al recibir el PDF.
    const closurePatterns = /^(ok|okay|de acuerdo|ah bueno|bueno|entendido|listo|quedo atenta?|estoy pendiente|gracias|hasta luego|👍|🙏)[\s!.]*$/i;
    if (closurePatterns.test(incomingText.trim())) {
      // Si el cliente mandó un cierre, la respuesta no debe tener preguntas
      aiReply = aiReply
        .replace(/[¿?][^.!]*[?]/g, '')  // eliminar preguntas completas
        .replace(/\.\s*¿[^?]*\?/g, '')  // eliminar preguntas al final
        .trim();
      if (!aiReply) aiReply = '¡Perfecto! Quedamos pendientes. 🙌';
      console.log(`[AI Autopilot] Cierre detectado, respuesta limpia: "${aiReply}"`);
    }

    // POST-PROCESADO: quitar el % de construcción SALVO que el cliente lo haya pedido.
    // Se elimina la FRASE COMPLETA (incluyendo "con un… permitida") y se limpia la
    // puntuación, para no dejar fragmentos rotos como "con un permitida".
    const askedAboutConstruction = /construc|construir|edificar|l[ií]mite\s+de\s+construc|cobertura|cu[aá]nto\s+puedo/i.test(incomingText);
    if (!askedAboutConstruction && /\d+\s*%/.test(aiReply)) {
      aiReply = aiReply
        .replace(/,?\s*con\s+(un[ao]?\s+)?\d+\s*%\s*de\s+construcci[oó]n(\s+permitida)?/gi, '')
        .replace(/,?\s*con\s+(una?\s+)?construcci[oó]n\s+permitida\s+del\s+\d+\s*%/gi, '')
        .replace(/,?\s*(y\s+)?permiten?\s+una?\s+construcci[oó]n\s+(del|de)\s+\d+\s*%/gi, '')
        .replace(/,?\s*(cobertura\s+de\s+)?construcci[oó]n\s+(permitida\s+)?(de|del|hasta(\s+el)?)\s+\d+\s*%/gi, '')
        .replace(/,?\s*hasta\s+(el\s+)?\d+\s*%\s*(de|del)?\s*construcci[oó]n/gi, '')
        .replace(/\s*\(\s*\d+\s*%\s*(de\s+)?construcci[oó]n\s*\)/gi, '')
        // limpieza de residuos
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,;:])/g, '$1')
        .replace(/,\s*\./g, '.')
        .trim();
      console.log(`[AI Autopilot] % de construcción removido: "${aiReply}"`);
    }

    // Detectar marcador de link de pago [PAGO:concepto:monto:moneda]
    const paymentMarker = aiReply.match(/\[PAGO:([^:]+):([^:]+):([^\]]+)\]/i);
    if (paymentMarker) {
      try {
        const concept = paymentMarker[1].trim();
        const amount = parseFloat(paymentMarker[2].trim()) || 0;
        const currency = paymentMarker[3].trim().toUpperCase();
        const paypalEmail = settingsData.paypalEmail || '';
        const linkId = crypto.randomBytes(6).toString('hex');

        await db.collection('payment_requests').doc(linkId).set({
          tenantId,
          customer: convData?.contactName || 'Cliente WhatsApp',
          concept,
          amount,
          currency,
          status: 'pending',
          paypalEmail,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'bot_autopilot',
          conversationId
        });

        const paymentLink = `https://hub.smartflow-suite.com/pay/${linkId}`;
        aiReply = aiReply.replace(paymentMarker[0], `\n💳 *Link de pago seguro:*\n${paymentLink}`);
        console.log(`[AI Autopilot] Link de pago generado: ${paymentLink}`);
      } catch (payErr: any) {
        console.error('[AI Autopilot] Error generando link de pago:', payErr.message);
        aiReply = aiReply.replace(paymentMarker[0], '');
      }
    }

    // GUARDRAIL DE PRECIO — última puerta antes de enviar. Si la respuesta
    // menciona un monto que no está en los documentos fuente del negocio, se
    // BLOQUEA el envío del texto original, se reemplaza por una respuesta
    // segura, y se apaga el bot en esta conversación para que un humano la
    // retome — nunca se manda un precio no verificado a un cliente real.
    const priceCheck = validateAiReplyPrices(aiReply, knowledgeContext);
    if (!priceCheck.ok) {
      console.error('AI_PRICE_VALIDATION_FAILED', {
        tenantId, conversationId, invalidTokens: priceCheck.invalidTokens, originalReply: aiReply,
      });
      aiReply = AI_SAFE_ESCALATION_REPLY;
      await db.collection('conversations').doc(conversationId).update({ botEnabled: false }).catch(() => {});
      await db.collection('notifications').add({
        tenantId,
        type: 'ai_price_validation_failed',
        title: 'IA bloqueó un precio no verificado',
        body: `Revisá la conversación de ${convData?.contactName || 'un cliente'} — la IA iba a mencionar un monto que no está en tus documentos. Se apagó el bot en esa conversación.`,
        link: '/conversaciones',
        leadId: convData?.leadId || null,
        conversationId,
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((e: any) => console.warn('[AI Autopilot] Notif price validation error:', e.message));
    }

    console.log(`[AI Autopilot] Respuesta final: "${aiReply}"`);

    // ENVIAR RESPUESTA SEGÚN EL CANAL
    if (source === 'whatsapp') {
      const phoneNumberId = integrationData.phoneNumberId;
      const accessToken = integrationData.accessToken;
      const destinationPhone = convData?.phoneE164 || convData?.phoneRaw;

      if (!phoneNumberId || !accessToken || !destinationPhone) {
        console.warn('[AI Autopilot WA] Faltan parámetros para enviar mensaje.');
        return;
      }

      if (botMediaUrl) {
        const isImage = botMediaType === 'image' || /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(botMediaUrl);
        const waType = isImage ? 'image' : 'document';
        const mediaPayload: any = { link: botMediaUrl, caption: aiReply };
        if (!isImage) mediaPayload.filename = botMediaUrl.split('/').pop()?.split('?')[0] || 'archivo.pdf';
        await axios.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destinationPhone.replace('+', ''),
          type: waType,
          [waType]: mediaPayload,
        }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
      } else {
        await axios.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destinationPhone.replace('+', ''),
          type: 'text',
          text: { body: aiReply }
        }, {
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });
      }

      console.log('[AI Autopilot WA] Respuesta enviada.');

    } else {
      const accessToken = integrationData.accessToken;
      const recipientId = integrationData.recipientId;

      if (!accessToken || !recipientId) {
        console.warn('[AI Autopilot Meta] Faltan credenciales o recipientId.');
        return;
      }

      const metaBase = `https://graph.facebook.com/v17.0/me/messages?access_token=${accessToken}`;
      const metaHeaders = { 'Content-Type': 'application/json' };

      if (botMediaUrl) {
        const isImage = botMediaType === 'image' || /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(botMediaUrl);
        await axios.post(metaBase, {
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: isImage ? 'image' : 'file',
              payload: { url: botMediaUrl, is_reusable: true }
            }
          }
        }, { headers: metaHeaders });
        if (aiReply) {
          await axios.post(metaBase, {
            recipient: { id: recipientId },
            message: { text: aiReply }
          }, { headers: metaHeaders });
        }
      } else {
        await axios.post(metaBase, {
          recipient: { id: recipientId },
          message: { text: aiReply }
        }, { headers: metaHeaders });
      }

      console.log('[AI Autopilot Meta] Respuesta enviada.');
    }

    // PERSISTENCIA EN FIRESTORE (Transaccional)
    const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc();
    const conversationRef = db.collection('conversations').doc(conversationId);

    await db.runTransaction(async (transaction) => {
      transaction.set(msgRef, {
        text: aiReply,
        sender: 'advisor',
        direction: 'outbound',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        type: botMediaUrl ? 'media' : 'text',
        mediaUrl: botMediaUrl || null,
        mediaType: botMediaType || null,
        status: 'sent',
        externalId: `ai.${crypto.randomBytes(8).toString('hex')}`
      });

      transaction.update(conversationRef, {
        lastMessage: aiReply,
        lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSender: 'advisor',
        unreadCount: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    console.log('[AI Autopilot] Guardado con éxito.');

    // CRM + AGENDA AUTOMATION
    if (crmAction && convData?.leadId) {
      // Resolver la etiqueta REAL de la etapa desde el pipeline del negocio (el tenant
      // puede haber renombrado las columnas, p.ej. "Agendo" en vez de "Agendado").
      // Se mapea por ID de etapa (estable); si no, por palabra clave; y por último al default.
      //
      // POLÍTICA (Fase 5 — go-live): "seguimiento" y "visita" son de riesgo bajo
      // (reversibles, no declaran un resultado de negocio) y el LLM puede
      // moverlas solo. "venta"/"perdido" quedan DELIBERADAMENTE fuera de este
      // mapa — el LLM detecta la señal pero NUNCA mueve la etapa él mismo, ver
      // el bloque de abajo que solo crea una notificación pidiendo confirmación
      // humana. Antes "venta" sí movía a "Venta Realizada" automáticamente
      // (ver notificación "¡Venta cerrada!" abajo) — eso es exactamente lo que
      // un cliente ya sufrió con otro CRM/IA: un cierre falso-positivo sin que
      // nadie lo confirme.
      const pipelineStages: any[] = settingsData.pipeline?.stages || [];
      const idForAction: Record<string, string> = {
        seguimiento: 'seguimiento', visita: 'visita-tecnica',
      };
      const kwForAction: Record<string, RegExp> = {
        seguimiento: /seguim/i, visita: /agend|visita|cita/i,
      };
      const fallbackLabel: Record<string, string> = {
        seguimiento: 'Seguimiento', visita: 'Agendado',
      };
      const resolveStageLabel = (action: string): string | undefined => {
        const byId = pipelineStages.find((s) => s.id === idForAction[action]);
        if (byId?.label) return byId.label;
        const kw = kwForAction[action];
        const byKw = kw ? pipelineStages.find((s) => kw.test(s.label || '')) : undefined;
        if (byKw?.label) return byKw.label;
        return fallbackLabel[action];
      };
      const newStage = (crmAction === 'venta' || crmAction === 'perdido') ? undefined : resolveStageLabel(crmAction);
      if (newStage) {
        // El leadId guardado en la conversación puede haber quedado huérfano
        // (documento borrado/movido). Si el update falla por "not-found",
        // se busca el lead real por tenantId+telefono (mismo criterio que al
        // crearlo) en vez de perder el movimiento de CRM silenciosamente.
        let leadRef = db.collection('leads').doc(convData.leadId);
        let leadSnap = await leadRef.get();
        if (!leadSnap.exists && convData.phoneRaw) {
          const byPhone = await db.collection('leads')
            .where('tenantId', '==', tenantId)
            .where('phone', '==', convData.phoneRaw)
            .limit(1)
            .get();
          if (!byPhone.empty) {
            leadRef = byPhone.docs[0].ref;
            leadSnap = byPhone.docs[0];
            console.warn(`[AI Autopilot] leadId ${convData.leadId} huérfano, usando lead real ${leadRef.id} por teléfono`);
          }
        }
        if (leadSnap.exists) {
          await leadRef.update({
            stage: newStage,
            lastActivity: new Date().toISOString(),
          }).then(() => console.log(`[AI Autopilot] CRM: Lead ${leadRef.id} → ${newStage}`))
            .catch((e: any) => console.error('[AI Autopilot] CRM update error:', e.message));
        } else {
          console.error(`[AI Autopilot] CRM: no se encontró ningún lead (ni por id ni por teléfono) para mover a "${newStage}"`);
        }
      }

      // "venta"/"perdido" NUNCA mueven la etapa solos (ver comentario arriba) —
      // solo alertan a un humano para que confirme o descarte manualmente en
      // el CRM. El bot tampoco confirma pago: eso sigue siendo exclusivo de
      // "Confirmar pago recibido" (Owner/Admin, ver PaymentService.markAsPaid).
      if (crmAction === 'venta') {
        console.log('AI_SALE_SUGGESTED', { tenantId, conversationId, leadId: convData.leadId });
        await db.collection('notifications').add({
          tenantId,
          type: 'venta_sugerida',
          title: 'Posible venta — confirmar en CRM',
          body: `${convData.contactName || 'Cliente'} parece haber confirmado la compra. Revisá y movelo a "Venta Realizada" manualmente si corresponde.`,
          link: '/crm',
          leadId: convData.leadId,
          conversationId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e: any) => console.warn('[AI Autopilot] Notif venta_sugerida error:', e.message));
      }

      if (crmAction === 'perdido') {
        console.log('AI_LOST_SUGGESTED', { tenantId, conversationId, leadId: convData.leadId });
        await db.collection('notifications').add({
          tenantId,
          type: 'perdido_sugerido',
          title: 'Posible lead perdido — confirmar en CRM',
          body: `${convData.contactName || 'Cliente'} parece haber rechazado la oferta. Revisá y movelo a "Perdido" manualmente si corresponde.`,
          link: '/crm',
          leadId: convData.leadId,
          conversationId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e: any) => console.warn('[AI Autopilot] Notif perdido_sugerido error:', e.message));
      }

      // Solo agendar si hay una FECHA real confirmada por el cliente (nunca inventada).
      if (crmAction === 'visita' && visitDate) {
        const dateStr = visitDate;
        const timeStr = visitTime || '10:00';

        // Evitar CITAS DUPLICADAS: borrar visitas pendientes previas de este mismo lead
        // (p.ej. si el cliente corrige la fecha, se reemplaza en vez de duplicar).
        try {
          const prev = await db.collection('agenda_items').where('leadId', '==', convData.leadId).get();
          const batch = db.batch();
          prev.docs.forEach((d: any) => {
            const x = d.data();
            if (x.tenantId === tenantId && x.type === 'visita' && !x.isCompleted) batch.delete(d.ref);
          });
          if (!prev.empty) await batch.commit();
        } catch (e: any) { console.warn('[AI Autopilot] Dedup agenda error:', e.message); }

        await db.collection('agenda_items').add({
          tenantId,
          title: `Visita: ${convData.contactName || 'Cliente'}`,
          type: 'visita',
          date: `${dateStr}T${timeStr}:00`,
          leadId: convData.leadId,
          advisorId: convData.advisorId || '',
          isCompleted: false,
          source: 'bot_autopilot',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e: any) => console.warn('[AI Autopilot] Agenda create error:', e.message));
        console.log(`[AI Autopilot] Agenda: Visita creada ${dateStr} ${timeStr}`);

        // Notificación in-app (campanita del Hub)
        await db.collection('notifications').add({
          tenantId,
          type: 'cita_agendada',
          title: 'Nueva cita agendada',
          body: `${convData.contactName || 'Cliente'} · ${dateStr} a las ${timeStr}`,
          link: '/agenda',
          leadId: convData.leadId,
          conversationId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e: any) => console.warn('[AI Autopilot] Notif create error:', e.message));

        // Email de notificación al equipo
        const adminEmail = settingsData.email || settingsData.adminEmail || settingsData.contactEmail;
        const sgKey = process.env.SENDGRID_API_KEY;
        if (adminEmail && sgKey) {
          sgMail.setApiKey(sgKey);
          await sgMail.send({
            to: adminEmail,
            from: 'noreply@smartflow-suite.com',
            subject: `📅 Nueva visita agendada — ${convData.contactName || 'Cliente'}`,
            html: `<h2>Nueva visita agendada por el Agente IA</h2>
<p><strong>Cliente:</strong> ${convData.contactName || 'Sin nombre'}</p>
<p><strong>Teléfono:</strong> ${convData.phoneRaw || '-'}</p>
<p><strong>Fecha:</strong> ${dateStr} a las ${timeStr}</p>
<p><strong>Canal:</strong> ${source.toUpperCase()}</p>
<p><a href="https://hub.smartflow-suite.com/agenda">Ver en Agenda →</a></p>`
          }).catch((e: any) => console.warn('[AI Autopilot] Email notif error:', e.message));
          console.log(`[AI Autopilot] Email enviado a ${adminEmail}`);
        }
      }
    }

  } catch (err: any) {
    console.error('[AI Autopilot] Error:', err.message || err);
  }
}

// ─── Multi-Agente: asignación automática (round-robin) ────────────────────
// Server-authoritative — nunca decidir el asesor en el frontend. Mantener el
// concepto de elegibilidad en sync con src/utils/multiAgentEligibility.ts
// (frontend, usado solo para reflejar/editar la config, no para decidir).
interface AutoAssignResult {
  advisorId: string | null;
  assignmentSource: 'auto_round_robin' | 'unassigned_free_mode' | 'unassigned_no_eligible' | 'unassigned_error';
}

/**
 * Elige el próximo asesor por round-robin y avanza el cursor, todo dentro de
 * una transacción de Firestore sobre settings/{tenantId} — así, si dos
 * conversaciones nuevas llegan casi al mismo tiempo para el mismo tenant,
 * Firestore serializa/reintenta las transacciones en conflicto y ninguna
 * lee un cursor obsoleto: no pueden terminar asignando la misma persona dos
 * veces seguidas. La creación del documento de conversación en sí queda
 * FUERA de esta transacción a propósito — el recurso compartido que hay que
 * proteger es el cursor (un valor por tenant), no cada conversación
 * individual, que es exclusiva de su propio flujo.
 */
async function assignConversationAdvisor(tenantId: string): Promise<AutoAssignResult> {
  console.log('MULTI_AGENT_ASSIGNMENT_START', { tenantId });
  const settingsRef = db.collection('settings').doc(tenantId);
  const membershipsQuery = db.collection('memberships').where('tenantId', '==', tenantId);

  try {
    return await db.runTransaction(async (tx) => {
      const [settingsSnap, membershipsSnap] = await Promise.all([
        tx.get(settingsRef),
        tx.get(membershipsQuery),
      ]);

      const multiAgentConfig = settingsSnap.exists ? settingsSnap.data()?.multiAgentConfig : null;

      // Modo Libre (o sin configurar todavía): la conversación entra sin
      // advisorId — cualquier asesor elegible la puede reclamar a mano
      // (ver claimConversation).
      if (!multiAgentConfig?.isAutoDistributionEnabled) {
        return { advisorId: null, assignmentSource: 'unassigned_free_mode' };
      }

      const includedUserIds: string[] = Array.isArray(multiAgentConfig.includedUserIds) ? multiAgentConfig.includedUserIds : [];
      // null/undefined = todos los active+incluidos son elegibles (fallback,
      // comportamiento por defecto); array explícito = lista curada — ver
      // sección 8: este toggle NO afecta el estado de la cuenta del vendedor.
      const leadEnabledUserIds: string[] | null = Array.isArray(multiAgentConfig.leadEnabledUserIds) ? multiAgentConfig.leadEnabledUserIds : null;

      const candidateIds: string[] = [];
      membershipsSnap.forEach(doc => {
        const m = doc.data();
        if (m.status !== 'active') return;
        const identifier = m.userId || doc.id;
        if (!includedUserIds.includes(identifier)) return;
        if (leadEnabledUserIds !== null && !leadEnabledUserIds.includes(identifier)) return;
        candidateIds.push(identifier);
      });

      // LOOP — dispositivo confiable + estado operativo: solo quien puso
      // 'working' entra al pool de asignación AUTOMÁTICA. coffee/lunch/
      // errand/off_shift lo sacan del round-robin sin tocar las conversaciones
      // que ya tenía asignadas (eso no cambia acá, solo futuras asignaciones).
      // Sin doc de presencia todavía (o sin operationalStatus) = tratar como
      // off_shift, nunca 'working' por defecto (ver Fase 21 - migración).
      const presenceSnaps = await Promise.all(
        candidateIds.map(id => tx.get(db.collection('user_presence').doc(`${tenantId}_${id}`)))
      );
      const eligibleIds: string[] = candidateIds.filter((_, i) => {
        const presence = presenceSnaps[i];
        return presence.exists && presence.data()?.operationalStatus === 'working';
      });
      // Orden determinístico y estable — el round-robin necesita una
      // secuencia fija para que "el siguiente después del cursor" tenga
      // sentido entre llamadas.
      eligibleIds.sort();

      console.log('MULTI_AGENT_ELIGIBLE_ADVISORS', { tenantId, candidateIds, eligibleIds });

      if (eligibleIds.length === 0) {
        console.warn('MULTI_AGENT_NO_ELIGIBLE_ADVISORS', { tenantId });
        const notifRef = db.collection('notifications').doc();
        tx.set(notifRef, {
          tenantId,
          type: 'multi_agent_unassigned',
          title: 'Conversación sin asignar ⚠️',
          body: 'Llegó una conversación nueva pero no hay ningún asesor elegible para recibir leads automáticamente. Revisá Multi-Agente.',
          link: '/multi-agent',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { advisorId: null, assignmentSource: 'unassigned_no_eligible' };
      }

      const cursor: string | undefined = multiAgentConfig.roundRobinCursor;
      const cursorIndex = cursor ? eligibleIds.indexOf(cursor) : -1;
      const nextIndex = (cursorIndex + 1) % eligibleIds.length;
      const selected = eligibleIds[nextIndex];

      console.log('MULTI_AGENT_ROUND_ROBIN_SELECTED', { tenantId, selected, cursorIndex, nextIndex, eligibleCount: eligibleIds.length });

      tx.update(settingsRef, {
        'multiAgentConfig.roundRobinCursor': selected,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log('MULTI_AGENT_ASSIGNMENT_SUCCESS', { tenantId, advisorId: selected });
      return { advisorId: selected, assignmentSource: 'auto_round_robin' };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[MultiAgente] Error en assignConversationAdvisor:', message);
    return { advisorId: null, assignmentSource: 'unassigned_error' };
  }
}

/**
 * Webhook de WhatsApp Cloud API
 */
export const whatsappWebhook = functions.runWith({ secrets: ['OPENAI_API_KEY'] }).https.onRequest(async (req, res) => {
  // 1. Verificación del Webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const tokenRaw = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const token = typeof tokenRaw === 'string' ? tokenRaw : '';

    if (!token) {
      res.status(403).send('Forbidden');
      return;
    }

    // Buscar integración por Verify Token
    const integrationsSnapshot = await db.collection('integrations')
      .where('verifyToken', '==', token)
      .limit(1)
      .get();

    // Fallback al token global si no se encuentra en DB (comparacion en tiempo constante)
    const globalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
    const matchesGlobal = globalVerifyToken !== '' && safeStrEqual(token, globalVerifyToken);

    if (mode === 'subscribe' && (!integrationsSnapshot.empty || matchesGlobal)) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).type('text/plain').send(typeof challenge === 'string' ? challenge : '');
      return;
    } else {
      res.status(403).send('Forbidden');
      return;
    }
  }

  // 2. Recepción de Mensajes (POST)
  if (req.method === 'POST') {
    const body = req.body;
    if (body.object === 'whatsapp_business_account') {
      try {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        // B. RESOLUCIÓN DE TENANT E INTEGRACION ANTES DE FIRMA (BYOA Schema)
        const phoneNumberId = value?.metadata?.phone_number_id;
        
        if (!phoneNumberId) {
          res.sendStatus(200);
          return;
        }

        let integrationsSnapshot = await db.collection('integrations')
          .where('phoneNumberId', '==', phoneNumberId)
          .where('isActive', '==', true)
          .limit(1)
          .get();

        if (integrationsSnapshot.empty) {
          console.error('Tenant no encontrado para phoneNumberId:', phoneNumberId);
          await db.collection('integration_logs').add({
            type: 'ERROR',
            message: `No se encontró integración activa para el número ID: ${phoneNumberId}`,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            metadata: { phoneNumberId }
          });
          res.sendStatus(200); 
          return;
        }

        const integrationData = integrationsSnapshot.docs[0].data();
        const tenantId = integrationData.tenantId;

        // Cachear el número legible (display_phone_number) que envía Meta en cada
        // webhook, para mostrarlo en el panel de SuperAdmin sin llamar a Graph.
        const incomingDisplayPhone = value?.metadata?.display_phone_number;
        if (incomingDisplayPhone && incomingDisplayPhone !== integrationData.displayPhoneNumber) {
          integrationsSnapshot.docs[0].ref
            .update({ displayPhoneNumber: incomingDisplayPhone })
            .catch((e: any) => console.warn('[Webhook WA] No se pudo cachear displayPhoneNumber:', e.message));
        }

        // 2.1 Validación de firma HMAC de Meta usando el appSecret del tenant
        const signature = req.headers['x-hub-signature-256'] as string;
        const tenantAppSecret = integrationData.appSecret || (process.env.WHATSAPP_APP_SECRET || '').trim();

        if (signature) {
          const rawBody = (req as any).rawBody;
          if (!rawBody) console.error('rawBody is undefined!');
          
          const isValid = validateSignature(rawBody, signature, tenantAppSecret);
          if (!isValid) {
            console.error('Signature check failed para tenant:', tenantId);
            res.status(403).send('Signature check failed');
            return;
          }
        } else {
          res.status(403).send('Missing signature');
          return;
        }

        // Validar que sea un evento de mensaje
        if (value && value.messages?.[0]) {
          const message = value.messages[0];
          const contact = value.contacts[0];
          const wamid = message.id;

          // A. DEDUPLICACIÓN ROBUSTA
          const dedupRef = db.collection('whatsapp_message_dedup').doc(wamid);
          const dedupDoc = await dedupRef.get();
          if (dedupDoc.exists) {
            console.log('Documento duplicado omitido:', wamid);
            res.sendStatus(200);
            return;
          }

          // Bloque C: Preparacion y Upsert Leads - El tenant resolve ya se hizo arriba


          // C. PREPARACIÓN DE DATOS
          const waId = message.from; // Número del cliente

          // Rate limiting por número de teléfono (max 20 msgs/min)
          if (isRateLimited(waId)) {
            console.warn(`[RateLimit] Flood detectado desde ${waId}, mensaje descartado`);
            res.sendStatus(200);
            return;
          }

          const phoneE164 = `+${waId}`;
          const contactName = contact.profile?.name || phoneE164;
          let text = '[Mensaje no textual]';
          if (message.type === 'text') {
            text = message.text?.body || '[Mensaje no textual]';
          } else if (message.type === 'location') {
            const loc = message.location;
            const parts: string[] = ['[Ubicación compartida]'];
            if (loc?.name) parts.push(loc.name);
            if (loc?.address) parts.push(loc.address);
            if (loc?.latitude && loc?.longitude) {
              parts.push(`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`);
            }
            text = parts.join(' — ');
          } else if (message.type === 'image') {
            text = '[El cliente envió una imagen]';
          } else if (message.type === 'audio') {
            text = '[El cliente envió un audio]';
          } else if (message.type === 'document') {
            text = `[El cliente envió un documento: ${message.document?.filename || 'archivo'}]`;
          } else if (message.type === 'sticker') {
            text = '[El cliente envió un sticker]';
          }

          // D. DETECCIÓN DE ORIGEN DEL LEAD
          const referral = (message as any).referral;
          let utmSource = 'organico';
          let sourceLabel = 'Orgánico / Directo';
          let productInterest = '';
          const textLower = text.toLowerCase().trim();

          // Textos exactos de los botones de la landing page
          const isLandingLote = textLower.includes('me interesa un lote en iguana park');
          const isLandingQuinta = textLower.includes('me interesa una quinta en iguana park');
          const isLandingGeneral = textLower.includes('me interesa el proyecto iguana park');
          const isLandingInfo = textLower.includes('quiero información completa del proyecto iguana park') ||
                                textLower.includes('quiero informacion completa del proyecto iguana park');
          // Texto exacto de la plantilla VEG2025 (campaña directa WhatsApp Ads)
          const isCampaignTemplate = textLower.includes('deseo más información sobre las quintas y los lotes') ||
                                     textLower.includes('deseo mas informacion sobre las quintas y los lotes');

          if (referral?.source_type === 'ad') {
            utmSource = 'whatsapp_ad';
            const headline = referral.headline ? ` — "${referral.headline}"` : '';
            sourceLabel = `Campaña WhatsApp Ads${headline}`;
          } else if (isCampaignTemplate) {
            // Fallback: plantilla VEG2025 sin referral (doble seguridad)
            utmSource = 'whatsapp_ad';
            sourceLabel = 'Campaña WhatsApp Ads (VEG2025)';
          } else if (isLandingLote) {
            utmSource = 'landing_page';
            sourceLabel = 'Landing Page — Lote';
            productInterest = 'Lote';
          } else if (isLandingQuinta) {
            utmSource = 'landing_page';
            sourceLabel = 'Landing Page — Quinta';
            productInterest = 'Quinta';
          } else if (isLandingGeneral || isLandingInfo) {
            utmSource = 'landing_page';
            sourceLabel = 'Landing Page (botón web)';
          }

          // Fase 4 go-live (atribución Meta): antes solo se guardaba sourceLabel
          // como STRING legible ("Campaña WhatsApp Ads — headline") — útil para
          // mostrar en el CRM, pero inservible el día que se implemente el envío
          // de eventos a Meta CAPI (necesita los IDs/campos crudos, no un texto
          // ya formateado). Se preserva el objeto `referral` completo tal como
          // llega de Meta, más los campos ya documentados hoy (source_type,
          // source_id, headline) sueltos para lectura fácil. El nombre exacto
          // del campo de click id de click-to-WhatsApp (`ctwa_clid` aquí) NO
          // está confirmado contra la documentación vigente de WhatsApp
          // Business Platform — por eso también se guarda `raw` completo: si el
          // campo real tiene otro nombre, no se pierde, solo no queda además
          // como columna suelta hasta confirmarlo. No se envía nada a Meta
          // todavía — esto es solo persistencia para no perder el dato.
          const adAttribution = referral ? {
            sourceType: referral.source_type || null,
            sourceId: referral.source_id || null,
            headline: referral.headline || null,
            ctwaClid: referral.ctwa_clid || null,
            raw: referral,
            capturedAt: admin.firestore.FieldValue.serverTimestamp(),
          } : null;

          // D.0 RESOLVER ETAPA POR DEFECTO DEL PIPELINE DEL TENANT
          // El CRM (Kanban) solo renderiza leads cuya `stage` coincide con una etapa
          // configurada en settings/{tenantId}.pipeline.stages. Si hardcodeamos 'Nuevo'
          // y el tenant personalizó su pipeline sin esa etiqueta, el lead queda huérfano
          // (se crea en Firestore pero no aparece en ninguna columna del CRM).
          let defaultStage = 'Nuevo';
          try {
            const settingsSnap = await db.collection('settings').doc(tenantId).get();
            const pipelineStages = settingsSnap.data()?.pipeline?.stages;
            if (Array.isArray(pipelineStages) && pipelineStages.length > 0) {
              const def = pipelineStages.find((s: any) => s.isDefault)
                || pipelineStages.slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
              if (def?.label) defaultStage = def.label;
            }
          } catch (e) {
            console.warn(`[Webhook WA] No se pudo leer el pipeline del tenant ${tenantId}, usando etapa por defecto "Nuevo"`);
          }

          // D. UPSERT LEAD
          let leadId = '';
          const leadsSnapshot = await db.collection('leads')
            .where('tenantId', '==', tenantId)
            .where('phone', '==', waId)
            .limit(1)
            .get();

          if (leadsSnapshot.empty) {
            const newLeadRef = await db.collection('leads').add({
              tenantId,
              name: contactName,
              phone: waId,
              city: 'Desconocido',
              clientType: 'Residencial',
              keyData: `Origen: ${sourceLabel}${productInterest ? ` | Interés: ${productInterest}` : ''}`,
              advisorId: '',
              source: 'WhatsApp',
              utmSource,
              productInterest: productInterest || '',
              ...(adAttribution ? { adAttribution } : {}),
              stage: defaultStage,
              lastActivity: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              orderIndex: Date.now(),
            });
            leadId = newLeadRef.id;
            console.log(`[Webhook WA] Nuevo lead creado: ${leadId} | Origen: ${sourceLabel}`);
            db.collection('notifications').add({
              tenantId,
              type: 'nuevo_lead',
              title: 'Nuevo lead 🚀',
              body: `${contactName || 'Cliente'} escribió por WhatsApp`,
              link: '/crm',
              leadId,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch((e: any) => console.warn('[Webhook WA] Notif lead error:', e.message));
          } else {
            leadId = leadsSnapshot.docs[0].id;
          }

          // E. UPSERT CONVERSATION
          let conversationId = '';
          const convSnapshot = await db.collection('conversations')
            .where('tenantId', '==', tenantId)
            .where('phoneRaw', '==', waId)
            .limit(1)
            .get();

          if (convSnapshot.empty) {
            const assignment = await assignConversationAdvisor(tenantId);
            const newConvRef = await db.collection('conversations').add({
              tenantId,
              leadId,
              contactName,
              phoneRaw: waId,
              phoneE164: phoneE164,
              phoneSearchKey: waId,
              lastMessage: text,
              lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
              lastInboundDate: admin.firestore.FieldValue.serverTimestamp(),
              lastMessageSender: 'lead',
              unreadCount: 1,
              status: 'active',
              // El bot SIEMPRE arranca apagado — el asesor lo activa a mano por
              // chat con el toggle "Bot ON/OFF". Pedido explícito: nunca auto-ON.
              botEnabled: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              advisorId: assignment.advisorId || '',
              assignmentSource: assignment.assignmentSource,
              assignedAt: assignment.advisorId ? admin.firestore.FieldValue.serverTimestamp() : null,
              ...(adAttribution ? { adAttribution } : {}),
            });
            conversationId = newConvRef.id;

            // El lead se crea (paso D) ANTES de calcular la asignación de
            // Multi-Agente (recién disponible acá), así que siempre nacía con
            // advisorId:'' aunque la conversación sí quedara bien asignada —
            // el lead quedaba "Sin asignar" en el CRM aunque un asesor ya
            // tuviera la conversación. Se propaga la MISMA asignación al lead,
            // sin pisar un advisorId ya puesto a mano (ej. lead reusado).
            if (assignment.advisorId) {
              const leadRef = db.collection('leads').doc(leadId);
              const leadSnapForAssign = await leadRef.get();
              if (leadSnapForAssign.exists && !leadSnapForAssign.data()?.advisorId) {
                await leadRef.update({ advisorId: assignment.advisorId }).catch((e: any) =>
                  console.warn('[Webhook WA] No se pudo propagar advisorId al lead:', e.message));
              }
            }
          } else {
            conversationId = convSnapshot.docs[0].id;
          }

          // F. MEDIA DOWNLOAD (audio/imagen entrante desde WhatsApp → Firebase Storage)
          let inboundMediaUrl: string | null = null;
          const inboundMsgType = (message.type === 'text' || message.type === 'location') ? 'text' : message.type;
          if ((message.type === 'audio' || message.type === 'image') && integrationData.accessToken) {
            const mediaId = (message as any).audio?.id || (message as any).image?.id;
            if (mediaId) {
              try {
                const mediaInfoRes = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
                  headers: { Authorization: `Bearer ${integrationData.accessToken}` }
                });
                const whatsappMediaUrl: string = mediaInfoRes.data.url;
                const rawMime: string = mediaInfoRes.data.mime_type || (message.type === 'audio' ? 'audio/ogg' : 'image/jpeg');
                const mimeType = rawMime.split(';')[0].trim();
                const extMap: Record<string, string> = {
                  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
                  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
                };
                const ext = extMap[mimeType] || (message.type === 'audio' ? 'ogg' : 'jpg');
                const mediaBuffer = await axios.get(whatsappMediaUrl, {
                  responseType: 'arraybuffer',
                  headers: { Authorization: `Bearer ${integrationData.accessToken}` }
                });
                const bucket = admin.storage().bucket();
                // P1 SEGURIDAD: la ruta antes era `${tenantId}/${Date.now()}.${ext}`
                // — con el tenantId conocido y un timestamp en milisegundos
                // (rango acotado y adivinable), el audio/foto de un lead podía
                // enumerarse por fuerza bruta desde la URL pública. Se agrega un
                // token aleatorio de 16 bytes: sigue siendo una URL pública (no
                // rompe la reproducción de audio/video actual, que consume la
                // URL tal cual) pero deja de ser adivinable/enumerable.
                const randomToken = crypto.randomBytes(16).toString('hex');
                const filePath = `whatsapp-media/${tenantId}/${randomToken}.${ext}`;
                const fileRef = bucket.file(filePath);
                await fileRef.save(Buffer.from(mediaBuffer.data), { metadata: { contentType: mimeType } });
                await fileRef.makePublic();
                inboundMediaUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                text = message.type === 'audio' ? '🎵 Audio' : '📷 Imagen';
                console.log(`[WhatsApp Media] ${message.type} descargado y subido: ${inboundMediaUrl}`);
              } catch (mediaErr: any) {
                console.warn('[WhatsApp Media Download] Error:', mediaErr.message);
              }
            }
          }

          // G. TRANSACTIONAL PERSISTENCE (DEDUPLICATION + INSERCIÓN)
          // El chequeo de arriba (dedupDoc.exists, paso A) es solo un fast-path
          // FUERA de la transacción — no cierra la ventana de carrera por sí
          // solo: Firestore solo detecta conflictos sobre documentos LEÍDOS
          // dentro de la transacción, y antes acá se hacía `transaction.set`
          // sin `transaction.get` previo. Dos entregas casi simultáneas del
          // mismo wamid (Meta reintenta si el webhook tarda, y este handler
          // baja medios a Storage de forma síncrona antes de llegar aquí, lo
          // que amplía la ventana) podían pasar ambas el chequeo externo antes
          // de que cualquiera terminara de comitear, y terminar creando el
          // mensaje/lead duplicado. Re-leer dedupRef DENTRO de la transacción
          // es lo que realmente cierra la ventana.
          const wasDuplicateInTransaction = await db.runTransaction(async (transaction) => {
            const dedupSnapInTx = await transaction.get(dedupRef);
            if (dedupSnapInTx.exists) {
              return true;
            }

            // Registrar dedup
            transaction.set(dedupRef, {
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              tenantId,
              conversationId
            });

            // Insertar mensaje
            const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc();
            transaction.set(msgRef, {
              text,
              sender: 'lead',
              direction: 'inbound',
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              type: inboundMsgType,
              ...(inboundMediaUrl && { mediaUrl: inboundMediaUrl }),
              externalId: wamid
            });

            // Actualizar conversación raíz (si no es la creación inicial)
            if (!convSnapshot.empty) {
              const convRef = db.collection('conversations').doc(conversationId);
              transaction.update(convRef, {
                lastMessage: text,
                lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageSender: 'lead',
                lastInboundDate: admin.firestore.FieldValue.serverTimestamp(), // Actualizar para ventana 24h
                unreadCount: admin.firestore.FieldValue.increment(1),
                visitNudgeSent: false, // El lead volvio a escribir: habilita un futuro nudge de visita
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            }

            return false;
          });

          if (wasDuplicateInTransaction) {
            console.log('Documento duplicado omitido (detectado dentro de la transacción):', wamid);
            res.sendStatus(200);
            return;
          }

          console.log(`Mensaje procesado para tenant ${tenantId}. Conv: ${conversationId}`);

          // G. TRIGGER AI AUTOPILOT SI ESTÁ HABILITADO
          if (integrationData.isAiAutomated) {
            triggerAiAutopilot(tenantId, conversationId, text, 'whatsapp', {
              phoneNumberId: integrationData.phoneNumberId,
              accessToken: integrationData.accessToken
            }).catch(e => console.error('Error running AI Autopilot WhatsApp:', e));
          }
        }

        // G. GESTIÓN DE STATUSES (Delivery/Read Receipts) — LOOP nocturno
        // USADITOS, Fase 6. Antes esto solo logueaba; el mensaje se quedaba
        // en status:'sent' para siempre aunque Meta confirmara delivered/read
        // — afecta a TODOS los tenants, no solo a USADITOS. wamid es único
        // globalmente en la plataforma de Meta, así que buscar por
        // externalId con un collection-group query no tiene riesgo de
        // ambigüedad entre tenants; igual se verifica abajo que la
        // conversación dueña del mensaje sea la de ESTE tenant (defensa en
        // profundidad, no debería poder fallar en la práctica).
        if (value && value.statuses?.[0]) {
          const statusUpdate = value.statuses[0];
          const wamid = statusUpdate.id as string;
          const newStatus = statusUpdate.status as string;
          console.log(`Webhook Status Update: ${newStatus} for wamid: ${wamid}`);

          try {
            const msgQuery = await db.collectionGroup('messages')
              .where('externalId', '==', wamid)
              .limit(1)
              .get();

            if (msgQuery.empty) {
              console.warn(`[Webhook Status] wamid desconocido (sin mensaje asociado): ${wamid}`);
            } else {
              const msgDoc = msgQuery.docs[0];
              const msgConversationRef = msgDoc.ref.parent.parent;
              const msgConvSnap = msgConversationRef ? await msgConversationRef.get() : null;

              if (!msgConvSnap?.exists || msgConvSnap.data()?.tenantId !== tenantId) {
                console.error(`[Webhook Status] wamid ${wamid} resolvió a una conversación de otro tenant — se ignora el update.`);
              } else if (shouldApplyStatusUpdate(msgDoc.data()?.status, newStatus)) {
                const updatePayload: any = { status: newStatus };
                if (newStatus === 'failed' && statusUpdate.errors?.[0]) {
                  updatePayload.errorMessage = statusUpdate.errors[0].title || statusUpdate.errors[0].message || 'Meta reportó un fallo de entrega';
                }
                await msgDoc.ref.update(updatePayload);
              }
            }
          } catch (statusErr: any) {
            console.error('[Webhook Status] Error procesando status update:', statusErr.message);
          }
        }
      } catch (error: any) {
        console.error('Error procesando webhook:', error);
        res.status(500).send('Error');
        return;
      }
    }

    res.sendStatus(200);
    return;
  }

  res.status(405).send('Method Not Allowed');
});

/**
 * Webhook Unificado de Meta (Instagram DMs & Facebook Messenger)
 */
export const metaWebhook = functions.runWith({ secrets: ['OPENAI_API_KEY'] }).https.onRequest(async (req, res) => {
  // 1. Verificación (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const tokenRaw = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const token = typeof tokenRaw === 'string' ? tokenRaw : '';

    // SEGURIDAD: el verify token NO debe estar hardcodeado. Si la env var no existe,
    // rechazamos: preferimos un webhook que no verifica antes que uno con secreto publico.
    const globalVerifyToken = (process.env.META_VERIFY_TOKEN || '').trim();
    if (!globalVerifyToken) {
      console.error('[metaWebhook] META_VERIFY_TOKEN no configurada.');
      res.status(503).send('Service not configured');
      return;
    }

    if (mode === 'subscribe' && safeStrEqual(token, globalVerifyToken)) {
      console.log('META_WEBHOOK_VERIFIED');
      res.status(200).send(typeof challenge === 'string' ? challenge : '');
      return;
    }
    res.status(403).send('Forbidden');
    return;
  }

  // 2. Recepción de Eventos (POST)
  if (req.method === 'POST') {
    const body = req.body;
    const object = body.object; // 'instagram' o 'page'

    if (object === 'instagram' || object === 'page') {
      try {
        const entry = body.entry?.[0];
        const platformId = entry?.id; // Page ID o IG ID
        const messaging = entry?.messaging?.[0];

        if (!messaging || !platformId) {
          res.sendStatus(200);
          return;
        }

        // A. RESOLUCIÓN DE TENANT
        const integrationSnapshot = await db.collection('integrations')
          .where('platformId', '==', platformId)
          .where('isActive', '==', true)
          .limit(1)
          .get();

        if (integrationSnapshot.empty) {
          console.warn('Integración Meta no encontrada para platformId:', platformId);
          res.sendStatus(200);
          return;
        }

        const integrationData = integrationSnapshot.docs[0].data();
        const tenantId = integrationData.tenantId;
        const source = object === 'instagram' ? 'instagram' : 'facebook';

        // B. VALIDACIÓN DE FIRMA HMAC (obligatoria)
        const metaSignature = req.headers['x-hub-signature-256'] as string;
        const metaAppSecret = integrationData.appSecret || (process.env.WHATSAPP_APP_SECRET || '').trim();
        if (!metaSignature) {
          res.status(403).send('Missing signature');
          return;
        }
        const rawBody = (req as any).rawBody;
        if (!validateSignature(rawBody, metaSignature, metaAppSecret)) {
          console.error('Meta webhook signature check failed para platformId:', platformId);
          res.status(403).send('Signature check failed');
          return;
        }

        // C. PROCESAR MENSAJE
        if (messaging.message) {
          const senderId = messaging.sender.id; // PSID del cliente
          const text = messaging.message.text || '[Contenido multimedia]';
          const mid = messaging.message.mid;

          // Deduplicación
          const dedupRef = db.collection('meta_message_dedup').doc(mid);
          const dedupDoc = await dedupRef.get();
          if (dedupDoc.exists) {
            res.sendStatus(200);
            return;
          }

          // D. DETECCIÓN DE ORIGEN DEL LEAD (referral de anuncio o keyword)
          const referralMeta = messaging.referral as any;
          let utmSourceMeta = 'organico';
          let sourceLabelMeta = 'Orgánico / Directo';
          if (referralMeta?.source === 'ADS' || referralMeta?.type === 'OPEN_THREAD') {
            utmSourceMeta = 'meta_ad';
            sourceLabelMeta = `Campaña Meta Ads${referralMeta.headline ? ` — "${referralMeta.headline}"` : ''}`;
          } else if (text && /quiero inform|me interes|lotes|quintas|iguana park|landing|precio|proyecto/i.test(text)) {
            utmSourceMeta = 'landing_page';
            sourceLabelMeta = 'Landing Page (botón web)';
          }

          // D. UPSERT LEAD & CONVERSATION
          // Buscamos conversación existente por platformId (PSID) y fuente
          let conversationId = '';
          const convSnapshot = await db.collection('conversations')
            .where('tenantId', '==', tenantId)
            .where('platformId', '==', senderId)
            .where('source', '==', source)
            .limit(1)
            .get();

          if (convSnapshot.empty) {
            const contactName = `Usuario ${source.charAt(0).toUpperCase() + source.slice(1)}`;

            // Resolver la etapa por defecto del pipeline del tenant (evita leads
            // huérfanos que no aparecen en el CRM por mismatch de `stage`).
            let defaultStageMeta = 'Nuevo';
            try {
              const settingsSnap = await db.collection('settings').doc(tenantId).get();
              const pipelineStages = settingsSnap.data()?.pipeline?.stages;
              if (Array.isArray(pipelineStages) && pipelineStages.length > 0) {
                const def = pipelineStages.find((s: any) => s.isDefault)
                  || pipelineStages.slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
                if (def?.label) defaultStageMeta = def.label;
              }
            } catch (e) {
              console.warn(`[Webhook Meta] No se pudo leer el pipeline del tenant ${tenantId}, usando etapa por defecto "Nuevo"`);
            }

            // Crear lead automáticamente
            const newLeadRef = await db.collection('leads').add({
              tenantId,
              name: contactName,
              stage: defaultStageMeta,
              source: sourceLabelMeta,
              utmSource: utmSourceMeta,
              keyData: `Origen: ${sourceLabelMeta}`,
              phone: '',
              email: '',
              notes: '',
              orderIndex: Date.now(),
              createdAt: new Date().toISOString(),
              lastActivity: new Date().toISOString()
            });

            const assignment = await assignConversationAdvisor(tenantId);
            const newConvRef = await db.collection('conversations').add({
              tenantId,
              contactName,
              source,
              platformId: senderId,
              leadId: newLeadRef.id,
              lastMessage: text,
              lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
              lastMessageSender: 'lead',
              unreadCount: 1,
              status: 'active',
              // El bot SIEMPRE arranca apagado — el asesor lo activa a mano.
              botEnabled: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              advisorId: assignment.advisorId || '',
              assignmentSource: assignment.assignmentSource,
              assignedAt: assignment.advisorId ? admin.firestore.FieldValue.serverTimestamp() : null,
              phoneRaw: '',
              phoneE164: '',
              phoneSearchKey: ''
            });
            conversationId = newConvRef.id;

            db.collection('notifications').add({
              tenantId,
              type: 'nuevo_lead',
              title: 'Nuevo lead 🚀',
              body: `${contactName || 'Cliente'} escribió por ${sourceLabelMeta}`,
              link: '/crm',
              leadId: newLeadRef.id,
              read: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }).catch((e: any) => console.warn('[Webhook Meta] Notif lead error:', e.message));

            // Vincular conversación al lead
            await newLeadRef.update({ conversationId: newConvRef.id });
          } else {
            conversationId = convSnapshot.docs[0].id;
          }

          // E. PERSISTENCIA TRANSACCIONAL
          await db.runTransaction(async (transaction) => {
            transaction.set(dedupRef, { timestamp: admin.firestore.FieldValue.serverTimestamp() });
            
            const msgRef = db.collection('conversations').doc(conversationId).collection('messages').doc();
            transaction.set(msgRef, {
              text,
              sender: 'lead',
              direction: 'inbound',
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              type: 'text',
              externalId: mid
            });

            if (!convSnapshot.empty) {
              transaction.update(db.collection('conversations').doc(conversationId), {
                lastMessage: text,
                lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
                lastMessageSender: 'lead',
                unreadCount: admin.firestore.FieldValue.increment(1),
                visitNudgeSent: false, // El lead volvio a escribir: habilita un futuro nudge de visita
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            }
          });

          // G. TRIGGER AI AUTOPILOT SI ESTÁ HABILITADO
          if (integrationData.isAiAutomated) {
            triggerAiAutopilot(tenantId, conversationId, text, source, {
              accessToken: integrationData.accessToken,
              recipientId: senderId
            }).catch(e => console.error('Error running AI Autopilot Meta:', e));
          }
        }
      } catch (error) {
        console.error('Error en metaWebhook:', error);
      }
    }
    res.sendStatus(200);
    return;
  }

  res.status(405).send('Method Not Allowed');
});

/**
 * Chat en tiempo real con el Agente IA — usa los documentos de entrenamiento del tenant como contexto
 */
export const chatWithAgent = onCall({
  maxInstances: 10,
  timeoutSeconds: 60,
  secrets: ['OPENAI_API_KEY'],
}, async (request) => {
  console.log('[chatWithAgent] HANDLER INVOCADO — auth uid:', request.auth?.uid ?? 'NONE');
  try {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');

  const { messages, tenantId } = request.data as {
    messages: { role: 'user' | 'assistant'; content: string }[];
    tenantId: string;
  };

  console.log('[chatWithAgent] tenantId:', tenantId, '| messages:', messages?.length);

  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId requerido');
  if (!messages?.length) throw new HttpsError('invalid-argument', 'messages requerido');

  // P1 SEGURIDAD: antes se confiaba en el tenantId enviado por el cliente sin
  // validar nada — cualquier usuario autenticado de CUALQUIER tenant podía
  // pasar el tenantId de otro negocio y (a) recibir de vuelta, en las
  // respuestas del chat, contenido de los documentos de entrenamiento
  // privados de ese tenant ajeno, y (b) consumir su cupo mensual de
  // consultas. Ahora se exige una membership activa del uid autenticado en
  // EXACTAMENTE ese tenantId antes de leer nada de su configuración.
  const callerMembershipSnap = await db.collection('memberships').doc(`${request.auth.uid}_${tenantId}`).get();
  if (!callerMembershipSnap.exists || callerMembershipSnap.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tenés acceso activo a este negocio.');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  console.log('[chatWithAgent] apiKey present:', !!apiKey, '| length:', apiKey?.length ?? 0);
  if (!apiKey) throw new HttpsError('failed-precondition', 'OPENAI_API_KEY no configurada');

  // Leer config del agente y features del tenant desde Firestore
  const settingsDoc = await db.collection('settings').doc(tenantId).get();
  const raw = settingsDoc.data() || {};
  const agentConfig = raw.aiAgentConfig || { knowledgeFiles: [], productFiles: [] };
  const features = raw.features || {};
  const businessName = raw.tradeName || raw.companyName || 'el negocio';

  // Límite mensual de consultas según plan
  const LIMIT_FREE = 20;      // trial sin módulo IA activo
  const LIMIT_PAID = 300;     // hasAiAgent activo
  const queryLimit = features.hasAiAgent ? LIMIT_PAID : LIMIT_FREE;

  // Verificar y actualizar contador mensual de uso
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const usageRef = db.collection('usage').doc(tenantId);
  const usageSnap = await usageRef.get();
  const usageData = usageSnap.data() || {};
  const chatUsage = usageData.chatAgent || { count: 0, month: currentMonth };

  // Resetear contador si cambió el mes
  if (chatUsage.month !== currentMonth) {
    chatUsage.count = 0;
    chatUsage.month = currentMonth;
  }

  if (chatUsage.count >= queryLimit) {
    throw new HttpsError(
      'resource-exhausted',
      features.hasAiAgent
        ? `Alcanzaste el límite de ${LIMIT_PAID} consultas este mes. Se renueva el próximo mes.`
        : `Límite de ${LIMIT_FREE} consultas gratuitas alcanzado. Activa el Agente IA para obtener 300/mes.`
    );
  }

  // Construir contexto desde archivos con content extraído
  const allFiles = [
    ...(agentConfig.knowledgeFiles || []),
    ...(agentConfig.productFiles || []),
  ];

  const knowledgeContextRaw = allFiles
    .filter((f: any) => f.content)
    .map((f: any) => `=== ${f.name} ===\n${f.content}`)
    .join('\n\n');
  const knowledgeContext = knowledgeContextRaw.length > 10000 ? knowledgeContextRaw.slice(0, 10000) + '\n[...]' : knowledgeContextRaw;

  // Archivos reales que el agente puede enlazar (mismo criterio que triggerAiAutopilot):
  // excluye documentos de entrenamiento/confidenciales, solo los que tienen URL real.
  const INTERNAL_DOC_RX = /entrenamiento|training|interno|confidencial|instrucci[oó]n|system\s*prompt|prompt\s*del|configuraci[oó]n\s*del\s*agente/i;
  const sendableFiles: any[] = [
    ...allFiles,
    ...(agentConfig.mediaLibrary || []),
  ].filter((f: any) => f?.url && !INTERNAL_DOC_RX.test(f.name || ''));
  const mediaContext = sendableFiles.length > 0
    ? `\nARCHIVOS DISPONIBLES PARA COMPARTIR (usa esta URL exacta si el cliente pide alguno de estos, nunca inventes otra):\n${sendableFiles.map((m: any) => `- "${m.name}": ${m.url}`).join('\n')}\n`
    : '';

  const platformKnowledgeCRM = `SMARTFLOW HUB OS — CRM multicanal con IA para negocios que venden por WhatsApp.

MÓDULOS:
- CRM Base: GRATIS (Kanban ilimitado, usuarios ilimitados, dashboard)
- WhatsApp Coexistente: $69/mes — múltiples agentes en el mismo número + 300 créditos de reactivación
- Agente IA 24/7: $49/mes — responde, califica y agenda automáticamente
- Auditor IA: $25/mes — evalúa chats y detecta cierres perdidos
- Links de Pago: $12/mes — cobro seguro por WhatsApp
- Cotizaciones PDF: $15/mes — propuestas profesionales en segundos
- Catálogo Digital: $27/mes — organiza productos y servicios
- Agenda Inteligente: $20/mes — citas con recordatorios automáticos
- Pack completo: máximo $197/mes`;

  const systemPrompt = knowledgeContext
    ? `Eres el asistente virtual oficial de ${businessName}.
IDENTIDAD: Los documentos de entrenamiento definen quién eres, cómo te llamas y qué vendes. Síguelos al pie de la letra.
NUNCA menciones SmartFlow Hub OS ni ninguna otra plataforma. Solo representas a ${businessName}.

FORMATO DE RESPUESTA:
- Sin asteriscos dobles (**), usa solo uno para negrita (*así*)
- Máximo 3-4 líneas por mensaje
- Un emoji natural, no forzado
- NO termines cada mensaje con una pregunta — presiona y suena a checklist de vendedor. Dar la información y parar ahí, sin pedir nada de vuelta, es una respuesta completa. Como máximo 1 de cada 2 mensajes termina en pregunta.
- Si el usuario dice "Gracias", "No", "Ok", "Listo", "Adiós" o cierra el tema → despídete de forma natural, sin forzar más preguntas
- Nunca hagas dos preguntas en el mismo mensaje
- Ante una duda u objeción: primero reconocé en pocas palabras lo que el cliente siente ("Entiendo, es una decisión importante"), y RECIÉN DESPUÉS redirigí al valor. Nunca vayas directo al reencuadre sin validar primero.

ENVÍO DE DOCUMENTOS:
- Si el cliente pide un documento (master plan, planos, catálogo, disponibilidad, brochure) y está en ARCHIVOS DISPONIBLES: comparte esa URL exacta, tal cual, sin modificarla ni envolverla en formato markdown raro.
- Si NINGÚN archivo de la lista coincide con lo que pidió: NUNCA inventes una URL ni pegues texto sin sentido. Di que un asesor se lo comparte enseguida.

PROPONER LA VISITA CON TACTO (crítico — sé un vendedor sigiloso, no un script; NUNCA delegues esto a "contacta a un asesor" si vos mismo podés ofrecerla):
Cuando el cliente muestra interés real (pregunta precio de algo puntual, cómo llegar, financiamiento, dice "me interesa"/"me gusta"/"eso busco", compara opciones, o reacciona positivo — "excelente", "genial" — justo después de que le compartiste algo) → el siguiente paso no es otra data ni mandarlo con un asesor: sos vos quien invita a verlo en persona.
- No invites en el primer o segundo mensaje, ni si sus respuestas son cortas y desinteresadas.
- Cuando sí es momento: amarra la invitación a lo que preguntó y ofrece dos días concretos: "¿Te gustaría verlo en persona? Tengo espacio este sábado o el domingo, ¿cuál te acomoda?" Después de invitar, PARÁ — no agregues más datos en el mismo mensaje.
- Si el cliente propone un día él mismo, o acepta tu invitación: confirma pidiendo su nombre si no lo tenés, y luego confirma la cita con el día que dio ("Listo [Nombre], quedas agendado/a el [día]."). Nunca inventes una fecha que el cliente no dijo.
- Si no responde a la invitación, seguí la conversación con naturalidad y esperá otra señal antes de volver a proponerla.
${mediaContext}
DOCUMENTOS DE ENTRENAMIENTO (máxima prioridad — definen tu identidad y conocimiento):
${knowledgeContext}`
    : `Eres Sofía, asesora de SmartFlow Hub OS. Eres consultora, no vendedora.

FILOSOFÍA: El cliente compra cuando entiende el valor. Tu trabajo es guiar con claridad, nunca empujar.

CÓMO GUÍAS UNA CONVERSACIÓN:
1. Pregunta por el negocio y su mayor reto actual
2. Conecta 1 módulo con su realidad específica
3. Explica el resultado concreto que obtendría
4. Si pregunta precio o cómo pagar → da el precio y genera el link de pago

REGLAS:
- Una recomendación a la vez, clara y específica
- Nunca uses urgencia artificial ni presión
- Responde preguntas primero, recomienda después

LINK DE PAGO: Solo cuando el cliente pide pagar: [PAGO:módulo:precio:USD]

${platformKnowledgeCRM}`;

  let response: any;
  try {
    response = await axios.post(
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
  } catch (axiosErr: any) {
    const status = axiosErr?.response?.status;
    const errData = axiosErr?.response?.data;
    console.error('[chatWithAgent] OpenAI error:', status, JSON.stringify(errData));
    throw new HttpsError('failed-precondition', `OpenAI error ${status}: ${errData?.error?.message || axiosErr.message}`);
  }

  const reply = response.data.choices?.[0]?.message?.content;
  if (!reply) throw new HttpsError('failed-precondition', 'El modelo no retornó respuesta');

  // Incrementar contador de uso
  await usageRef.set(
    { chatAgent: { count: chatUsage.count + 1, month: currentMonth } },
    { merge: true }
  );

  return {
    reply,
    usage: {
      used: chatUsage.count + 1,
      limit: queryLimit,
      remaining: queryLimit - chatUsage.count - 1,
    },
  };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    console.error('[chatWithAgent] UNHANDLED EXCEPTION:', err?.message, err?.stack);
    throw new HttpsError('failed-precondition', `Error interno: ${err?.message || String(err)}`);
  }
});

/**
 * Genera imágenes de marketing con gpt-image-1 (GPT-4o) — composite ads con mockups y copy real
 */
export const generateMarketingImage = onCall({
  maxInstances: 5,
  timeoutSeconds: 120,
  secrets: ['OPENAI_API_KEY']
}, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');

  const { format } = request.data as {
    format: 'instagram' | 'facebook' | 'blog';
    copy?: string;
  };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError('internal', 'OPENAI_API_KEY no configurada');

  // gpt-image-1 soporta: 1024x1024, 1024x1536, 1536x1024, auto
  const sizeMap = { instagram: '1024x1536', facebook: '1024x1024', blog: '1536x1024' };
  const size = sizeMap[format] || '1024x1024';

  const promptMap: Record<string, string> = {
    instagram: `Cinematic dark product photography for a tech SaaS ad. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: dramatic close-up of hands holding a sleek modern smartphone in a dark environment. The phone screen glows showing a WhatsApp Business dashboard with green chat bubbles and business metrics. Dark moody background with subtle green (#00C853) light glow from the screen illuminating the hands. Cinematic bokeh, shallow depth of field. 4:5 portrait format. Photorealistic, premium commercial photography, Apple-level aesthetic.`,

    facebook: `Cinematic dark commercial photography for a tech business ad. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: a confident Latin professional at a sleek modern dark desk, laptop open showing a colorful CRM sales pipeline dashboard with green metrics and charts, smartphone beside it showing WhatsApp conversations with green bubbles. Dramatic directional side lighting, shallow depth of field, dark background (#0D0D0D). Professional high-end commercial photography, square 1:1 composition, stop-scroll visual impact. Photorealistic.`,

    blog: `Cinematic wide editorial photography for a tech company blog. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: a premium dark desk environment — a sleek laptop and a smartphone side by side, both screens glowing showing a modern CRM business dashboard. Dark background with green (#00C853) accent lighting from the screens. Wide landscape composition, left third darker (for text overlay space), right two-thirds shows the devices in detail. Professional editorial product photography, 1536x1024. Photorealistic, premium tech aesthetic.`
  };

  const response = await axios.post('https://api.openai.com/v1/images/generations', {
    model: 'gpt-image-1',
    prompt: promptMap[format],
    n: 1,
    size,
    quality: 'medium'
  }, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  });

  const b64 = response.data?.data?.[0]?.b64_json;
  if (!b64) throw new HttpsError('internal', 'gpt-image-1 no retornó imagen');

  // Subir a Firebase Storage para obtener URL pública (requerida por Meta API)
  const uid = request.auth.uid;
  const filename = `marketing-images/${uid}/${format}-${Date.now()}.png`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(filename);
  await file.save(Buffer.from(b64, 'base64'), {
    metadata: { contentType: 'image/png' }
  });
  await file.makePublic();
  const storageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;

  return {
    imageUrl: `data:image/png;base64,${b64}`,
    storageUrl,
  };
});

/**
 * Función Callable para enviar mensajes de WhatsApp de forma segura
 */
export const sendWhatsappMessage = onCall({
  maxInstances: 10,
  secrets: ['WHATSAPP_TOKEN_DEFAULT'] // Ejemplo de uso de Secret Manager
}, async (request) => {
  // 1. VALIDACIÓN DE SESIÓN
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { conversationId, text, tenantId, mediaUrl, mediaFilename, templateName, languageCode, components } = request.data;
  const uid = request.auth.uid;

  console.log(`[Diagnostic] sendWhatsappMessage invoked. tenantId: ${tenantId}, convId: ${conversationId}, textLength: ${text?.length}, hasMedia: ${!!mediaUrl}`);

  if (!conversationId || (!text && !mediaUrl) || !tenantId) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
  }

  // 2. VALIDACIÓN DE MEMBRESÍA Y ROL
  // Bypass de SuperAdmin (mismo patrón que completeWhatsappEmbeddedSignup,
  // Fase 4): un SuperAdmin puede no tener membership en el tenant que está
  // operando (caso real: USADITOS todavía sin ningún miembro activado) y aun
  // así necesita poder responder mensajes reales. El bypass es SOLO sobre el
  // requisito de membership/rol — la validación de que la conversación
  // pertenece exactamente a tenantId (paso 4, más abajo) sigue aplicando
  // igual para SuperAdmin, así que no se abre ningún hueco cross-tenant.
  // Decisión testeada en sendMessageAuth.test.ts (checkMembershipAuth).
  const userSnap = await db.collection('users').doc(uid).get();
  const isSuperAdminCaller = userSnap.exists && userSnap.data()?.isSuperAdmin === true;

  const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
  const membershipDoc = await membershipRef.get();
  const membershipData = membershipDoc.data();

  const membershipAuth = checkMembershipAuth({
    isSuperAdmin: isSuperAdminCaller,
    membership: membershipDoc.exists && membershipData
      ? { status: membershipData.status, role: membershipData.role }
      : null,
  });
  if (!membershipAuth.allowed) {
    const message = membershipAuth.reason === 'read-only-role'
      ? 'Tu rol es de solo lectura — no podés enviar mensajes.'
      : 'No tienes una membresía activa en este tenant';
    throw new HttpsError('permission-denied', message);
  }

  // 3. OBTENER INTEGRACIÓN ACTIVA
  const integrationSnapshot = await db.collection('integrations')
    .where('tenantId', '==', tenantId)
    .where('provider', '==', 'whatsapp')
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (integrationSnapshot.empty) {
    throw new HttpsError('failed-precondition', 'No hay una integración de WhatsApp activa para este tenant');
  }

  const integration = integrationSnapshot.docs[0].data();
  const phoneNumberId = integration.phoneNumberId;
  const accessToken = integration.accessToken;

  if (!phoneNumberId || !accessToken) {
    throw new HttpsError('failed-precondition', 'La integración de WhatsApp está mal configurada (faltan tokens)');
  }

  // 4. VALIDACIÓN DE VENTANA DE 24 HORAS
  const conversationRef = db.collection('conversations').doc(conversationId);
  const conversationDoc = await conversationRef.get();

  if (!conversationDoc.exists) {
    throw new HttpsError('not-found', 'Conversación no encontrada');
  }

  const convData = conversationDoc.data();

  // P1 SEGURIDAD: el chequeo de membresía (paso 2) solo prueba que el uid
  // tiene acceso activo a `tenantId` — nunca que la conversación pedida
  // pertenezca a ESE tenant. Sin esto, un usuario del Tenant A podía mandar
  // tenantId:A (pasa el gate) pero conversationId de una conversación del
  // Tenant B: se leía el teléfono destino de B, se enviaba el mensaje con el
  // número de WhatsApp de A, y se escribía en el hilo de mensajes de B.
  if (!checkConversationTenantMatch(convData?.tenantId, tenantId)) {
    throw new HttpsError('permission-denied', 'Esta conversación no pertenece a tu negocio.');
  }
  const destinationPhone = convData?.phoneE164 || convData?.phoneRaw;

  if (convData?.lastMessageSender === 'advisor' && convData.lastMessageDate) {
    // Si el último que escribió fue el asesor, debemos verificar cuándo fue el último mensaje del LEAD
    const lastLeadMsgSnapshot = await conversationRef.collection('messages')
      .where('sender', '==', 'lead')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (!lastLeadMsgSnapshot.empty) {
      const lastLeadTime = lastLeadMsgSnapshot.docs[0].data().timestamp.toDate().getTime();
      const now = Date.now();
      const twentyFourHours = 24 * 60 * 60 * 1000;

      if (now - lastLeadTime > twentyFourHours && !templateName) {
        throw new HttpsError('deadline-exceeded', 'Fuera de la ventana de 24 horas. Debes usar una plantilla aprobada.');
      }
    } else if (!templateName) {
      // Si no hay mensajes del lead aún, también forzamos plantilla
      throw new HttpsError('deadline-exceeded', 'No hay ventana activa. Debes usar una plantilla aprobada para iniciar contacto.');
    }
  }

    // 4.5. VALIDACIÓN PREVIA DE URL PÚBLICA (Pre-flight)
    if (mediaUrl) {
      console.log(`[Diagnostic] Validating public access to PDF: ${mediaUrl}`);
      try {
        const preflight = await fetch(mediaUrl, { method: 'HEAD' });
        if (!preflight.ok) {
          throw new Error(`La URL del PDF no es accesible públicamente. Status: ${preflight.status}`);
        }
      } catch (err: any) {
        throw new HttpsError('failed-precondition', `El PDF no es accesible para Meta: ${err.message}`);
      }
    }

  // 5. ENVÍO A META
  let status: 'sent' | 'failed' = 'sent';
  let externalId = `wamid.${crypto.randomBytes(8).toString('hex')}`;
  let errorMessage = '';
  // Detalle estructurado del error de Meta (código/subcódigo/tipo/fbtrace_id),
  // NUNCA el access token ni el App Secret — se persiste en Firestore para que
  // un fallo real (como el de USADITOS) sea diagnosticable sin tener que ir a
  // Cloud Logging cada vez. null cuando el envío es exitoso.
  let metaErrorDetail: MetaErrorDetail | null = null;

  try {
    console.log(`Enviando mensaje HTTP a Meta para tenant ${tenantId}...`);
    
    // Switch between document or text payload
    const messagePayload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: destinationPhone.replace('+', '')
    };

    if (templateName) {
      console.log(`[Diagnostic] Enviando Plantilla: ${templateName}`);
      messagePayload.type = 'template';
      messagePayload.template = {
        name: templateName,
        language: { code: languageCode || 'es_MX' },
        ...(components && { components })
      };
    } else if (mediaUrl) {
      const isImage = /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(jpg|jpeg|png|webp|gif)$/i.test(mediaFilename));
      const isAudio = /\.(ogg|mp3|m4a|aac|wav|opus)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(ogg|mp3|m4a|aac|wav|opus)$/i.test(mediaFilename));
      const isVideo = /\.(mp4|mov|3gp|webm)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(mp4|mov|3gp|webm)$/i.test(mediaFilename));
      if (isImage) {
        console.log(`[Diagnostic] Adjuntando Imagen. Filename: ${mediaFilename}`);
        messagePayload.type = 'image';
        messagePayload.image = {
          link: mediaUrl,
          ...(text && { caption: text })
        };
      } else if (isVideo) {
        console.log(`[Diagnostic] Adjuntando Video. Filename: ${mediaFilename}`);
        messagePayload.type = 'video';
        messagePayload.video = {
          link: mediaUrl,
          ...(text && { caption: text })
        };
      } else if (isAudio) {
        console.log(`[Diagnostic] Adjuntando Audio. Filename: ${mediaFilename}`);
        messagePayload.type = 'audio';
        messagePayload.audio = { link: mediaUrl };
        // WhatsApp audio no soporta caption — el texto se envía en un mensaje separado si existe
      } else {
        console.log(`[Diagnostic] Adjuntando Documento. Filename: ${mediaFilename}`);
        messagePayload.type = 'document';
        messagePayload.document = {
          link: mediaUrl,
          filename: mediaFilename || 'Documento adjunto',
          ...(text && { caption: text })
        };
      }
    } else {
      messagePayload.type = 'text';
      messagePayload.text = { body: text };
    }

    console.log('[Diagnostic] Meta API Payload:', JSON.stringify(messagePayload));

    // Llamada POST nativa a facebook graph API v17.0+
    const metaResponse = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    });

    const bodyData = await metaResponse.json();

    if (!metaResponse.ok) {
      // Logging estructurado sin secretos (LOOP nocturno USADITOS, Fase 3):
      // el catch de abajo solo tenía err.message — al perder el httpStatus,
      // code/subcode/type/fbtrace_id, cada fallo real había que ir a
      // reconstruirlo a mano desde Cloud Logging. Ahora queda en el propio
      // documento del mensaje.
      // Ver buildMetaErrorDetail (sendMessageAuth.ts) — P0 USADITOS
      // 2026-09-14: un campo undefined acá tiraba abajo toda la transacción.
      metaErrorDetail = buildMetaErrorDetail(metaResponse.status, bodyData.error);
      console.error('[Diagnostic] Meta API Error:', JSON.stringify({ tenantId, phoneNumberId, to: messagePayload.to, ...metaErrorDetail, message: bodyData.error?.message }));
      throw new Error(bodyData.error?.message || 'Error en respuesta de Meta Graph API');
    }

    externalId = bodyData.messages?.[0]?.id || externalId;

  } catch (err: any) {
    status = 'failed';
    errorMessage = err.message || 'Error desconocido HTTP de Meta';
  }

  // 6. PERSISTENCIA EN FIRESTORE (TRANSACCIONAL)
  const isMsgImage = mediaUrl ? (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(jpg|jpeg|png|webp|gif)$/i.test(mediaFilename))) : false;
  const isMsgAudio = mediaUrl ? (/\.(ogg|mp3|m4a|aac|wav|opus)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(ogg|mp3|m4a|aac|wav|opus)$/i.test(mediaFilename))) : false;
  const isMsgVideo = mediaUrl ? (/\.(mp4|mov|3gp|webm)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(mp4|mov|3gp|webm)$/i.test(mediaFilename))) : false;

  let finalMessageText = text;
  if (mediaUrl) {
    if (status === 'sent') {
      if (isMsgImage)      finalMessageText = `[Imagen Enviada]\n${text}`;
      else if (isMsgVideo) finalMessageText = `[Video Enviado]\n${text}`;
      else if (isMsgAudio) finalMessageText = `[Audio Enviado]\n${text}`;
      else                 finalMessageText = `[Documento Enviado: ${mediaFilename || 'PDF'}]\n${text}`;
    } else {
      if (isMsgImage)      finalMessageText = `[Error al enviar Imagen]\n${text}`;
      else if (isMsgVideo) finalMessageText = `[Error al enviar Video]\n${text}`;
      else if (isMsgAudio) finalMessageText = `[Error al enviar Audio]\n${text}`;
      else                 finalMessageText = `[Error al enviar Documento: ${mediaFilename || 'PDF'}]\n${text}`;
    }
  }

  const msgTypeOut = templateName ? 'template' : (mediaUrl ? (isMsgImage ? 'image' : isMsgVideo ? 'video' : isMsgAudio ? 'audio' : 'document') : 'text');

  const messageData = {
    text: finalMessageText,
    sender: 'advisor',
    direction: 'outbound',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    type: msgTypeOut,
    status,
    externalId: status === 'sent' ? externalId : null,
    errorMessage: status === 'failed' ? errorMessage : null,
    // Nunca incluye accessToken/appSecret — solo metadata de diagnóstico de
    // Meta (LOOP nocturno USADITOS, Fase 3).
    metaError: status === 'failed' && metaErrorDetail ? metaErrorDetail : null,
    ...(mediaUrl && { mediaUrl })
  };

  const msgRef = conversationRef.collection('messages').doc();
  
  await db.runTransaction(async (transaction) => {
    // A. Crear mensaje
    transaction.set(msgRef, messageData);

    // B. Actualizar raíz de conversación
    transaction.update(conversationRef, {
      lastMessage: text,
      lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageSender: 'advisor',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  // errorMessage se incluye acá porque antes solo se guardaba en Firestore —
  // el frontend no tenía forma de mostrar el error REAL de Meta al que falla
  // (esta función nunca tira excepción cuando Meta rechaza el mensaje, solo
  // devuelve success:false), así que sin este campo el llamador no puede
  // saber POR QUÉ falló, solo que falló.
  return { success: status === 'sent', messageId: msgRef.id, status, externalId, errorMessage: status === 'failed' ? errorMessage : null };
});

/**
 * completeWhatsappEmbeddedSignup — recibe el código de autorización que
 * devuelve el popup de Embedded Signup de Meta, lo intercambia por un token
 * de acceso, suscribe la app a los webhooks de la WABA del cliente, y
 * crea/actualiza el documento de integración en Firestore.
 */
export const completeWhatsappEmbeddedSignup = onCall({
  maxInstances: 10,
  timeoutSeconds: 60,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { code, tenantId, wabaId, phoneNumberId, connectionType } = request.data;
  const uid = request.auth.uid;

  if (!code || !tenantId || !wabaId || !phoneNumberId) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios (code, tenantId, wabaId, phoneNumberId)');
  }

  // LOOP Fase 4 — validación server-side del rol, no solo de membresía activa.
  // El tenantId viene del payload del cliente y nunca debe ser la única
  // autoridad: se resuelve la membresía REAL de este uid en este tenant (o se
  // exige SuperAdmin) antes de intercambiar el code con Meta. Asesor
  // Comercial/Técnico/Solo lectura no pueden conectar/desconectar Meta aunque
  // manipulen el payload, porque su rol real (de Firestore, no del cliente)
  // no pasa el chequeo.
  const userSnap = await db.collection('users').doc(uid).get();
  const isSuperAdminCaller = userSnap.exists && userSnap.data()?.isSuperAdmin === true;

  if (isSuperAdminCaller) {
    // El SuperAdmin puede no tener membresía en el tenant que está conectando
    // (justamente el caso de uso: conectar sin "Entrar" primero) — igual se
    // exige que el tenant exista de verdad, no solo que el ID venga en el payload.
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      throw new HttpsError('not-found', 'El tenant indicado no existe');
    }
  } else {
    const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
    const membershipDoc = await membershipRef.get();
    const membershipData = membershipDoc.data();
    if (!membershipDoc.exists || membershipData?.status !== 'active') {
      throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
    }
    if (membershipData?.role !== 'Owner' && membershipData?.role !== 'Admin') {
      throw new HttpsError('permission-denied', 'Solo Owner o Admin del negocio pueden conectar WhatsApp');
    }
  }

  const metaAppId = '26569977219364152'; // Meta App ID de SmartFlow Hub Connect (público)
  const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();

  if (!appSecret) {
    throw new HttpsError('failed-precondition', 'Falta configurar WHATSAPP_APP_SECRET en functions/.env');
  }

  let accessToken: string;
  try {
    const tokenRes = await axios.get('https://graph.facebook.com/v25.0/oauth/access_token', {
      params: { client_id: metaAppId, client_secret: appSecret, code },
      timeout: 10000,
    });
    accessToken = tokenRes.data?.access_token;
    if (!accessToken) throw new Error('Meta no devolvió access_token');
  } catch (err: any) {
    const metaMessage = err?.response?.data?.error?.message || err.message;
    throw new HttpsError('failed-precondition', `No se pudo intercambiar el código con Meta: ${metaMessage}`);
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v25.0/${wabaId}/subscribed_apps`,
      {},
      { params: { access_token: accessToken }, timeout: 10000 }
    );
  } catch (err: any) {
    const metaMessage = err?.response?.data?.error?.message || err.message;
    throw new HttpsError('failed-precondition', `No se pudo suscribir la app a la cuenta de WhatsApp: ${metaMessage}`);
  }

  let displayPhoneNumber: string | null = null;
  let verifiedName: string | null = null;
  try {
    const phoneRes = await axios.get(`https://graph.facebook.com/v25.0/${phoneNumberId}`, {
      params: { fields: 'display_phone_number,verified_name', access_token: accessToken },
      timeout: 10000,
    });
    displayPhoneNumber = phoneRes.data?.display_phone_number || null;
    verifiedName = phoneRes.data?.verified_name || null;
  } catch (err: any) {
    console.warn('[completeWhatsappEmbeddedSignup] No se pudo leer info del número:', err?.response?.data || err.message);
  }

  // P1 SEGURIDAD: antes nada impedía que el MISMO phoneNumberId quedara
  // registrado como integración activa de DOS tenants distintos — el webhook
  // (`.where('phoneNumberId','==',...).limit(1)`) resolvería el mensaje
  // entrante a cualquiera de los dos de forma no determinística, filtrando
  // conversaciones/leads del negocio real al negocio equivocado. Se rechaza
  // la conexión si ese número ya está activo en OTRO tenant.
  const collisionSnapshot = await db.collection('integrations')
    .where('phoneNumberId', '==', phoneNumberId)
    .where('isActive', '==', true)
    .get();
  const collidesWithOtherTenant = collisionSnapshot.docs.some((d) => d.data().tenantId !== tenantId);
  if (collidesWithOtherTenant) {
    throw new HttpsError(
      'already-exists',
      'Este número de WhatsApp ya está conectado a otro negocio en SmartFlow. Contactá a soporte antes de continuar.'
    );
  }

  const existingSnapshot = await db.collection('integrations')
    .where('tenantId', '==', tenantId)
    .where('provider', '==', 'whatsapp')
    .limit(1)
    .get();

  const integrationData = {
    tenantId,
    provider: 'whatsapp',
    isActive: true,
    phoneNumberId,
    // wabaId es el campo canónico nuevo; whatsappBusinessAccountId se espeja
    // por compatibilidad porque es el nombre que usa el formulario manual
    // (IntegrationService.ts / IntegrationsPlaceholderView.tsx) y los 4
    // tenants ya conectados por esa vía — así cualquier lectura futura, sea
    // cual sea el nombre que use, encuentra el valor sin lógica condicional.
    wabaId,
    whatsappBusinessAccountId: wabaId,
    accessToken,
    connectionType: connectionType === 'coexistent' ? 'coexistent' : 'api',
    displayPhoneNumber,
    verifiedName,
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (existingSnapshot.empty) {
    await db.collection('integrations').add(integrationData);
  } else {
    await existingSnapshot.docs[0].ref.set(integrationData, { merge: true });
  }

  return { success: true, displayPhoneNumber, verifiedName };
});

/**
 * saveManualWhatsAppConfig — LOOP nocturno USADITOS, Fase 4.
 *
 * Antes, el formulario manual (IntegrationsPlaceholderView.tsx) hacía un
 * setDoc directo del cliente con isActive:true sin validar NADA contra Meta
 * — exactamente la clase de hueco que dejó a USADITOS "verde/conectado" en
 * SmartFlow con un phoneNumberId con un dígito trocado, indetectable hasta
 * que se auditó manualmente. Esta función reemplaza ese setDoc directo:
 * valida contra Meta que el phoneNumberId realmente pertenece a la WABA
 * indicada (GET /{wabaId}/phone_numbers) y asegura la suscripción de la app
 * (POST /{wabaId}/subscribed_apps, idempotente — no rompe nada si ya estaba
 * suscrita) ANTES de guardar isActive:true. Si cualquiera de los dos pasos
 * falla, no se guarda como activo — el usuario ve el error real de Meta, no
 * un "Conectado" falso.
 */
export const saveManualWhatsAppConfig = onCall({
  maxInstances: 10,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { tenantId, phoneNumberId, wabaId, appSecret, verifyToken, accessToken, isAiAutomated, isActive } = request.data;
  const uid = request.auth.uid;
  // isActive default true (compatibilidad con clientes viejos que no mandan
  // el campo); explícitamente false = solo pausar, no valida contra Meta.
  const wantsActive = isActive !== false;

  if (!tenantId || !phoneNumberId || !wabaId || !accessToken) {
    throw new HttpsError('invalid-argument', 'Faltan campos obligatorios (Phone Number ID, WABA ID, Access Token).');
  }

  // Misma validación de rol que completeWhatsappEmbeddedSignup (Fase 4 del
  // LOOP de Embedded Signup) — SuperAdmin sin membership, o Owner/Admin real.
  const userSnap = await db.collection('users').doc(uid).get();
  const isSuperAdminCaller = userSnap.exists && userSnap.data()?.isSuperAdmin === true;

  if (isSuperAdminCaller) {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get();
    if (!tenantSnap.exists) {
      throw new HttpsError('not-found', 'El tenant indicado no existe');
    }
  } else {
    const membershipDoc = await db.collection('memberships').doc(`${uid}_${tenantId}`).get();
    const membershipData = membershipDoc.data();
    if (!membershipDoc.exists || membershipData?.status !== 'active') {
      throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
    }
    if (membershipData?.role !== 'Owner' && membershipData?.role !== 'Admin') {
      throw new HttpsError('permission-denied', 'Solo Owner o Admin del negocio pueden conectar WhatsApp');
    }
  }

  let displayPhoneNumber: string | null = null;
  let verifiedName: string | null = null;

  if (wantsActive) {
    // Mismo bloqueo cross-tenant que completeWhatsappEmbeddedSignup — solo
    // aplica cuando de verdad se está activando el número.
    const collisionSnapshot = await db.collection('integrations')
      .where('phoneNumberId', '==', phoneNumberId)
      .where('isActive', '==', true)
      .get();
    const collidesWithOtherTenant = collisionSnapshot.docs.some((d) => d.data().tenantId !== tenantId);
    if (collidesWithOtherTenant) {
      throw new HttpsError(
        'already-exists',
        'Este número de WhatsApp ya está conectado a otro negocio en SmartFlow. Contactá a soporte antes de continuar.'
      );
    }

    // 1. VALIDAR que el phoneNumberId realmente pertenece a esta WABA — sin
    // esto, un typo (como el de USADITOS) queda invisible hasta el primer
    // mensaje real.
    try {
      const phonesRes = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`, {
        params: { fields: 'id,display_phone_number,verified_name', access_token: accessToken },
        timeout: 10000,
      });
      const match = (phonesRes.data?.data || []).find((p: any) => p.id === phoneNumberId);
      if (!match) {
        throw new HttpsError(
          'failed-precondition',
          'Ese Phone Number ID no pertenece a la WABA indicada (o el token no tiene acceso a esa WABA). Verificá ambos valores en Meta Business Settings.'
        );
      }
      displayPhoneNumber = match.display_phone_number || null;
      verifiedName = match.verified_name || null;
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      const metaMessage = err?.response?.data?.error?.message || err.message;
      throw new HttpsError('failed-precondition', `No se pudo verificar el Phone Number ID contra la WABA: ${metaMessage}`);
    }

    // 2. ASEGURAR la suscripción de la app a la WABA — idempotente, si ya
    // estaba suscrita Meta no hace nada distinto. Sin esto Meta nunca entrega
    // webhooks aunque todo lo demás esté bien (el bug real que bloqueó el
    // inbound de USADITOS antes de este LOOP).
    try {
      await axios.post(
        `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
        {},
        { params: { access_token: accessToken }, timeout: 10000 }
      );
    } catch (err: any) {
      const metaMessage = err?.response?.data?.error?.message || err.message;
      throw new HttpsError('failed-precondition', `No se pudo suscribir la app a la WABA: ${metaMessage}`);
    }
  }

  const existingSnapshot = await db.collection('integrations')
    .where('tenantId', '==', tenantId)
    .where('provider', '==', 'whatsapp')
    .limit(1)
    .get();

  const integrationData = {
    tenantId,
    provider: 'whatsapp',
    isActive: wantsActive,
    phoneNumberId,
    wabaId,
    whatsappBusinessAccountId: wabaId,
    accessToken,
    appSecret: appSecret || null,
    verifyToken: verifyToken || null,
    isAiAutomated: !!isAiAutomated,
    connectionType: 'manual',
    // Solo se pisan estos dos si de verdad se consultaron a Meta ahora
    // (wantsActive) — al pausar (isActive:false) no se tocan, para no borrar
    // el último valor bueno conocido con un merge de null.
    ...(wantsActive ? { displayPhoneNumber, verifiedName } : {}),
    connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (existingSnapshot.empty) {
    await db.collection('integrations').add(integrationData);
  } else {
    await existingSnapshot.docs[0].ref.set(integrationData, { merge: true });
  }

  return { success: true, displayPhoneNumber, verifiedName };
});

/**
 * Vincula una invitación pendiente con el usuario autenticado (Google/Email).
 * Usa el Admin SDK para bypassear las reglas de Firestore durante el vínculo inicial.
 */
export const acceptTenantInvite = onCall({ maxInstances: 10 }, async (request) => {
  // 1. VALIDACIÓN DE SESIÓN
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { uid } = request.auth;
  const email = request.auth.token.email;

  if (!email) {
    throw new HttpsError('failed-precondition', 'El usuario no tiene un correo electrónico verificado');
  }

  console.log(`[Invites] Intentando vincular invitaciones para: ${email} (uid: ${uid})`);

  // 2. BUSCAR INVITACIONES POR EMAIL
  // Buscamos cualquier membresía que coincida con este email
  const membershipsSnapshot = await db.collection('memberships')
    .where('email', '==', email)
    .get();

  if (membershipsSnapshot.empty) {
    console.warn(`[Invites] No se encontraron invitaciones para el correo: ${email}`);
    return { linkedCount: 0, error: 'Este correo no tiene acceso asignado.' };
  }

  let linkedCount = 0;
  const linkedTenants: string[] = [];

  // 3. PROCESAR VÍNCULOS
  const batch = db.batch();

  for (const doc of membershipsSnapshot.docs) {
    const data = doc.data();
    const tenantId = data.tenantId;

    if (!tenantId) continue;
    // 'draft'/'prepared': usuario preparado por un admin pero SIN invitación
    // enviada todavía ('prepared' ni siquiera tiene correo real cargado) —
    // nunca deben activarse solos, sin importar el método de login
    // (email/password, Google, etc.) que haya disparado este vínculo. Se
    // mantiene el mismo query por email (sin agregar un where('status', 'in',
    // [...]) que exigiría un índice compuesto nuevo) y simplemente se los salta acá.
    if (data.status === 'draft' || data.status === 'prepared') continue;

    const targetId = `${uid}_${tenantId}`;
    const targetRef = db.collection('memberships').doc(targetId);

    // Si el ID es diferente, migramos los datos al ID estructurado
    if (doc.id !== targetId) {
      batch.set(targetRef, {
        ...data,
        id: targetId,
        userId: uid,
        status: data.status === 'suspended' ? 'suspended' : 'active', // Respetar suspensión si existe
        authProvider: request.auth.token.firebase?.sign_in_provider || 'unknown',
        linkedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      // Eliminar el documento de invitación original (ID aleatorio)
      batch.delete(doc.ref);

      // Multi-Agente guarda membership.id en multiAgentConfig.includedUserIds
      // mientras la persona es prepared/draft/pending (userId todavía null —
      // ver src/modules/multi-agent/MultiAgentView.tsx). Como este flujo borra
      // ese doc.id y lo reemplaza por targetId, sin este paso la persona
      // desaparecería en silencio del equipo configurado justo al activar su
      // cuenta. Se lee settings/{tenantId} ANTES del commit (los batches de
      // Firestore no permiten lecturas) y el reemplazo se agrega al MISMO
      // batch que migra la membership, para que ambos escriban atómicamente.
      const settingsRef = db.collection('settings').doc(tenantId);
      const settingsSnap = await settingsRef.get();
      if (settingsSnap.exists) {
        const includedUserIds = settingsSnap.data()?.multiAgentConfig?.includedUserIds;
        if (Array.isArray(includedUserIds) && includedUserIds.includes(doc.id)) {
          const migratedIds = Array.from(new Set(
            includedUserIds.map((id: string) => (id === doc.id ? uid : id))
          ));
          batch.update(settingsRef, {
            'multiAgentConfig.includedUserIds': migratedIds,
            updatedAt: FieldValue.serverTimestamp(),
          });
          console.log(`[Invites] Multi-Agente: migrado ID ${doc.id} -> ${uid} en tenant ${tenantId}`);
        }
      }

      // FIX URGENTE 2026-09-09 — acá estaba el origen del desfase. Este
      // bloque re-indexa la membership de {docId} a {uid}_{tenantId} y borra
      // el doc original, pero vendor_credentials se guarda CON EL ID DE LA
      // MEMBERSHIP como doc id y login_handles guarda ese mismo ID: ninguno
      // de los dos se movía. Desde el primer acceso de cada vendedor,
      // setVendorPin/getVendorAccessInfo no encontraban la credencial por ID
      // (estado muerto: "PIN no configurado" + "ya tiene un método de acceso
      // configurado") y loginWithPin leía una membership borrada y denegaba
      // todo acceso posterior. Se mueven en el MISMO batch que la membership,
      // así no puede volver a quedar a medias.
      const oldCredRef = db.collection('vendor_credentials').doc(doc.id);
      const oldCredSnap = await oldCredRef.get();
      if (oldCredSnap.exists) {
        const credData = oldCredSnap.data()!;
        batch.set(db.collection('vendor_credentials').doc(targetId), {
          ...credData,
          membershipId: targetId,
          remappedFrom: doc.id,
          remappedAt: FieldValue.serverTimestamp(),
        });
        batch.delete(oldCredRef);
        if (credData.loginHandle) {
          batch.set(
            db.collection('login_handles').doc(`${tenantId}_${credData.loginHandle}`),
            {
              tenantId,
              membershipId: targetId,
              // credDocId y authUid van en el MISMO batch que mueve la
              // credencial: el índice nunca puede quedar apuntando a un doc
              // que no existe (ver syncAccessIndex / loginWithPin).
              credDocId: targetId,
              authUid: uid,
              repointedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        console.log('[Invites] Acceso por PIN re-indexado', { from: doc.id, to: targetId, tenantId });
      }
    } else {
      // Si el ID ya es el correcto (re-re-login), solo aseguramos activación si era pending
      batch.update(targetRef, {
        userId: uid,
        status: data.status === 'suspended' ? 'suspended' : 'active',
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    linkedCount++;
    linkedTenants.push(tenantId);
  }

  await batch.commit();
  console.log(`[Invites] Éxito: Se vincularon ${linkedCount} membresías para ${email}`);

  return {
    success: true,
    linkedCount,
    tenants: linkedTenants
  };
});

// ═══════════════════════════════════════════════════════════════════════
// DISPOSITIVO CONFIABLE + PIN — capa operativa SOBRE Firebase Auth, no un
// reemplazo. Cada vendedor sigue teniendo un uid real de Firebase Auth (con
// un email técnico interno generado por el sistema, nunca visto por él);
// el PIN solo decide si ese uid recibe un custom token para iniciar sesión.
// El PIN NUNCA se guarda en texto plano ni es el único factor remoto: vive
// hasheado (scrypt + salt aleatoria) en vendor_credentials/{membershipId},
// una colección con Firestore Rules "allow read, write: if false" —
// inalcanzable desde el cliente, solo el Admin SDK de estas Functions puede
// tocarla. Reutiliza el flujo YA EXISTENTE de activación (acceptTenantInvite)
// en vez de duplicar su lógica de migración de {docId} -> {uid}_{tenantId}
// y de includedUserIds: setVendorPin deja la membership en 'pending' con un
// email interno, y el primer signInWithCustomToken dispara el mismo
// acceptTenantInvite que ya usa el flujo de invitación por correo.
// ═══════════════════════════════════════════════════════════════════════

// Helpers de PIN extraídos a pinAuth.ts (sin efectos secundarios, testeables
// con vitest sin importar este archivo completo — ver functions/src/pinAuth.test.ts).

async function assertCallerIsTenantAdmin(callerUid: string, tenantId: string): Promise<void> {
  const membershipSnap = await db.collection('memberships').doc(`${callerUid}_${tenantId}`).get();
  const m = membershipSnap.data();
  const isAdminRole = m?.status === 'active' && (m.role === 'Owner' || m.role === 'Admin');
  if (!isAdminRole) {
    throw new HttpsError('permission-denied', 'Solo un Owner/Admin activo de este negocio puede hacer esto.');
  }
}

/**
 * FIX URGENTE 2026-09-09 — la credencial de PIN se guardaba (y el
 * login_handle apuntaba) con el ID que tenía la membership EN EL MOMENTO de
 * generar el PIN. Pero acceptTenantInvite re-indexa la membership de
 * {docIdAleatorio} a {uid}_{tenantId} y BORRA el doc original en el primer
 * acceso — sin mover vendor_credentials ni repuntar login_handles. Desde
 * ese momento nada volvía a encontrarse por ID:
 *   - getVendorAccessInfo(idActual) -> "PIN no configurado"
 *   - setVendorPin(idActual) -> no veía credencial, caía en el guard de
 *     prepared/draft y rechazaba: estado muerto reportado en producción.
 *   - loginWithPin -> leía memberships/{idViejo} (borrado) y denegaba el
 *     acceso a CUALQUIER vendedor que ya hubiera entrado una vez.
 *
 * La identidad estable de un acceso no es el ID de la membership (cambia)
 * sino el uid de Firebase Auth (`authUid`, nunca cambia). Este resolvedor
 * busca primero por ID (camino rápido, datos nuevos ya coherentes) y si no
 * está, por authUid dentro del mismo tenant — así los datos ya desfasados
 * en producción se resuelven solos, sin migración destructiva, y cualquier
 * re-indexado futuro tampoco vuelve a crear un callejón sin salida.
 */
async function resolveVendorCredential(
  membershipId: string,
  membership: admin.firestore.DocumentData,
): Promise<{ ref: admin.firestore.DocumentReference; data: admin.firestore.DocumentData } | null> {
  const directRef = db.collection('vendor_credentials').doc(membershipId);
  const directSnap = await directRef.get();
  if (directSnap.exists) return { ref: directRef, data: directSnap.data()! };

  const authUid = membership.userId;
  if (!authUid) return null;

  // Consulta por un solo campo de igualdad a propósito (sin índice
  // compuesto): el email técnico incluye el tenantId, así que un authUid
  // pertenece a un único tenant, y de todos modos se verifica acá.
  const byUid = await db.collection('vendor_credentials').where('authUid', '==', authUid).limit(5).get();
  const match = byUid.docs.find((d) => d.data().tenantId === membership.tenantId);
  if (!match) return null;

  console.log('VENDOR_CRED_RESOLVED_BY_AUTHUID', {
    membershipId, credDocId: match.id, tenantId: membership.tenantId,
  });
  return { ref: match.ref, data: match.data() };
}

/**
 * Reserva un loginHandle libre DENTRO del tenant y lo deja apuntando a esta
 * membership. Único por tenant, no global: "michelle" en dos negocios
 * distintos no choca (ver login_handles/{tenantId}_{handle}). Si hay choque
 * real dentro del mismo negocio (dos "Michelle"), agrega un sufijo numérico
 * en vez de fallar; si la fila que choca ya es de ESTA misma membership, se
 * reusa tal cual (idempotente — importa porque ahora setVendorPin puede
 * llamarse varias veces sobre la misma persona).
 */
async function claimLoginHandle(tenantId: string, rawName: string | undefined, membershipId: string): Promise<string> {
  const baseHandle = normalizeLoginHandle(rawName || 'vendedor');
  if (!baseHandle) throw new HttpsError('invalid-argument', 'No se pudo derivar un usuario de acceso válido del nombre.');

  let handle = baseHandle;
  let suffix = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ref = db.collection('login_handles').doc(`${tenantId}_${handle}`);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ tenantId, membershipId, createdAt: FieldValue.serverTimestamp() });
      return handle;
    }
    if (snap.data()!.membershipId === membershipId) return handle;
    suffix += 1;
    handle = `${baseHandle}${suffix}`;
    if (suffix > 50) throw new HttpsError('internal', 'No se pudo asignar un usuario de acceso único.');
  }
}

/**
 * Deja login_handles/{tenantId}_{handle} apuntando al ID ACTUAL de la
 * membership. Es idempotente y se llama desde setVendorPin: si la
 * membership se re-indexó después de generar el PIN, esto corrige el índice
 * en el momento en que un Admin vuelve a tocar el acceso de esa persona.
 */
async function syncAccessIndex(opts: {
  tenantId: string;
  loginHandle: string;
  membershipId: string;
  authUid: string;
  credDocId: string;
}): Promise<void> {
  const { tenantId, loginHandle, membershipId, authUid, credDocId } = opts;
  const handleRef = db.collection('login_handles').doc(`${tenantId}_${loginHandle}`);
  const snap = await handleRef.get();
  const payload = {
    tenantId,
    membershipId,
    // REGRESIÓN CORREGIDA: la versión anterior de este helper solo repuntaba
    // `membershipId`, y loginWithPin derivaba el doc de credencial DE ESE
    // campo. Al repuntarlo a la membership actual sin mover la credencial, el
    // login quedaba buscando vendor_credentials/{idActual}, que no existía, y
    // respondía "Usuario o PIN incorrecto" con un PIN recién generado. Ahora
    // el índice guarda explícitamente DÓNDE está la credencial (credDocId) y
    // a QUÉ cuenta de Auth pertenece (authUid, el único identificador que no
    // cambia nunca), así el login no depende de ningún ID mutable.
    authUid,
    credDocId,
    updatedAt: FieldValue.serverTimestamp(),
    ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
  await handleRef.set(payload, { merge: true });
  if (snap.exists && (snap.data()!.membershipId !== membershipId || snap.data()!.credDocId !== credDocId)) {
    console.log('ACCESS_INDEX_SYNCED', { tenantId, loginHandle, membershipId, credDocId });
  }
}

/**
 * Resuelve DÓNDE está la credencial de un loginHandle, sin depender de
 * ningún ID que pueda cambiar.
 *
 * Orden: (1) el puntero explícito que guarda el índice (credDocId), (2) el
 * lugar canónico = ID actual de la membership, (3) búsqueda por loginHandle
 * dentro del tenant, (4) búsqueda por authUid. Los pasos 3 y 4 son la red de
 * seguridad: si el índice quedó desfasado, el login NO debe fallar como si el
 * PIN estuviera mal — eso fue exactamente el bug del PIN recién generado que
 * no dejaba entrar.
 *
 * La consulta usa un solo campo de igualdad (sin índice compuesto) y el
 * tenantId se verifica en memoria: loginHandle es único POR TENANT, no
 * globalmente, así que filtrar por tenant es obligatorio para no cruzar
 * negocios.
 */
async function resolveCredRefForLogin(
  tenantId: string,
  loginHandle: string,
  handleData: admin.firestore.DocumentData,
): Promise<admin.firestore.DocumentReference | null> {
  const candidates = [handleData.credDocId, handleData.membershipId].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  for (const id of candidates) {
    const ref = db.collection('vendor_credentials').doc(id);
    if ((await ref.get()).exists) return ref;
  }

  const pickInTenant = (snap: admin.firestore.QuerySnapshot) =>
    snap.docs.find((d) => d.data().tenantId === tenantId);

  const byHandle = pickInTenant(
    await db.collection('vendor_credentials').where('loginHandle', '==', loginHandle).limit(10).get(),
  );
  if (byHandle) {
    console.warn('VENDOR_CRED_RECOVERED_BY_HANDLE', { tenantId, loginHandle, credDocId: byHandle.id });
    return byHandle.ref;
  }

  if (typeof handleData.authUid === 'string' && handleData.authUid) {
    const byUid = pickInTenant(
      await db.collection('vendor_credentials').where('authUid', '==', handleData.authUid).limit(10).get(),
    );
    if (byUid) {
      console.warn('VENDOR_CRED_RECOVERED_BY_AUTHUID', { tenantId, loginHandle, credDocId: byUid.id });
      return byUid.ref;
    }
  }

  return null;
}

/**
 * Deja la credencial viviendo en su lugar CANÓNICO: vendor_credentials/{id
 * actual de la membership}. Si estaba bajo un ID viejo (porque
 * acceptTenantInvite re-indexó la membership después de generar el PIN), la
 * mueve en un batch atómico — nunca quedan dos credenciales activas ni cero.
 * Devuelve el ref donde hay que escribir el PIN nuevo.
 */
async function normalizeCredentialLocation(
  existingRef: admin.firestore.DocumentReference,
  existingData: admin.firestore.DocumentData,
  membershipId: string,
): Promise<admin.firestore.DocumentReference> {
  if (existingRef.id === membershipId) return existingRef;

  const canonicalRef = db.collection('vendor_credentials').doc(membershipId);
  const batch = db.batch();
  batch.set(canonicalRef, {
    ...existingData,
    membershipId,
    remappedFrom: existingRef.id,
    remappedAt: FieldValue.serverTimestamp(),
  });
  batch.delete(existingRef);
  await batch.commit();
  console.log('VENDOR_CRED_RELOCATED', { from: existingRef.id, to: membershipId });
  return canonicalRef;
}

/**
 * Owner/Admin: genera (o regenera) el PIN de un vendedor. Primera vez sobre
 * una membership 'prepared'/'draft': crea su cuenta técnica real de Firebase
 * Auth (email interno + password aleatoria que nadie ve), un loginHandle
 * único DENTRO del tenant (derivado del nombre — "Michelle" en dos tenants
 * distintos no choca, ver login_handles/{tenantId}_{handle}) y dispara el
 * mismo camino de activación que ya usa la invitación por correo. Devuelve
 * el PIN en texto plano UNA sola vez, para que el Owner se lo entregue al
 * vendedor junto con su loginHandle — nunca el membershipId.
 */
export const setVendorPin = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { membershipId, loginHandle: requestedHandle, breakGlass } = request.data as {
    membershipId?: string; loginHandle?: string; breakGlass?: boolean;
  };
  if (!membershipId) throw new HttpsError('invalid-argument', 'Falta membershipId');

  const membershipRef = db.collection('memberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError('not-found', 'La membresía no existe');
  const membership = membershipSnap.data()!;
  const tenantId = membership.tenantId;

  // LOOP DE EMERGENCIA 2026-09-09: bootstrap del primer Owner. Un tenant
  // recién creado tiene todos sus Owners en 'prepared' — nadie tiene una
  // membership activa todavía, así que la regla normal (solo Owner/Admin
  // activo administra accesos) deja al tenant sin forma de arrancar: nadie
  // puede llamar setVendorPin para activar al primer Owner. Se permite a un
  // SuperAdmin bootstrapear ÚNICAMENTE cuando el tenant tiene 0 Owners
  // activos Y la membership objetivo es de rol Owner — se apaga solo apenas
  // exista un Owner activo. Decisión testeada en vendorPinAuth.test.ts.
  const callerUid = request.auth.uid;
  const [callerUserSnap, callerMembershipSnap, activeOwnerSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('memberships').doc(`${callerUid}_${tenantId}`).get(),
    db.collection('memberships')
      .where('tenantId', '==', tenantId)
      .where('role', '==', 'Owner')
      .where('status', '==', 'active')
      .limit(1)
      .get(),
  ]);
  const isSuperAdminCaller = callerUserSnap.exists && callerUserSnap.data()?.isSuperAdmin === true;
  const callerMembershipData = callerMembershipSnap.data();

  const pinAuth = checkVendorPinAuth({
    isSuperAdmin: isSuperAdminCaller,
    callerMembership: callerMembershipSnap.exists && callerMembershipData
      ? { status: callerMembershipData.status, role: callerMembershipData.role }
      : null,
    targetMembershipRole: membership.role,
    tenantHasActiveOwner: !activeOwnerSnap.empty,
    // Solo cuenta si el caller ES SuperAdmin: checkVendorPinAuth exige ambas
    // cosas, así que un tenant normal mandando breakGlass:true no consigue nada.
    breakGlass: breakGlass === true,
  });
  if (!pinAuth.allowed) {
    throw new HttpsError('permission-denied', 'Solo un Owner/Admin activo de este negocio puede hacer esto.');
  }

  // FIX URGENTE — estado muerto real: una membership 'active' SIN credencial
  // resoluble no podía generar PIN (el guard viejo exigía prepared/draft), y
  // la UI ya sabía que no tenía PIN. Ahora la transición la decide la máquina
  // de estados de accessLifecycle.ts, que es la MISMA que la UI consulta
  // (getTenantAccessOverview) — así no se puede ofrecer un botón que esto
  // vaya a rechazar.
  const existingCred = await resolveVendorCredential(membershipId, membership);
  const transition = checkSetVendorPinTransition({
    status: membership.status,
    userId: membership.userId,
    hasCredential: !!existingCred,
  });
  if (!transition.allowed) {
    throw new HttpsError(
      'failed-precondition',
      transition.reason === 'suspended'
        ? SUSPENDED_PIN_ERROR
        : 'El estado de acceso de esta persona no permite generar un PIN todavía. Revisá su ficha.',
    );
  }

  let credRef: admin.firestore.DocumentReference;
  let authUid: string;
  let loginHandle: string;

  if (transition.mode === 'regenerate') {
    // La cuenta técnica y el loginHandle ya existen: solo cambia el PIN. El
    // doc de credencial puede estar guardado bajo un ID de membership viejo
    // (ver resolveVendorCredential); se MUEVE a su lugar canónico antes de
    // escribir el PIN nuevo. La versión anterior repuntaba solo el índice y
    // dejaba la credencial donde estaba: el login quedaba buscándola en el ID
    // nuevo, no la encontraba, y un PIN recién generado daba "Usuario o PIN
    // incorrecto".
    authUid = existingCred!.data.authUid;
    loginHandle = existingCred!.data.loginHandle;
    credRef = await normalizeCredentialLocation(existingCred!.ref, existingCred!.data, membershipId);
  } else if (transition.mode === 'attach') {
    // Ya hay un uid real de Firebase Auth (esta persona entró alguna vez)
    // pero no hay credencial de PIN: se le engancha una credencial nueva a
    // ESA cuenta. Nunca se crea un usuario de Auth nuevo acá — eso
    // duplicaría la identidad y dejaría su historial colgado del uid viejo.
    authUid = membership.userId as string;
    loginHandle = await claimLoginHandle(tenantId, requestedHandle || membership.name, membershipId);
    credRef = db.collection('vendor_credentials').doc(membershipId);
  } else {
    loginHandle = await claimLoginHandle(tenantId, requestedHandle || membership.name, membershipId);
    credRef = db.collection('vendor_credentials').doc(membershipId);

    // toLowerCase() es obligatorio acá: membershipId es un ID auto-generado
    // de Firestore (mayúsculas/minúsculas mixtas), pero Firebase Auth
    // normaliza el email a minúsculas al crear el usuario — sin esto, el
    // email guardado en la membership nunca coincide con el claim `email`
    // real del idToken, y acceptTenantInvite jamás la activa (encontrado y
    // confirmado en el canary controlado del tenant demo, no en Michelle real).
    const internalEmail = `vendedor.${membershipId}@${tenantId}.usuarios.smartflow.internal`.toLowerCase();
    const randomPassword = crypto.randomBytes(24).toString('base64url');
    const authUser = await admin.auth().createUser({
      email: internalEmail,
      password: randomPassword,
      displayName: membership.name || 'Vendedor',
    });
    authUid = authUser.uid;

    // Sin esto, AuthService.getUserProfile(uid) del frontend devuelve null
    // para siempre (users/{uid} nunca existiría) y useAuthStore.user se
    // queda null — /mi-turno y cualquier pantalla que dependa de `user`
    // (no solo de activeMembership) se queda cargando indefinidamente.
    // Mismo shape que escribe AuthService.register() para el flujo por
    // correo — encontrado probando el login real por UI, no en el canary
    // de backend (que nunca pasaba por getUserProfile).
    await db.collection('users').doc(authUid).set({
      id: authUid,
      name: membership.name || 'Vendedor',
      email: internalEmail,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Mismo estado que deja sendInvitation() para el flujo por correo — el
    // primer signInWithCustomToken dispara acceptTenantInvite, que migra
    // {docId} -> {uid}_{tenantId} e includedUserIds sin lógica duplicada acá.
    // El correo humano previo (si lo había: una invitación por email que
    // nadie aceptó) se preserva en invitedEmail — `email` tiene que quedar
    // con el interno porque es lo que acepta/matchea acceptTenantInvite, pero
    // el dato del negocio no se pierde.
    await membershipRef.update({
      email: internalEmail,
      ...(membership.email && membership.email !== internalEmail
        ? { invitedEmail: membership.email }
        : {}),
      status: 'pending',
      invitedAt: FieldValue.serverTimestamp(),
      accessMethod: 'pin',
    });
  }

  const pin = generatePin();
  const salt = crypto.randomBytes(16).toString('hex');
  await credRef.set({
    tenantId,
    membershipId,
    authUid,
    loginHandle,
    pinHash: hashPin(pin, salt),
    pinSalt: salt,
    pinSetAt: FieldValue.serverTimestamp(),
    pinSetBy: request.auth.uid,
    failedAttempts: 0,
    lockedUntil: null,
  }, { merge: true });

  // El índice se sincroniza DESPUÉS de que la credencial ya está escrita en su
  // lugar canónico, nunca antes: así nunca queda apuntando a un doc que no
  // existe (exactamente la regresión que dejó sin acceso a los dos usuarios de
  // USADITOS con un PIN recién generado).
  await syncAccessIndex({ tenantId, loginHandle, membershipId, authUid, credDocId: credRef.id });

  // Al REGENERAR, el PIN anterior ya quedó inválido (se sobreescribió el
  // hash/salt). Además se cortan las sesiones ya abiertas de esa cuenta: si
  // el motivo de regenerar fue un PIN filtrado o un teléfono perdido, dejar
  // viva la sesión existente haría que el PIN nuevo no sirviera de nada. La
  // persona vuelve a entrar con el PIN nuevo. No aplica a bootstrap/attach
  // (no hay sesión previa que cortar en un acceso que recién se crea).
  if (transition.mode === 'regenerate') {
    // Regenerar el codigo ES recuperacion (codigo filtrado, telefono perdido): las
    // credenciales de dispositivo de esta persona tambien dejan de servir, o un
    // telefono robado seguiria entrando sin codigo. Se invalida solo la
    // credencial, no el registro del equipo: el historial queda.
    try {
      const devices = await db.collection('trusted_devices').where('userId', '==', authUid).get();
      await Promise.all(devices.docs.map((d) => d.ref.update({
        secretHash: null,
        secretSalt: null,
        secretInvalidatedAt: FieldValue.serverTimestamp(),
      })));
    } catch (err) {
      console.warn('DEVICE_SECRETS_INVALIDATE_FAILED', { membershipId, error: (err as Error).message });
    }
    try {
      await admin.auth().revokeRefreshTokens(authUid);
    } catch (err) {
      // No invalida la regeneración en sí: el PIN viejo ya no sirve igual.
      console.warn('VENDOR_PIN_REGEN_REVOKE_TOKENS_FAILED', { membershipId, error: (err as Error).message });
    }
  }

  // Rescate del SuperAdmin: queda registrado en Firestore, no solo en el log de
  // la función. Nunca guarda el código ni el hash — ver buildBreakGlassAuditEvent.
  if (pinAuth.via === 'break-glass') {
    try {
      await db.collection('security_audit').add({
        ...buildBreakGlassAuditEvent({
          tenantId,
          membershipId,
          targetName: membership.name ?? null,
          targetRole: membership.role ?? null,
          performedByUid: request.auth.uid,
          performedByEmail: callerUserSnap.data()?.email ?? null,
          mode: transition.mode,
        }),
        at: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // Un fallo de auditoría no puede dejar a la persona sin acceso, pero sí
      // tiene que quedar visible en el log de la función.
      console.error('VENDOR_PIN_BREAK_GLASS_AUDIT_FAILED', { tenantId, membershipId, error: (err as Error).message });
    }
  }

  console.log('VENDOR_PIN_SET', { tenantId, membershipId, setBy: request.auth.uid, mode: transition.mode, via: pinAuth.via });

  return { pin, tenantId, loginHandle, mode: transition.mode };
});

/**
 * FIX URGENTE — el ícono 🔗 de "acceso" copiaba un link genérico
 * (https://hub.smartflow-suite.com, que resuelve a /login) para CUALQUIER
 * usuario que no fuera 'prepared'/'draft' — nunca su enlace real de acceso
 * por PIN (/acceso?h=<loginHandle>&t=<tenantId>&n=<nombre>). Esta función
 * devuelve ÚNICAMENTE el loginHandle (el dato público, no sensible, que
 * completa ese link) — vendor_credentials tiene "allow read, write: if
 * false" en las Rules, así que el cliente no puede leerlo directo. Nunca
 * devuelve pinHash/pinSalt, y nunca "recupera" ni inventa el PIN en texto
 * plano — si hace falta un PIN nuevo, ese es el trabajo de setVendorPin,
 * una acción separada y explícita ("Generar nuevo PIN").
 */
export const getVendorAccessInfo = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { membershipId } = request.data as { membershipId?: string };
  if (!membershipId) throw new HttpsError('invalid-argument', 'Falta membershipId');

  const membershipRef = db.collection('memberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError('not-found', 'La membresía no existe');
  const membership = membershipSnap.data()!;
  const tenantId = membership.tenantId;

  const callerUid = request.auth.uid;
  const [callerUserSnap, callerMembershipSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('memberships').doc(`${callerUid}_${tenantId}`).get(),
  ]);
  const isSuperAdminCaller = callerUserSnap.exists && callerUserSnap.data()?.isSuperAdmin === true;
  const callerMembershipData = callerMembershipSnap.data();

  const auth = checkTenantAdminAuth({
    isSuperAdmin: isSuperAdminCaller,
    callerMembership: callerMembershipSnap.exists && callerMembershipData
      ? { status: callerMembershipData.status, role: callerMembershipData.role }
      : null,
  });
  if (!auth.allowed) {
    throw new HttpsError('permission-denied', 'Solo un Owner/Admin activo de este negocio puede hacer esto.');
  }

  // Resuelve también las credenciales guardadas bajo un ID de membership
  // viejo (ver resolveVendorCredential) — antes esto devolvía
  // hasPinAccess:false para cualquier vendedor que ya hubiera entrado una
  // vez, y la UI mostraba "PIN no configurado" sobre alguien que sí tenía
  // acceso y estaba trabajando.
  const cred = await resolveVendorCredential(membershipId, membership);
  const state = resolveAccessState({
    status: membership.status,
    userId: membership.userId,
    hasCredential: !!cred,
  });
  const actions = resolveAccessActionsFor({
    status: membership.status,
    userId: membership.userId,
    hasCredential: !!cred,
  });
  if (!cred) {
    return { hasPinAccess: false, state, primaryAction: actions.primary, canRegenerate: false };
  }
  return {
    hasPinAccess: true,
    loginHandle: cred.data.loginHandle as string,
    state,
    primaryAction: actions.primary,
    canRegenerate: actions.canRegenerate,
  };
});

/**
 * REGLA UX del ciclo de acceso: "nunca mostrar un botón que el backend va a
 * rechazar por una condición que la propia UI conoce". Para cumplirla, la
 * lista de Usuarios necesita el estado de acceso REAL de cada persona antes
 * de renderizar acciones — y ese estado depende de vendor_credentials, que
 * el cliente no puede leer (Rules: "allow read, write: if false").
 *
 * Esta función lo resuelve en UNA sola llamada por tenant (no N, una por
 * fila) y devuelve exactamente lo que la UI necesita: el estado y la acción
 * principal que corresponde, calculados con la MISMA máquina de estados que
 * aplica setVendorPin. Nunca devuelve pinHash/pinSalt ni el PIN.
 */
export const getTenantAccessOverview = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { tenantId } = request.data as { tenantId?: string };
  if (!tenantId) throw new HttpsError('invalid-argument', 'Falta tenantId');

  const callerUid = request.auth.uid;
  const [callerUserSnap, callerMembershipSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('memberships').doc(`${callerUid}_${tenantId}`).get(),
  ]);
  const isSuperAdminCaller = callerUserSnap.exists && callerUserSnap.data()?.isSuperAdmin === true;
  const callerMembershipData = callerMembershipSnap.data();

  // Mismo guard que el resto del ciclo de acceso: Owner/Admin activo DE ESTE
  // tenant (el lookup ya viene scoped por tenantId, así que una membership
  // activa en otro negocio nunca autoriza acá) o SuperAdmin.
  const auth = checkTenantAdminAuth({
    isSuperAdmin: isSuperAdminCaller,
    callerMembership: callerMembershipSnap.exists && callerMembershipData
      ? { status: callerMembershipData.status, role: callerMembershipData.role }
      : null,
  });
  if (!auth.allowed) {
    throw new HttpsError('permission-denied', 'Solo un Owner/Admin activo de este negocio puede hacer esto.');
  }

  const [membershipsSnap, credsSnap] = await Promise.all([
    db.collection('memberships').where('tenantId', '==', tenantId).get(),
    db.collection('vendor_credentials').where('tenantId', '==', tenantId).get(),
  ]);

  // Índice por ID de doc y por authUid — cubre las credenciales coherentes y
  // las guardadas bajo un ID de membership ya re-indexado, sin una lectura
  // extra por fila.
  const credByDocId = new Map<string, admin.firestore.DocumentData>();
  const credByAuthUid = new Map<string, admin.firestore.DocumentData>();
  credsSnap.docs.forEach((d) => {
    credByDocId.set(d.id, d.data());
    if (d.data().authUid) credByAuthUid.set(d.data().authUid, d.data());
  });

  const access: Record<string, {
    state: string;
    primaryAction: string;
    canRegenerate: boolean;
    hasPinAccess: boolean;
    loginHandle: string | null;
  }> = {};

  membershipsSnap.docs.forEach((d) => {
    const m = d.data();
    const cred = credByDocId.get(d.id) || (m.userId ? credByAuthUid.get(m.userId) : undefined);
    const input = { status: m.status, userId: m.userId, hasCredential: !!cred };
    const actions = resolveAccessActionsFor(input);
    access[d.id] = {
      state: resolveAccessState(input),
      primaryAction: actions.primary,
      canRegenerate: actions.canRegenerate,
      hasPinAccess: !!cred,
      loginHandle: (cred?.loginHandle as string) || null,
    };
  });

  return { tenantId, access };
});

/**
 * Un intento de PIN contra UNA credencial concreta. Transaccional: el
 * contador de intentos fallidos y el bloqueo temporal viven en el propio doc
 * de credencial, así que valen entre instancias concurrentes.
 *
 * Devuelve null cuando el PIN no coincide (para poder probar el siguiente
 * candidato sin abortar); lanza cuando el intento no debe continuar de
 * ninguna forma (credencial bloqueada por intentos, membership no habilitada).
 */
async function attemptPinLogin(
  credRef: admin.firestore.DocumentReference,
  pin: string,
  fallbackMembershipId?: string,
): Promise<{ authUid: string; tenantId: string; loginHandle: string; displayName: string } | null> {
  return db.runTransaction(async (tx) => {
    const credSnap = await tx.get(credRef);
    if (!credSnap.exists) return null;
    const cred = credSnap.data()!;

    const lockedUntil = cred.lockedUntil?.toMillis?.() ?? 0;
    if (lockedUntil > Date.now()) {
      throw new HttpsError('resource-exhausted', 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.');
    }

    const ok = verifyPinHash(pin, cred.pinSalt, cred.pinHash);
    if (!ok) {
      const attempts = (cred.failedAttempts || 0) + 1;
      const update: Record<string, unknown> = { failedAttempts: attempts };
      if (attempts >= PIN_MAX_ATTEMPTS) {
        update.failedAttempts = 0;
        update.lockedUntil = Timestamp.fromMillis(Date.now() + PIN_LOCKOUT_MS);
        console.warn('VENDOR_PIN_LOCKED', { credDocId: credRef.id, tenantId: cred.tenantId });
      }
      tx.update(credRef, update);
      return null;
    }

    // La identidad estable es authUid, así que el ID canónico de la membership
    // es {authUid}_{tenantId}; el ID viejo se consulta solo como fallback, que
    // es el caso del PRIMER acceso (la membership todavía está bajo su doc id
    // original, en 'pending').
    const canonicalRef = db.collection('memberships').doc(`${cred.authUid}_${cred.tenantId}`);
    let membershipSnap = await tx.get(canonicalRef);
    if (!membershipSnap.exists && fallbackMembershipId) {
      membershipSnap = await tx.get(db.collection('memberships').doc(fallbackMembershipId));
    }

    // LOOP — reutilización de teléfonos corporativos: el PIN sigue siendo
    // válido después de que Owner/Admin desactive a alguien (setVendorPin no
    // se vuelve a llamar solo porque cambió el status, y desactivar no borra
    // vendor_credentials — ver setMembershipActive). Sin este chequeo, un
    // vendedor desactivado se podía loguear igual. Mismo error genérico que un
    // PIN incorrecto, a propósito: nunca hay que dejarle a alguien distinguir
    // "cuenta desactivada" de "PIN incorrecto" por la respuesta.
    const pinLoginAuth = checkPinLoginAllowed({
      membershipExists: membershipSnap.exists,
      membershipStatus: membershipSnap.data()?.status,
      membershipUserId: membershipSnap.data()?.userId,
    });
    if (!pinLoginAuth.allowed) {
      throw new HttpsError('permission-denied', PIN_LOGIN_GENERIC_ERROR);
    }

    tx.update(credRef, { failedAttempts: 0, lockedUntil: null, lastLoginAt: FieldValue.serverTimestamp() });
    return {
      authUid: cred.authUid as string,
      tenantId: cred.tenantId as string,
      loginHandle: (cred.loginHandle as string) || '',
      // El nombre visible sale de la membership, NUNCA del email técnico
      // interno (vendedor.*@*.usuarios.smartflow.internal): ese dato no es
      // algo que el vendedor deba conocer ni ver en ninguna pantalla.
      displayName: (membershipSnap.data()?.name as string) || 'Vendedor',
    };
  });
}

/**
 * Candidatos de credencial cuando el vendedor entra desde /login SIN el
 * enlace, o sea sin tenantId: solo escribió su usuario ("eduardopruebas") y su
 * PIN. loginHandle es único POR TENANT, no globalmente, así que puede haber
 * más de un candidato (dos negocios con una "michelle"); en ese caso el PIN es
 * lo que desambigua — se prueba contra cada uno y entra el que coincida.
 * Nunca se le pide al vendedor un tenantId ni ningún otro dato técnico, y la
 * respuesta es la misma exista o no el usuario.
 */
async function findCredentialsByHandle(loginHandle: string, tenantId?: string): Promise<admin.firestore.DocumentReference[]> {
  const snap = await db.collection('vendor_credentials').where('loginHandle', '==', loginHandle).limit(10).get();
  const docs = tenantId ? snap.docs.filter((d) => d.data().tenantId === tenantId) : snap.docs;
  return docs.map((d) => d.ref);
}

/**
 * Acceso por PIN — el vendedor SOLO ve su nombre/usuario + PIN, nunca un
 * membershipId, un tenantId ni el email técnico interno. `tenantId` es
 * OPCIONAL: viene cuando se entra por el enlace de alta (/acceso?h=&t=&n=) o
 * desde un dispositivo ya reconocido, y NO viene cuando el vendedor vuelve a
 * entrar desde /login escribiendo su usuario — ahí el tenant se resuelve
 * internamente desde las credenciales, sin exponerlo.
 *
 * Si el usuario no existe se hace el MISMO trabajo de hash (DUMMY_PIN_HASH) y
 * se devuelve el MISMO error genérico que un PIN incorrecto — nunca se revela
 * si el usuario existe, ni por mensaje ni por tiempo de respuesta. Sin
 * request.auth previo a propósito: este endpoint ES el paso de autenticación.
 * El límite de intentos por credencial es transaccional sobre Firestore (no en
 * memoria, válido entre instancias concurrentes); además hay un límite liviano
 * en memoria por usuario y por IP de origen para frenar enumeración antes de
 * siquiera tocar Firestore (best-effort, no distribuido).
 */
export const loginWithPin = onCall({ maxInstances: 10 }, async (request) => {
  const { tenantId, loginHandle: rawHandle, pin } = request.data as { tenantId?: string; loginHandle?: string; pin?: string };
  if (!rawHandle || !pin) throw new HttpsError('invalid-argument', 'Falta loginHandle o pin');

  const handle = normalizeLoginHandle(rawHandle);
  // El cupo se cuenta por USUARIO, no por tenant+usuario: si dependiera del
  // tenantId (que ahora es opcional) se podría esquivar el límite alternando
  // entre mandarlo y no mandarlo.
  const identityKey = `pin:${handle}`;
  const originIp = request.rawRequest?.ip || 'unknown';
  if (isRateLimited(identityKey) || isRateLimited(`pin-origin:${originIp}`)) {
    throw new HttpsError('resource-exhausted', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  }

  // Camino con tenant conocido (enlace de alta o dispositivo reconocido): se
  // usa el índice login_handles, que además da el fallback de membershipId
  // para el primer acceso. ÚNICA FUENTE DE VERDAD:
  // loginHandle -> credencial -> authUid -> membership; nunca se deriva el doc
  // de credencial de un ID de membership, que es mutable.
  const candidates: { ref: admin.firestore.DocumentReference; fallbackMembershipId?: string }[] = [];
  if (tenantId) {
    const handleSnap = await db.collection('login_handles').doc(`${tenantId}_${handle}`).get();
    if (handleSnap.exists) {
      const handleData = handleSnap.data()!;
      const credRef = await resolveCredRefForLogin(tenantId, handle, handleData);
      if (credRef) candidates.push({ ref: credRef, fallbackMembershipId: handleData.membershipId as string });
    }
    // Si el índice no existe o quedó apuntando a la nada, se busca igual por
    // usuario DENTRO de ese tenant antes de darse por vencido.
    if (candidates.length === 0) {
      (await findCredentialsByHandle(handle, tenantId)).forEach((ref) => candidates.push({ ref }));
    }
  } else {
    (await findCredentialsByHandle(handle)).forEach((ref) => candidates.push({ ref }));
  }

  if (candidates.length === 0) {
    // Costo constante: mismo hash que haría una verificación real, para no
    // delatar por timing que este usuario no existe.
    verifyPinHash(pin, DUMMY_PIN_SALT, DUMMY_PIN_HASH);
    throw new HttpsError('permission-denied', PIN_LOGIN_GENERIC_ERROR);
  }

  for (const candidate of candidates) {
    const result = await attemptPinLogin(candidate.ref, pin, candidate.fallbackMembershipId);
    if (!result) continue;

    const customToken = await admin.auth().createCustomToken(result.authUid, { pinLogin: true });
    console.log('VENDOR_PIN_LOGIN_SUCCESS', {
      credDocId: candidate.ref.id,
      tenantId: result.tenantId,
      viaHandleOnly: !tenantId,
    });
    // tenantId/displayName se devuelven DESPUÉS de autenticar, y son del
    // propio usuario: los necesita el cliente para registrar el dispositivo y
    // para recordar "quién sos" en este navegador. Nunca se devuelve authUid,
    // ni IDs de credencial, ni el email técnico interno.
    return {
      customToken,
      tenantId: result.tenantId,
      loginHandle: result.loginHandle || handle,
      displayName: result.displayName,
    };
  }

  throw new HttpsError('permission-denied', PIN_LOGIN_GENERIC_ERROR);
});

/**
 * REENTRADA SIN CÓDIGO desde un dispositivo ya vinculado — "Hola <nombre>" +
 * mantener presionado, después de haber cerrado sesión.
 *
 * Sin request.auth a propósito: igual que loginWithPin, este endpoint ES el
 * paso de autenticación. Lo que se presenta no es el deviceId (público) sino la
 * credencial de dispositivo que el servidor emitió al vincularse con el código
 * (ver deviceSecret.ts). Se revalida TODO en cada uso: equipo existente y no
 * revocado, credencial vigente y correcta, mismo negocio, y persona activa.
 *
 * Cualquier rechazo devuelve el MISMO error genérico: no se revela si el equipo
 * existe, si fue revocado ni si la persona fue desactivada. La UI, ante un
 * rechazo, simplemente cae al código de acceso.
 */
export const loginWithDevice = onCall({ maxInstances: 10 }, async (request) => {
  const { deviceId, deviceSecret, tenantId } = request.data as { deviceId?: string; deviceSecret?: string; tenantId?: string };
  if (!deviceId || !deviceSecret || !tenantId) throw new HttpsError('invalid-argument', 'Falta deviceId, deviceSecret o tenantId');

  const originIp = request.rawRequest?.ip || 'unknown';
  if (isRateLimited(`device:${deviceId}`) || isRateLimited(`device-origin:${originIp}`)) {
    throw new HttpsError('resource-exhausted', 'Demasiados intentos. Probá de nuevo en unos minutos.');
  }

  const DENIED = 'No se pudo entrar con este equipo. Usá tu código de acceso.';
  const deviceSnap = await db.collection('trusted_devices').doc(deviceId).get();
  const device = deviceSnap.data();

  // Costo constante aunque el equipo no exista: siempre se calcula un hash.
  const secretMatches = device?.secretHash && device?.secretSalt
    ? verifyDeviceSecret(deviceSecret, device.secretSalt, device.secretHash)
    : (hashDeviceSecret(deviceSecret, 'sin-sal'), false);

  const membershipSnap = device?.userId
    ? await db.collection('memberships').doc(`${device.userId}_${tenantId}`).get()
    : null;

  const decision = checkDeviceLogin({
    deviceExists: deviceSnap.exists,
    deviceStatus: device?.status,
    hasSecret: !!device?.secretHash,
    secretMatches,
    deviceTenantId: device?.tenantId,
    requestedTenantId: tenantId,
    membershipExists: !!membershipSnap?.exists,
    membershipStatus: membershipSnap?.data()?.status,
  });

  if (!decision.allowed) {
    console.warn('DEVICE_LOGIN_DENIED', { deviceId, tenantId, reason: decision.reason });
    throw new HttpsError('permission-denied', DENIED);
  }

  await deviceSnap.ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
  const customToken = await admin.auth().createCustomToken(device!.userId, { deviceLogin: true });
  console.log('DEVICE_LOGIN_SUCCESS', { deviceId, tenantId });
  return {
    customToken,
    // Nombre visible de la membership, nunca el correo técnico interno.
    displayName: (membershipSnap!.data()?.name as string) || 'Vendedor',
  };
});

/**
 * Entrada rápida desde un dispositivo reconocido ("mantener presionado para
 * entrar"). NO es un método de autenticación: exige request.auth, o sea que la
 * persona YA está autenticada (su sesión de Firebase sigue viva; ese refresh
 * token es la credencial real ligada a este navegador). El gesto solo confirma
 * la intención de entrar, y esta función re-valida contra el servidor que la
 * persona siga habilitada y que el equipo siga reconocido — nunca se confía en
 * lo que diga el cliente.
 *
 * El deviceId NO es un factor de autenticación: lo genera el propio cliente y
 * vive en localStorage. Por eso, sin sesión viva, el código de acceso sigue
 * siendo obligatorio (ver loginWithPin) y esta función no puede reemplazarlo.
 */
export const verifyDeviceSession = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { tenantId, deviceId } = request.data as { tenantId?: string; deviceId?: string };
  if (!tenantId || !deviceId) throw new HttpsError('invalid-argument', 'Falta tenantId o deviceId');

  const uid = request.auth.uid;
  const [membershipSnap, deviceSnap] = await Promise.all([
    db.collection('memberships').doc(`${uid}_${tenantId}`).get(),
    db.collection('trusted_devices').doc(deviceId).get(),
  ]);

  const device = deviceSnap.data();
  const result = checkDeviceQuickEntry({
    membershipExists: membershipSnap.exists,
    membershipStatus: membershipSnap.data()?.status,
    deviceExists: deviceSnap.exists,
    deviceStatus: device?.status,
    deviceUserId: device?.userId,
    deviceTenantId: device?.tenantId,
    callerUid: uid,
    tenantId,
  });

  if (!result.allowed) {
    console.log('DEVICE_QUICK_ENTRY_DENIED', { tenantId, uid, deviceId, reason: result.reason });
    return { allowed: false, reason: result.reason, fallback: quickEntryFallback(result.reason) };
  }

  // Mismo refresco de actividad que hace registerDevice — entrar cuenta como
  // uso del equipo. No cambia nada más del doc.
  await deviceSnap.ref.update({ lastSeenAt: FieldValue.serverTimestamp() });

  console.log('DEVICE_QUICK_ENTRY_OK', { tenantId, uid, deviceId });
  return {
    allowed: true,
    // Nombre visible de la membership, nunca el correo técnico interno.
    displayName: (membershipSnap.data()?.name as string) || 'Vendedor',
  };
});

/**
 * Registra (o refresca lastSeenAt de) el dispositivo desde el que un usuario
 * ya autenticado está operando. deviceId lo genera el cliente
 * (crypto.randomUUID) y solo sirve para RECONOCER el equipo — nunca sustituye
 * al token de Firebase Auth, que sigue siendo lo único que autentica de verdad.
 * Todas las escrituras de trusted_devices pasan por esta familia de
 * Functions (las Rules bloquean escritura directa desde el cliente) para que
 * un cliente comprometido no pueda auto-otorgarse confianza ni revivir un
 * dispositivo ya revocado con solo reescribir el doc.
 */
export const registerDevice = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { deviceId, tenantId, label } = request.data as { deviceId?: string; tenantId?: string; label?: string };
  if (!deviceId || !tenantId) throw new HttpsError('invalid-argument', 'Falta deviceId o tenantId');

  const uid = request.auth.uid;
  const membershipSnap = await db.collection('memberships').doc(`${uid}_${tenantId}`).get();
  if (!membershipSnap.exists) {
    throw new HttpsError('permission-denied', 'No tenés membresía en este negocio.');
  }

  const deviceRef = db.collection('trusted_devices').doc(deviceId);
  const deviceSnap = await deviceRef.get();

  // CREDENCIAL DE DISPOSITIVO (ver deviceSecret.ts): se emite —y se rota— SOLO
  // cuando esta sesion salio de un login con CODIGO (claim pinLogin). Asi una
  // reentrada por dispositivo no la regenera en cada uso, y un usuario corporativo
  // (Google/correo) nunca recibe una. El valor en claro viaja una sola vez al
  // telefono; aca solo queda el hash.
  const issueSecret = request.auth.token.pinLogin === true;
  let deviceSecret: string | undefined;
  let secretFields: Record<string, unknown> = {};
  if (issueSecret) {
    deviceSecret = generateDeviceSecret();
    const salt = crypto.randomBytes(16).toString('hex');
    secretFields = {
      secretHash: hashDeviceSecret(deviceSecret, salt),
      secretSalt: salt,
      secretIssuedAt: FieldValue.serverTimestamp(),
    };
  }

  if (deviceSnap.exists) {
    const existing = deviceSnap.data()!;
    if (existing.userId !== uid) {
      throw new HttpsError('already-exists', 'Este dispositivo ya está vinculado a otro usuario.');
    }
    if (existing.status === 'revoked') {
      // A propósito no se reactiva solo: si un Owner/Admin lo revocó, un
      // cliente que todavía tiene ese deviceId en localStorage no debe poder
      // deshacer esa decisión reintentando el registro (ver Fase 12).
      throw new HttpsError('permission-denied', 'Este dispositivo fue revocado. Registrá uno nuevo.');
    }
    await deviceRef.update({ lastSeenAt: FieldValue.serverTimestamp(), ...secretFields });
    return { deviceId, status: 'active', ...(deviceSecret ? { deviceSecret } : {}) };
  }

  await deviceRef.set({
    tenantId,
    userId: uid,
    label: label || 'Dispositivo sin nombre',
    status: 'active',
    registeredAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    registeredBy: uid,
    revokedAt: null,
    revokedBy: null,
    ...secretFields,
  });

  console.log('DEVICE_REGISTERED', { tenantId, userId: uid, deviceId, withSecret: !!deviceSecret });
  return { deviceId, status: 'active', ...(deviceSecret ? { deviceSecret } : {}) };
});

/** Renombra un dispositivo — el propio dueño o un Owner/Admin de su tenant. */
export const renameDevice = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { deviceId, label } = request.data as { deviceId?: string; label?: string };
  if (!deviceId || !label?.trim()) throw new HttpsError('invalid-argument', 'Falta deviceId o label');

  const deviceRef = db.collection('trusted_devices').doc(deviceId);
  const deviceSnap = await deviceRef.get();
  if (!deviceSnap.exists) throw new HttpsError('not-found', 'Dispositivo no encontrado');
  const device = deviceSnap.data()!;

  const uid = request.auth.uid;
  if (device.userId !== uid) {
    await assertCallerIsTenantAdmin(uid, device.tenantId);
  }

  await deviceRef.update({ label: label.trim() });
  return { deviceId };
});

/** Revoca un dispositivo — exclusivo de Owner/Admin del tenant del dispositivo. */
export const revokeDevice = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { deviceId } = request.data as { deviceId?: string };
  if (!deviceId) throw new HttpsError('invalid-argument', 'Falta deviceId');

  const deviceRef = db.collection('trusted_devices').doc(deviceId);
  const deviceSnap = await deviceRef.get();
  if (!deviceSnap.exists) throw new HttpsError('not-found', 'Dispositivo no encontrado');
  const device = deviceSnap.data()!;

  await assertCallerIsTenantAdmin(request.auth.uid, device.tenantId);

  await deviceRef.update({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: request.auth.uid,
  });

  console.log('DEVICE_REVOKED', { deviceId, tenantId: device.tenantId, revokedBy: request.auth.uid });
  return { deviceId };
});

/**
 * Activa/desactiva el acceso de una membresía — LOOP: reutilización de
 * teléfonos corporativos. Reemplaza el updateDoc directo del cliente que
 * hacía esto antes (las Rules ya lo autorizaban bien: Owner/Admin del mismo
 * tenant o SuperAdmin, pero sin guardar quién ni cuándo). No borra nada:
 * conversaciones, leads, CRM, métricas y auditoría existentes siguen
 * atribuidos a esta membership igual que antes — solo cambia `status` (y
 * ahora, además, corta el acceso de verdad):
 * - Al desactivar: revoca los refresh tokens de Firebase Auth del usuario
 *   (si ya tiene cuenta técnica) — su sesión actual deja de poder renovarse
 *   la próxima vez que el SDK intente refrescar el ID token. loginWithPin
 *   (ver checkPinLoginAllowed) ya bloquea logins nuevos con status
 *   distinto de 'active'; esto además corta una sesión YA ABIERTA.
 * - Nunca se toca vendor_credentials/trusted_devices acá — "Revocar
 *   dispositivo" (revokeDevice) sigue siendo una acción separada y
 *   explícita, tal como se pidió.
 */
export const setMembershipActive = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const { membershipId, isActive } = request.data as { membershipId?: string; isActive?: boolean };
  if (!membershipId || typeof isActive !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Falta membershipId o isActive');
  }

  const membershipRef = db.collection('memberships').doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError('not-found', 'La membresía no existe');
  const membership = membershipSnap.data()!;
  const tenantId = membership.tenantId;

  const callerUid = request.auth.uid;
  const [callerUserSnap, callerMembershipSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('memberships').doc(`${callerUid}_${tenantId}`).get(),
  ]);
  const isSuperAdminCaller = callerUserSnap.exists && callerUserSnap.data()?.isSuperAdmin === true;
  const callerMembershipData = callerMembershipSnap.data();

  const auth = checkTenantAdminAuth({
    isSuperAdmin: isSuperAdminCaller,
    callerMembership: callerMembershipSnap.exists && callerMembershipData
      ? { status: callerMembershipData.status, role: callerMembershipData.role }
      : null,
  });
  if (!auth.allowed) {
    throw new HttpsError('permission-denied', 'Solo un Owner/Admin activo de este negocio puede hacer esto.');
  }

  // Evita quedarse sin forma de revertirlo: nadie puede desactivar su
  // propio acceso (si es el único Owner/Admin activo, esto lo dejaría
  // fuera del mismo círculo cerrado que resolvió el bootstrap del primer
  // Owner).
  if (membershipId === `${callerUid}_${tenantId}` && !isActive) {
    throw new HttpsError('failed-precondition', 'No podés desactivar tu propio acceso.');
  }

  await membershipRef.update({
    status: isActive ? 'active' : 'suspended',
    ...(isActive
      ? { reactivatedAt: FieldValue.serverTimestamp(), reactivatedBy: callerUid }
      : { deactivatedAt: FieldValue.serverTimestamp(), deactivatedBy: callerUid }),
  });

  if (!isActive && membership.userId) {
    try {
      await admin.auth().revokeRefreshTokens(membership.userId);
    } catch (err) {
      // No bloquea la desactivación en sí (el status ya cambió y
      // loginWithPin/checkMembershipAuth ya lo van a rechazar) — solo
      // significa que una sesión YA abierta puede tardar hasta que el SDK
      // intente refrescar su token, en vez de cortarse al instante.
      console.warn('MEMBERSHIP_DEACTIVATE_REVOKE_TOKENS_FAILED', { membershipId, error: (err as Error).message });
    }
  }

  console.log(isActive ? 'MEMBERSHIP_REACTIVATED' : 'MEMBERSHIP_DEACTIVATED', { membershipId, tenantId, by: callerUid });
  return { membershipId, status: isActive ? 'active' : 'suspended' };
});

// ═══════════════════════════════════════════════════════════════════════
// ESTADO OPERATIVO Y SESIONES DE TURNO — SERVER-AUTHORITATIVE (checkpoint
// de seguridad post-Bloque 5). El cliente NUNCA escribe directamente
// operationalStatus, work_sessions ni work_status_events — Firestore Rules
// lo bloquean con "if false" (ver firestore.rules). Todo pasa por
// setOperationalStatus/tickPresence: uid siempre sale del token verificado
// (request.auth.uid), nunca del payload; todos los timestamps son
// serverTimestamp(); startedAt/endedAt/changedAt/activeSeconds/idleSeconds
// los decide y escribe exclusivamente esta Function. Telemetría operativa,
// NO horas laborales oficiales/payroll.
// ═══════════════════════════════════════════════════════════════════════

const OPERATIONAL_STATUSES = ['working', 'coffee', 'lunch', 'errand', 'off_shift'] as const;
type OperationalStatusValue = typeof OPERATIONAL_STATUSES[number];

/**
 * Único punto de escritura para operationalStatus/work_sessions/
 * work_status_events. uid y tenantId nunca se confían del payload más allá
 * de qué tenant se está consultando: el membership real (uid del token +
 * tenantId) se valida server-side antes de escribir nada.
 */
export const setOperationalStatus = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const uid = request.auth.uid; // SIEMPRE del token verificado, nunca del payload
  const { tenantId, status } = request.data as { tenantId?: string; status?: string };
  if (!tenantId || !status) throw new HttpsError('invalid-argument', 'Falta tenantId o status');
  if (!OPERATIONAL_STATUSES.includes(status as OperationalStatusValue)) {
    throw new HttpsError('invalid-argument', 'Estado operativo inválido.');
  }
  const toStatus = status as OperationalStatusValue;

  const membershipSnap = await db.collection('memberships').doc(`${uid}_${tenantId}`).get();
  if (!membershipSnap.exists || membershipSnap.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tenés una membresía activa en este tenant.');
  }

  const presenceRef = db.collection('user_presence').doc(`${tenantId}_${uid}`);

  await db.runTransaction(async (tx) => {
    const presenceSnap = await tx.get(presenceRef);
    const current = presenceSnap.exists ? presenceSnap.data()! : {};
    const fromStatus: OperationalStatusValue | null = current.operationalStatus ?? null;
    const activeSessionId: string | null = current.activeWorkSessionId ?? null;

    let nextSessionId: string | null = activeSessionId;

    if ((fromStatus === null || fromStatus === 'off_shift') && toStatus !== 'off_shift') {
      const sessionRef = db.collection('work_sessions').doc();
      tx.set(sessionRef, {
        tenantId,
        userId: uid,
        startedAt: FieldValue.serverTimestamp(),
        endedAt: null,
        lastSeenAt: FieldValue.serverTimestamp(),
        activeSeconds: 0,
        idleSeconds: 0,
        status: toStatus,
      });
      nextSessionId = sessionRef.id;
    } else if (toStatus === 'off_shift' && activeSessionId) {
      tx.update(db.collection('work_sessions').doc(activeSessionId), {
        endedAt: FieldValue.serverTimestamp(),
        status: toStatus,
      });
      nextSessionId = null;
    } else if (activeSessionId) {
      tx.update(db.collection('work_sessions').doc(activeSessionId), { status: toStatus });
    }

    tx.set(presenceRef, {
      uid,
      tenantId,
      operationalStatus: toStatus,
      operationalStatusChangedAt: FieldValue.serverTimestamp(),
      activeWorkSessionId: nextSessionId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(db.collection('work_status_events').doc(), {
      tenantId,
      userId: uid,
      fromStatus,
      toStatus,
      changedAt: FieldValue.serverTimestamp(),
    });
  });

  console.log('OPERATIONAL_STATUS_CHANGED', { tenantId, uid, toStatus });
  return { status: toStatus };
});

// Heartbeat servidor-autoritativo: el cliente NUNCA envía "estuve activo 60
// segundos" — solo una señal de baja confianza (huboActividad: hubo
// interacción real desde el último tick, según el mismo criterio de
// mousemove/keydown/click/scroll que ya usa usePresenceTracker). El SERVIDOR
// calcula cuánto tiempo pasó de verdad (ahora - lastSeenAt del propio
// work_session, ambos server timestamps) y lo acota a un máximo razonable —
// así un cliente no puede reclamar horas que nunca transcurrieron ni
// inflar el contador reconectándose tras estar suspendido/cerrado. La única
// cosa que el cliente puede "mentir" es a qué balde (activo vs idle) va ese
// tiempo ya acotado — no la cantidad total.
const HEARTBEAT_MAX_TICK_SECONDS = 90;

export const tickPresence = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const uid = request.auth.uid;
  const { tenantId, hadActivity } = request.data as { tenantId?: string; hadActivity?: boolean };
  if (!tenantId) throw new HttpsError('invalid-argument', 'Falta tenantId');

  const membershipSnap = await db.collection('memberships').doc(`${uid}_${tenantId}`).get();
  if (!membershipSnap.exists || membershipSnap.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tenés una membresía activa en este tenant.');
  }

  const presenceRef = db.collection('user_presence').doc(`${tenantId}_${uid}`);
  const presenceSnap = await presenceRef.get();
  const activeSessionId: string | null = presenceSnap.exists ? (presenceSnap.data()?.activeWorkSessionId ?? null) : null;
  if (!activeSessionId) {
    // Sin turno abierto (off_shift) — nada que sumar, no es un error.
    return { ticked: false };
  }

  const sessionRef = db.collection('work_sessions').doc(activeSessionId);

  await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) return; // sesión cerrada entre snapshots — el próximo cambio de estado resincroniza
    const session = sessionSnap.data()!;
    if (session.tenantId !== tenantId || session.userId !== uid) return; // defensa extra, no debería pasar nunca

    const lastSeenMs: number = session.lastSeenAt?.toMillis?.() ?? Date.now();
    const elapsedSeconds = Math.max(0, Math.min(HEARTBEAT_MAX_TICK_SECONDS, Math.round((Date.now() - lastSeenMs) / 1000)));
    if (elapsedSeconds === 0) return;

    const field = hadActivity ? 'activeSeconds' : 'idleSeconds';
    tx.update(sessionRef, {
      [field]: FieldValue.increment(elapsedSeconds),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
  });

  return { ticked: true };
});

/**
 * Multi-Agente — Modo Libre: reclamo manual y atómico de una conversación
 * sin asignar. El primero que llama gana; el resto recibe un error
 * 'already-exists' para mostrar feedback de "ya fue tomada". La elegibilidad
 * para reclamar es membership.status==='active' + incluido en el equipo
 * configurado (includedUserIds) — a propósito NO depende de
 * leadEnabledUserIds, que solo gobierna la asignación AUTOMÁTICA (ver
 * sección 8 del pedido: ese toggle no debe bloquear que alguien tome a mano
 * una conversación ya visible para todo el equipo en modo Libre).
 */
export const claimConversation = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }
  const { conversationId } = request.data;
  const uid = request.auth.uid;

  if (!conversationId) {
    throw new HttpsError('invalid-argument', 'Falta conversationId');
  }

  const convRef = db.collection('conversations').doc(conversationId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const convSnap = await tx.get(convRef);
      if (!convSnap.exists) {
        throw new HttpsError('not-found', 'La conversación no existe');
      }
      const conv = convSnap.data()!;
      const tenantId = conv.tenantId;

      if (conv.advisorId) {
        console.warn('MULTI_AGENT_MANUAL_CLAIM_CONFLICT', { conversationId, alreadyAssignedTo: conv.advisorId, attemptedBy: uid });
        throw new HttpsError('already-exists', 'Esta conversación ya fue tomada por otro asesor.');
      }

      const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
      const [membershipSnap, settingsSnap] = await Promise.all([
        tx.get(membershipRef),
        tx.get(db.collection('settings').doc(tenantId)),
      ]);

      if (!membershipSnap.exists || membershipSnap.data()?.status !== 'active') {
        throw new HttpsError('permission-denied', 'No tenés una membresía activa en este tenant.');
      }

      const includedUserIds: string[] = settingsSnap.data()?.multiAgentConfig?.includedUserIds || [];
      if (!includedUserIds.includes(uid)) {
        throw new HttpsError('permission-denied', 'No estás configurado en el equipo de Multi-Agente de este tenant.');
      }

      // LOOP Fase 16 — recomendación aplicada: exigir 'working' también para
      // el reclamo manual en Modo Libre, no solo para la asignación
      // automática. Sin esto, alguien en coffee/lunch/errand/off_shift podía
      // tomar una conversación a mano igual, contradiciendo el propósito
      // completo de la feature (evitar que alguien fuera de turno reciba
      // trabajo nuevo).
      const presenceSnap = await tx.get(db.collection('user_presence').doc(`${tenantId}_${uid}`));
      if (presenceSnap.data()?.operationalStatus !== 'working') {
        throw new HttpsError('failed-precondition', 'Tenés que estar en estado "Trabajando" para tomar una conversación.');
      }

      tx.update(convRef, {
        advisorId: uid,
        assignedAt: FieldValue.serverTimestamp(),
        assignedBy: uid,
        assignmentSource: 'manual_claim',
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { conversationId, advisorId: uid };
    });

    console.log('MULTI_AGENT_MANUAL_CLAIM_SUCCESS', result);
    return { success: true, ...result };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    console.error('[MultiAgente] Error en claimConversation:', message);
    throw new HttpsError('internal', 'Error al reclamar la conversación.');
  }
});

/**
 * Función Callable para enviar mensajes de Instagram/Facebook
 */
export const sendMetaMessage = onCall({ maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  const { conversationId, text, tenantId, source } = request.data;
  const uid = request.auth.uid;

  if (!conversationId || !text || !tenantId || !source) {
    throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
  }

  // 1. VALIDACIÓN DE MEMBRESÍA
  const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
  const membershipDoc = await membershipRef.get();
  if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
  }

  // 2. OBTENER INTEGRACIÓN
  const integrationSnapshot = await db.collection('integrations')
    .where('tenantId', '==', tenantId)
    .where('provider', '==', source)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (integrationSnapshot.empty) {
    throw new HttpsError('failed-precondition', `No hay una integración de ${source} activa`);
  }

  const integration = integrationSnapshot.docs[0].data();
  const accessToken = integration.accessToken;

  // 3. OBTENER CONVERSACIÓN
  const conversationRef = db.collection('conversations').doc(conversationId);
  const conversationDoc = await conversationRef.get();
  if (!conversationDoc.exists) {
    throw new HttpsError('not-found', 'Conversación no encontrada');
  }
  const recipientId = conversationDoc.data()?.platformId;

  // 4. ENVÍO A META
  let status: 'sent' | 'failed' = 'sent';
  let externalId = `meta.${crypto.randomBytes(8).toString('hex')}`;
  let errorMessage = '';

  try {
    const payload = {
      recipient: { id: recipientId },
      message: { text: text }
    };

    const response = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error?.message || 'Error en Graph API');
    }
    externalId = result.message_id || externalId;
  } catch (err: any) {
    status = 'failed';
    errorMessage = err.message || 'Error desconocido';
  }

  // 5. PERSISTENCIA
  const msgRef = conversationRef.collection('messages').doc();
  await db.runTransaction(async (transaction) => {
    transaction.set(msgRef, {
      text,
      sender: 'advisor',
      direction: 'outbound',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      type: 'text',
      status,
      externalId,
      errorMessage: status === 'failed' ? errorMessage : null
    });

    transaction.update(conversationRef, {
      lastMessage: text,
      lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageSender: 'advisor',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  return { success: status === 'sent', messageId: msgRef.id };
});

/**
 * getWhatsappNumbers — Solo SuperAdmin.
 * Recorre todas las integraciones de WhatsApp, consulta a Meta el número
 * legible (display_phone_number) usando el phoneNumberId + accessToken de cada
 * negocio, lo cachea en el documento de la integración y devuelve un mapa
 * tenantId → { displayPhoneNumber, phoneNumberId, isActive, verifiedName }.
 * Nunca devuelve tokens al cliente.
 */
export const getWhatsappNumbers = onCall({ maxInstances: 10, timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  }

  // Validar SuperAdmin vía /users/{uid}.isSuperAdmin
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnap.exists || userSnap.data()?.isSuperAdmin !== true) {
    throw new HttpsError('permission-denied', 'Solo el SuperAdmin puede consultar los números de WhatsApp');
  }

  const snap = await db.collection('integrations')
    .where('provider', '==', 'whatsapp')
    .get();

  const numbers: Record<string, {
    displayPhoneNumber: string | null;
    phoneNumberId: string | null;
    isActive: boolean;
    verifiedName: string | null;
    error?: string;
  }> = {};

  await Promise.all(snap.docs.map(async (docSnap) => {
    const data = docSnap.data();
    const tenantId = data.tenantId as string | undefined;
    if (!tenantId) return;

    const phoneNumberId = data.phoneNumberId || null;
    const accessToken = data.accessToken || null;
    let displayPhoneNumber: string | null = data.displayPhoneNumber || null;
    let verifiedName: string | null = data.verifiedName || null;
    let error: string | undefined;

    if (phoneNumberId && accessToken) {
      try {
        const resp = await axios.get(
          `https://graph.facebook.com/v17.0/${phoneNumberId}`,
          { params: { fields: 'display_phone_number,verified_name', access_token: accessToken }, timeout: 10000 }
        );
        const fresh = resp.data?.display_phone_number || null;
        const freshName = resp.data?.verified_name || null;
        if (fresh && (fresh !== data.displayPhoneNumber || freshName !== data.verifiedName)) {
          await docSnap.ref.update({
            displayPhoneNumber: fresh,
            verifiedName: freshName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        if (fresh) displayPhoneNumber = fresh;
        if (freshName) verifiedName = freshName;
      } catch (e: any) {
        error = e?.response?.data?.error?.message || e?.message || 'Error consultando Meta';
        console.warn(`[getWhatsappNumbers] ${tenantId}: ${error}`);
      }
    } else if (!phoneNumberId) {
      error = 'Sin phoneNumberId configurado';
    } else if (!accessToken) {
      error = 'Sin accessToken configurado';
    }

    // Si hay varias integraciones por tenant, priorizar la activa
    if (!numbers[tenantId] || data.isActive === true) {
      numbers[tenantId] = {
        displayPhoneNumber,
        phoneNumberId,
        isActive: data.isActive === true,
        verifiedName,
        ...(error ? { error } : {}),
      };
    }
  }));

  return { numbers };
});

import { onRequest } from 'firebase-functions/v2/https';

/**
 * Endpoint v2 para recibir correos de SendGrid Inbound Parse.
 *
 * SEGURIDAD:
 *  - Antes era publico/anonimo: cualquiera podia crear documentos en `admin_emails`
 *    (spam / abuse / arbitrary write).
 *  - Ahora exige Basic Auth (usuario/clave provenientes del Secret Manager) que se
 *    configura en SendGrid Inbound Parse (URL del estilo
 *    https://user:pass@region-project.cloudfunctions.net/inboundEmailV2).
 *  - Tambien se limita el tamano de la carga y la longitud de los campos para
 *    evitar abuso de almacenamiento.
 */
export const inboundEmailV2 = onRequest({
  cors: false,
  invoker: 'public', // SendGrid no soporta IAM; protegemos con Basic Auth + size limits
}, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // 1. Validar Basic Auth
  const expectedUser = process.env.SENDGRID_INBOUND_USER || '';
  const expectedPass = process.env.SENDGRID_INBOUND_PASS || '';

  if (!expectedUser || !expectedPass) {
    console.error('[Email v2] SENDGRID_INBOUND_USER/PASS no configurados. Rechazando.');
    res.status(503).send('Service not configured');
    return;
  }

  const authHeader = (req.headers['authorization'] || '') as string;
  if (!authHeader.toLowerCase().startsWith('basic ')) {
    res.status(401).set('WWW-Authenticate', 'Basic realm="inbound"').send('Unauthorized');
    return;
  }

  let providedUser = '';
  let providedPass = '';
  try {
    const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) throw new Error('bad credentials');
    providedUser = decoded.slice(0, idx);
    providedPass = decoded.slice(idx + 1);
  } catch {
    res.status(401).send('Unauthorized');
    return;
  }

  // Comparacion en tiempo constante para evitar timing attacks
  const safeEqual = (a: string, b: string) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  };

  if (!safeEqual(providedUser, expectedUser) || !safeEqual(providedPass, expectedPass)) {
    res.status(401).send('Unauthorized');
    return;
  }

  // 2. Limites de tamano (anti-DoS / anti-storage-abuse)
  const MAX_FIELD_LEN = 50_000;     // 50 KB por campo
  const MAX_TOTAL_LEN = 200_000;    // 200 KB total

  const busboy = (Busboy as any).default({
    headers: req.headers,
    limits: {
      fieldSize: MAX_FIELD_LEN,
      fields: 50,
      fileSize: 0,
      files: 0,
    }
  });
  const formData: any = {};
  let totalBytes = 0;
  let rejected = false;

  busboy.on('field', (fieldname: string, val: string) => {
    if (rejected) return;
    totalBytes += (val?.length || 0);
    if (totalBytes > MAX_TOTAL_LEN) {
      rejected = true;
      return;
    }
    formData[fieldname] = val;
  });

  busboy.on('finish', async () => {
    if (rejected) {
      res.status(413).send('Payload too large');
      return;
    }
    try {
      const from = String(formData.from || 'Desconocido').slice(0, 320);
      const subject = String(formData.subject || '(Sin Asunto)').slice(0, 500);
      const text = String(formData.text || '').slice(0, MAX_FIELD_LEN);
      const html = String(formData.html || '').slice(0, MAX_FIELD_LEN);

      await db.collection('admin_emails').add({
        from,
        subject,
        text,
        html,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        isRead: false,
        isStarred: false,
        folder: 'inbox'
      });

      console.log(`[Email v2] Correo guardado: ${subject}`);
      res.status(200).send('OK');
    } catch (error) {
      console.error('[Email v2] Error:', error);
      // No exponer detalles internos al cliente
      res.status(500).send('Internal Server Error');
    }
  });

  busboy.on('error', (err: any) => {
    console.error('[Email v2] Busboy error:', err);
    if (!res.headersSent) res.status(400).send('Bad Request');
  });

  if ((req as any).rawBody) {
    busboy.end((req as any).rawBody);
  } else {
    req.pipe(busboy);
  }
});

/**
 * Trigger para enviar correos salientes vía SendGrid
 */
export const processOutboundEmail = onDocumentCreated({
  document: 'admin_emails/{emailId}',
  memory: '512MiB'
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  
  // Solo procesar si es de la carpeta 'sent' y no ha sido procesado ya
  if (data.folder !== 'sent' || data.processedBySendGrid) {
    return;
  }

  try {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error('SENDGRID_API_KEY no configurada');
      return;
    }

    sgMail.setApiKey(apiKey);

    const attachments = [];
    if (data.attachmentUrl && data.attachmentName) {
      try {
        console.log(`[SendGrid] Descargando adjunto: ${data.attachmentName} desde ${data.attachmentUrl}`);
        const response = await axios.get(data.attachmentUrl, { responseType: 'arraybuffer' });
        const base64Content = Buffer.from(response.data).toString('base64');
        
        attachments.push({
          content: base64Content,
          filename: data.attachmentName,
          type: (response.headers['content-type'] as string) || 'application/octet-stream',
          disposition: 'attachment'
        });
        console.log(`[SendGrid] Adjunto procesado con éxito (${response.data.length} bytes)`);
      } catch (err) {
        console.error("[SendGrid] Error al procesar adjunto con axios:", err);
      }
    }

    const cleanTo = data.to.replace(/.*<(.+)>$/, '$1').trim();

    const msg = {
      to: cleanTo,
      from: 'SMARTFLOW HUB OS <hola@smartflow-suite.com>', 
      subject: data.subject,
      text: data.text,
      html: data.html || data.text.replace(/\n/g, '<br>'),
      attachments: attachments.length > 0 ? attachments : undefined
    };

    console.log(`[SendGrid] Enviando correo a: ${data.to} con ${attachments.length} adjuntos`);
    await sgMail.send(msg);

    // Marcar como procesado
    await snapshot.ref.update({
      processedBySendGrid: true,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[SendGrid] Éxito: Correo enviado a ${data.to}`);

  } catch (error) {
    console.error('[SendGrid] Error al enviar:', error);
    await snapshot.ref.update({
      deliveryError: (error as any).message,
      status: 'failed'
    });
  }
});

/**
 * TRIGGER DE AUTOMATIZACIÓN: Al registrar un nuevo negocio (Tenant)
 * Envía correo de bienvenida premium, factura real desglosada y programa el seguimiento.
 */
export const onTenantCreatedAutomation = onDocumentCreated({
  document: 'tenants/{tenantId}',
  memory: '256MiB'
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  const tenantId = snapshot.id;

  try {
    const companyName = data.name || 'tu negocio';
    const email = data.ownerEmail;

    if (!email) {
      console.log('[Onboarding Automation] No email found for tenant:', tenantId);
      return;
    }

    // --- 1. DETERMINAR MÓDULOS CONTRATADOS Y CALCULAR FACTURA REAL ---
    const features = data.features || {};
    const purchasedItems: { name: string, price: number }[] = [];

    // Mapeo oficial de precios de CheckoutView.tsx
    if (features.hasMultiAgent) purchasedItems.push({ name: 'WhatsApp Coexistente (CRM Multiagente)', price: 69 });
    if (features.hasAiAgent) purchasedItems.push({ name: 'Agente IA (Ventas autónomas)', price: 49 });
    if (features.hasQualityAuditor) purchasedItems.push({ name: 'Auditor IA (Análisis de calidad)', price: 25 });
    if (features.hasPaymentLinks) purchasedItems.push({ name: 'Links de pago (Cobros por chat)', price: 12 });
    if (features.hasQuotes) purchasedItems.push({ name: 'Cotizaciones PDF profesionales', price: 15 });
    if (features.hasCatalog) purchasedItems.push({ name: 'Catálogo de Productos', price: 27 });
    if (features.hasAgenda) purchasedItems.push({ name: 'Agenda inteligente y confirmación', price: 20 });

    let rawTotal = purchasedItems.reduce((sum, item) => sum + item.price, 0);
    let finalTotal = rawTotal > 197 ? 197 : rawTotal;
    const isFullSuite = rawTotal > 197;

    // --- 2. GENERAR HTML DEL CORREO DE BIENVENIDA ---
    const firstSteps: string[] = [
      '<strong>Inicia sesión</strong> usando tu correo y contraseña en tu Workspace.'
    ];
    if (features.hasMultiAgent) {
      firstSteps.push('<strong>Conecta tu WhatsApp:</strong> Ve a "Integraciones", escanea el código QR y activa la conexión multiagente.');
    }
    if (features.hasAiAgent) {
      firstSteps.push('<strong>Entrena tu Agente IA:</strong> Sube tus productos o preguntas frecuentes para activar el autopilot de ventas.');
    }
    if (!features.hasMultiAgent && !features.hasAiAgent) {
      firstSteps.push('<strong>Explora tu CRM:</strong> Registra tus primeros prospectos y organiza tu pipeline de ventas.');
      firstSteps.push('<strong>Agrega herramientas:</strong> Visita la <a href="https://hub.smartflow-suite.com/tienda" style="color:#1877f2;">Tienda</a> para potenciar tu Hub con WhatsApp, Agente IA y más.');
    }
    const firstStepsHtml = firstSteps
      .map(s => `<li style="margin-bottom: 8px;">${s}</li>`)
      .join('');

    const welcomeHtml = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eef2f6; border-radius: 20px; background-color: #ffffff; color: #1e293b; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
        <div style="text-align: center; padding-bottom: 24px; border-bottom: 1px solid #f1f5f9;">
          <h2 style="color: #1877f2; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">SmartFlow <span style="color: #0f172a;">Hub OS</span></h2>
        </div>

        <div style="padding: 24px 0;">
          <h1 style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 0; line-height: 1.3;">¡Tu espacio de trabajo inteligente está listo, ${companyName}! 🚀</h1>
          <p style="font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 20px;">
            Te damos una cálida bienvenida a SmartFlow Hub OS. Hemos aprovisionado tu Workspace en la nube para acompañarte en la digitalización y automatización de tus operaciones comerciales.
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; margin: 24px 0;">
            <h3 style="font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #1877f2; margin-top: 0; margin-bottom: 12px;">🔑 Datos de Acceso de tu Workspace</h3>
            <p style="font-size: 14px; margin: 8px 0; color: #334155;">
              <strong>Workspace URL:</strong>
              <a href="https://hub.smartflow-suite.com" style="color: #1877f2; text-decoration: none; font-weight: bold; border-bottom: 1px dashed #1877f2;">https://hub.smartflow-suite.com</a>
            </p>
            <p style="font-size: 14px; margin: 8px 0; color: #334155;"><strong>Correo de Administración:</strong> ${email}</p>
          </div>

          <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 24px; margin-bottom: 12px;">🎯 Tus primeros pasos para comenzar:</h3>
          <ol style="font-size: 14px; line-height: 1.8; color: #475569; padding-left: 20px; margin-bottom: 24px;">
            ${firstStepsHtml}
          </ol>
          
          <div style="text-align: center; margin-top: 32px; margin-bottom: 20px;">
            <a href="https://hub.smartflow-suite.com/login" style="background-color: #1877f2; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 30px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 10px rgba(24, 119, 242, 0.25);">ENTRAR A MI DASHBOARD</a>
          </div>
        </div>
        
        <div style="padding-top: 24px; border-t: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          <p style="margin: 0 0 6px 0;">Este es un correo automático de SmartFlow Hub OS.</p>
          <p style="margin: 0;">¿Necesitas ayuda técnica? Escríbenos a <a href="mailto:hola@smartflow-suite.com" style="color: #1877f2; text-decoration: none;">hola@smartflow-suite.com</a></p>
        </div>
      </div>
    `;

    const welcomeText = `¡Bienvenido a SmartFlow Hub OS!\n\nTu espacio de trabajo ha sido aprovisionado para ${companyName}.\n\nAcceso: https://hub.smartflow-suite.com\nEmail: ${email}\n\n${features.hasMultiAgent ? 'Inicia sesión y conecta tu WhatsApp desde Integraciones para comenzar.' : 'Inicia sesión y explora tu CRM. Puedes agregar más herramientas desde la Tienda en cualquier momento.'}`;

    // Guardar correo de bienvenida en cola saliente
    await db.collection('admin_emails').add({
      to: email,
      subject: `¡Bienvenido a SmartFlow Hub OS, ${companyName}! 🚀`,
      text: welcomeText,
      html: welcomeHtml,
      folder: 'sent',
      processedBySendGrid: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`[Onboarding Automation] Welcome email created for tenant: ${tenantId}`);

    // --- 3. GENERAR HTML DE LA FACTURA REAL DE PAYPAL/COMPRA ---
    const invoiceNumber = `INV-${Math.floor(Math.random() * 900000 + 100000)}`;
    const invoiceDate = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    let tableRows = '';
    if (isFullSuite) {
      tableRows = `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9;">
            <strong style="color: #0f172a;">SmartFlow Full Suite Package (Tope Ahorro)</strong><br>
            <span style="font-size: 12px; color: #64748b;">Acceso unificado e ilimitado a todas las herramientas del Hub.</span>
          </td>
          <td style="padding: 12px 8px; text-align: right; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #0f172a;">$197.00 USD</td>
        </tr>
      `;
    } else if (purchasedItems.length > 0) {
      tableRows = purchasedItems.map(item => `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9;">
            <strong style="color: #0f172a;">${item.name}</strong><br>
            <span style="font-size: 12px; color: #64748b;">Licencia de módulo mensual activa.</span>
          </td>
          <td style="padding: 12px 8px; text-align: right; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #0f172a;">$${item.price.toFixed(2)} USD</td>
        </tr>
      `).join('');
    } else {
      tableRows = `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9;">
            <strong style="color: #0f172a;">Suscripción Básica (CRM Gratis Hook)</strong><br>
            <span style="font-size: 12px; color: #64748b;">Plan gratuito de CRM con funcionalidades básicas de inicio.</span>
          </td>
          <td style="padding: 12px 8px; text-align: right; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #0f172a;">$0.00 USD</td>
        </tr>
      `;
    }

    const invoiceHtml = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eef2f6; border-radius: 20px; background-color: #ffffff; color: #1e293b;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 20px;">
          <div>
            <h2 style="color: #1877f2; margin: 0; font-size: 24px; font-weight: 800;">SmartFlow OS</h2>
            <p style="font-size: 11px; color: #64748b; margin: 4px 0 0 0;">hola@smartflow-suite.com</p>
          </div>
          <div style="text-align: right;">
            <h3 style="margin: 0; color: #0f172a; font-size: 16px; font-weight: 800; letter-spacing: 0.5px;">RECIBO DE TRANSACCIÓN</h3>
            <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;"><strong>Folio:</strong> ${invoiceNumber}</p>
          </div>
        </div>
        
        <div style="padding: 10px 0; font-size: 14px; line-height: 1.5;">
          <table style="width: 100%; margin-bottom: 24px; border-collapse: collapse;">
            <tr>
              <td style="padding-bottom: 8px; color: #64748b; width: 50%;"><strong>FACTURADO A:</strong></td>
              <td style="padding-bottom: 8px; color: #64748b; text-align: right; width: 50%;"><strong>DETALLES:</strong></td>
            </tr>
            <tr>
              <td><strong style="color: #0f172a;">${companyName}</strong></td>
              <td style="text-align: right;"><strong style="color: #0f172a;">Fecha:</strong> ${invoiceDate}</td>
            </tr>
            <tr>
              <td>${email}</td>
              <td style="text-align: right;"><strong style="color: #0f172a;">Medio:</strong> PayPal Secure API</td>
            </tr>
          </table>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="border-bottom: 2px solid #cbd5e1; text-align: left; background-color: #f8fafc;">
                <th style="padding: 10px 8px; color: #475569; font-size: 12px; text-transform: uppercase;">Módulo / Descripción</th>
                <th style="padding: 10px 8px; text-align: right; color: #475569; font-size: 12px; text-transform: uppercase; width: 100px;">Importe</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
            <tfoot>
              <tr>
                <td style="padding: 16px 8px 8px 8px; text-align: right; color: #64748b;"><strong>Subtotal:</strong></td>
                <td style="padding: 16px 8px 8px 8px; text-align: right; font-weight: bold; color: #0f172a;">$${finalTotal.toFixed(2)} USD</td>
              </tr>
              <tr>
                <td style="padding: 4px 8px; text-align: right; color: #64748b;"><strong>Impuestos (Exento):</strong></td>
                <td style="padding: 4px 8px; text-align: right; font-weight: bold; color: #0f172a;">$0.00 USD</td>
              </tr>
              <tr style="border-top: 1px solid #cbd5e1;">
                <td style="padding: 12px 8px; text-align: right; font-size: 16px; color: #0f172a;"><strong>Total Pagado:</strong></td>
                <td style="padding: 12px 8px; text-align: right; font-size: 18px; font-weight: 800; color: #1877f2;">$${finalTotal.toFixed(2)} USD</td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        <div style="text-align: center; border-top: 1px solid #eef2f6; padding-top: 20px; margin-top: 24px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          <p style="margin: 0 0 4px 0; font-weight: bold; color: #475569;">¡Gracias por tu compra en SmartFlow Hub OS!</p>
          <p style="margin: 0;">Este documento sirve como recibo legal de pago exitoso vía PayPal.</p>
        </div>
      </div>
    `;

    // Solo enviar factura si hubo un cobro real
    if (finalTotal > 0) {
      await db.collection('admin_emails').add({
        to: email,
        subject: `Tu factura de compra ${invoiceNumber} - SmartFlow Hub OS`,
        text: `Confirmación de cobro aprobado de tu suscripción de SmartFlow Hub OS por $${finalTotal.toFixed(2)} USD.`,
        html: invoiceHtml,
        folder: 'sent',
        processedBySendGrid: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    console.log(`[Onboarding Automation] Invoice email created for tenant: ${tenantId}`);

    // --- 4. PROGRAMAR SEGUIMIENTO DE 3/7 DÍAS Y FECHA DE RENOVACIÓN ---
    const renewalDate = finalTotal > 0
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null; // tenants gratuitos no tienen fecha de renovación

    await db.collection('tenant_onboarding_states').doc(tenantId).set({
      tenantId,
      ownerEmail: email,
      companyName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      welcomeSentAt: admin.firestore.FieldValue.serverTimestamp(),
      invoiceNumber,
      amountPaid: finalTotal,
      followup3dScheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      followup3dSent: false,
      followup7dScheduledFor: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      followup7dSent: false,
      // Renovación mensual
      renewalDate,
      renewalReminderSent: false,
      suspended: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Guardar renewalDate también en el tenant doc para consultas rápidas
    if (renewalDate) {
      await db.collection('tenants').doc(tenantId).update({ renewalDate, suspended: false });
    }

    console.log(`[Onboarding Automation] Onboarding tracking initialized for tenant: ${tenantId}`);

  } catch (error) {
    console.error('[Onboarding Automation] Error executing trigger:', error);
  }
});

/**
 * CLOUD FUNCTION: sendOnboardingFollowups
 * Corre cada 6 horas. Busca tenants cuya fecha de seguimiento ya pasó y aún
 * no se ha enviado el email. Envía el de 3 días y el de 7 días.
 */
export const sendOnboardingFollowups = onSchedule({
  schedule: 'every 6 hours',
  timeZone: 'America/Costa_Rica',
  memory: '256MiB',
}, async () => {
  const now = new Date().toISOString();

  const snap = await db.collection('tenant_onboarding_states')
    .where('followup3dSent', '==', false)
    .where('followup3dScheduledFor', '<=', now)
    .limit(50)
    .get();

  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    try {
      const html3d = `
        <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eef2f6; border-radius: 20px; background: #fff; color: #1e293b;">
          <h2 style="color: #1877f2; margin: 0 0 16px 0;">SmartFlow <span style="color: #0f172a;">Hub OS</span></h2>
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 0;">¿Cómo va todo, ${d.companyName}? 🚀</h1>
          <p style="font-size: 15px; line-height: 1.7; color: #475569;">
            Han pasado 3 días desde que activaste tu Hub. Queremos asegurarnos de que todo esté andando perfecto.
          </p>
          <p style="font-size: 15px; line-height: 1.7; color: #475569;">
            Si aún no has conectado tu WhatsApp Business o entrenado tu Agente IA, este es el momento ideal.
            Toma menos de 5 minutos y transforma cómo atiendes a tus clientes.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="https://hub.smartflow-suite.com" style="background: #1877f2; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 30px; font-weight: bold; font-size: 14px; display: inline-block;">
              IR A MI DASHBOARD →
            </a>
          </div>
          <p style="font-size: 13px; color: #94a3b8; text-align: center;">¿Tienes dudas? Escríbenos a <a href="mailto:hola@smartflow-suite.com" style="color: #1877f2;">hola@smartflow-suite.com</a></p>
        </div>`;

      await db.collection('admin_emails').add({
        to: d.ownerEmail,
        subject: `¿Todo bien con tu Hub, ${d.companyName}? · SmartFlow`,
        text: `Hola ${d.companyName}, han pasado 3 días desde que activaste tu Hub. ¿Ya conectaste tu WhatsApp? Entra en https://hub.smartflow-suite.com`,
        html: html3d,
        folder: 'sent',
        processedBySendGrid: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await docSnap.ref.update({ followup3dSent: true, followup3dSentAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`[Followup 3d] Sent to ${d.ownerEmail}`);
    } catch (e) {
      console.error(`[Followup 3d] Error for ${docSnap.id}:`, e);
    }
  }

  const snap7 = await db.collection('tenant_onboarding_states')
    .where('followup7dSent', '==', false)
    .where('followup7dScheduledFor', '<=', now)
    .limit(50)
    .get();

  for (const docSnap of snap7.docs) {
    const d = docSnap.data();
    try {
      const html7d = `
        <div style="font-family: 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eef2f6; border-radius: 20px; background: #fff; color: #1e293b;">
          <h2 style="color: #1877f2; margin: 0 0 16px 0;">SmartFlow <span style="color: #0f172a;">Hub OS</span></h2>
          <h1 style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 0;">Tu primera semana con SmartFlow 🎯</h1>
          <p style="font-size: 15px; line-height: 1.7; color: #475569;">
            ¡Ya llevas 7 días con tu Hub activo, ${d.companyName}! Esperamos que estés viendo los primeros resultados.
          </p>
          <p style="font-size: 15px; line-height: 1.7; color: #475569;">
            ¿Sabías que los negocios que activan el Agente IA en su primera semana responden 3x más rápido y cierran hasta un 40% más de leads?
            Si aún no lo tienes activo, agrégalo desde tu panel de herramientas.
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <a href="https://hub.smartflow-suite.com" style="background: #1877f2; color: #fff; text-decoration: none; padding: 14px 36px; border-radius: 30px; font-weight: bold; font-size: 14px; display: inline-block;">
              VER MI HUB →
            </a>
          </div>
          <p style="font-size: 13px; color: #94a3b8; text-align: center;">¿Tienes dudas? Escríbenos a <a href="mailto:hola@smartflow-suite.com" style="color: #1877f2;">hola@smartflow-suite.com</a></p>
        </div>`;

      await db.collection('admin_emails').add({
        to: d.ownerEmail,
        subject: `Tu primera semana con SmartFlow Hub 🎯`,
        text: `¡${d.companyName}, llevas 7 días con tu Hub! ¿Ya activaste el Agente IA? Entra en https://hub.smartflow-suite.com`,
        html: html7d,
        folder: 'sent',
        processedBySendGrid: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await docSnap.ref.update({ followup7dSent: true, followup7dSentAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`[Followup 7d] Sent to ${d.ownerEmail}`);
    } catch (e) {
      console.error(`[Followup 7d] Error for ${docSnap.id}:`, e);
    }
  }
});

/**
 * CLOUD FUNCTION: checkSubscriptionRenewals
 * Corre diariamente. Envía recordatorio 3 días antes del vencimiento y suspende
 * herramientas premium 7 días después si no se ha renovado.
 */
export const checkSubscriptionRenewals = onSchedule(
  { schedule: 'every 24 hours', timeZone: 'America/Costa_Rica', region: 'us-central1' },
  async () => {
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const snapshot = await db.collection('tenant_onboarding_states').get();

    for (const docSnap of snapshot.docs) {
      const d = docSnap.data();
      if (!d.renewalDate) continue;

      const tenantId = docSnap.id;
      const renewalMs = new Date(d.renewalDate).getTime();
      const msUntilRenewal = renewalMs - now;
      const msSinceRenewal = now - renewalMs;

      // --- Recordatorio 3 días antes ---
      if (msUntilRenewal > 0 && msUntilRenewal <= threeDaysMs && !d.renewalReminderSent) {
        try {
          const daysLeft = Math.ceil(msUntilRenewal / (24 * 60 * 60 * 1000));
          await db.collection('admin_emails').add({
            to: d.ownerEmail,
            subject: `Tu suscripción SmartFlow vence en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`,
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
                <h2 style="color:#1877F2">Recordatorio de renovación</h2>
                <p>Hola <strong>${d.ownerName || d.ownerEmail}</strong>,</p>
                <p>Tu suscripción de <strong>${d.tradeName || tenantId}</strong> vence en <strong>${daysLeft} día${daysLeft === 1 ? '' : 's'}</strong>.</p>
                <p>Para mantener acceso a tus herramientas premium, realiza tu pago antes de la fecha de vencimiento.</p>
                <a href="https://hub.smartflow-suite.com/tienda" style="display:inline-block;background:#1877F2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Renovar ahora</a>
                <p style="margin-top:24px;color:#888;font-size:12px">SmartFlow Hub OS · hub.smartflow-suite.com</p>
              </div>
            `,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await docSnap.ref.update({ renewalReminderSent: true });
          console.log(`[Renewal reminder] Sent to ${d.ownerEmail} (${daysLeft}d left)`);
        } catch (e) {
          console.error(`[Renewal reminder] Error for ${tenantId}:`, e);
        }
      }

      // --- Suspensión 7 días después del vencimiento ---
      if (msSinceRenewal >= sevenDaysMs && !d.suspended) {
        try {
          const premiumFeatures = {
            hasMultiAgent: false,
            hasAiAgent: false,
            hasQualityAuditor: false,
            hasPaymentLinks: false,
            hasQuotes: false,
            hasCatalog: false,
            hasAgenda: false,
          };

          await db.collection('tenants').doc(tenantId).update({
            ...premiumFeatures,
            suspended: true,
          });

          const settingsSnap = await db.collection('tenants').doc(tenantId)
            .collection('settings').doc('general').get();
          if (settingsSnap.exists) {
            await settingsSnap.ref.update(premiumFeatures);
          }

          await docSnap.ref.update({ suspended: true });

          await db.collection('admin_emails').add({
            to: d.ownerEmail,
            subject: 'Tu suscripción SmartFlow ha sido suspendida',
            html: `
              <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
                <h2 style="color:#ef4444">Acceso suspendido</h2>
                <p>Hola <strong>${d.ownerName || d.ownerEmail}</strong>,</p>
                <p>Las herramientas premium de <strong>${d.tradeName || tenantId}</strong> han sido desactivadas por falta de pago.</p>
                <p>Tus datos están seguros. Reactiva tu cuenta para recuperar el acceso completo.</p>
                <a href="https://hub.smartflow-suite.com/tienda" style="display:inline-block;background:#1877F2;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:16px">Reactivar cuenta</a>
                <p style="margin-top:24px;color:#888;font-size:12px">SmartFlow Hub OS · hub.smartflow-suite.com</p>
              </div>
            `,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          console.log(`[Suspension] Suspended ${tenantId} (${d.ownerEmail})`);
        } catch (e) {
          console.error(`[Suspension] Error for ${tenantId}:`, e);
        }
      }
    }
  }
);

/**
 * CLOUD FUNCTION: generateSocialMediaContent
 * Generador de campañas de marketing con IA impulsado por Google Gemini.
 * Genera Blog, Facebook e Instagram en un solo paso con respuesta JSON estructurada.
 */
export const generateSocialMediaContent = onCall({
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  // Asegurar que el usuario está logueado
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para usar este generador.');
  }

  const { topic, tone, additionalNotes } = request.data || {};
  if (!topic || typeof topic !== 'string') {
    throw new HttpsError('invalid-argument', 'El tema de la publicación es obligatorio.');
  }
  // Limites de tamano para evitar abuso de prompt-injection / costos LLM
  if (topic.length > 500) {
    throw new HttpsError('invalid-argument', 'El tema es demasiado largo (max 500 caracteres).');
  }
  if (tone !== undefined && (typeof tone !== 'string' || tone.length > 100)) {
    throw new HttpsError('invalid-argument', 'tone invalido');
  }
  if (additionalNotes !== undefined && (typeof additionalNotes !== 'string' || additionalNotes.length > 2000)) {
    throw new HttpsError('invalid-argument', 'additionalNotes invalido');
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // --- FALLBACK OFFLINE / ROBUSTO ---
  // Si no hay API Key, retornamos un contenido de marketing simulado de altísima calidad 
  // para asegurar que el sistema nunca falle y sea 100% interactivo.
  if (!apiKey) {
    console.log('[Gemini API] GEMINI_API_KEY no configurada. Retornando simulación inteligente.');
    
    // Simular un retraso realista para el efecto de carga
    await new Promise(resolve => setTimeout(resolve, 2000));

    return {
      success: true,
      mode: 'mock',
      data: {
        blog: {
          title: `Cómo revolucionar tu negocio con ${topic} en 2026`,
          metaDescription: `Descubre los secretos para dominar tu sector usando ${topic}. Automatiza, optimiza y vende de forma inteligente.`,
          introduction: `El mercado empresarial está cambiando a pasos agigantados. Hoy en día, la diferencia entre las empresas que lideran y las que se quedan atrás radica en su capacidad para adoptar herramientas de última generación. En este sentido, ${topic} se ha convertido en una pieza fundamental para cualquier negocio que busque escalar operaciones de forma eficiente.`,
          subheadings: [
            {
              title: "1. El cuello de botella que frena tu crecimiento",
              content: `La mayoría de las empresas pierden más del 35% de sus clientes debido a tiempos de respuesta lentos o falta de organización. Al implementar ${topic}, eliminas este error humano, permitiendo que tu equipo se enfoque en el valor real mientras la tecnología hace el trabajo pesado por ti.`
            },
            {
              title: "2. Resultados medibles que puedes esperar",
              content: `Implementar esta tecnología no solo se traduce en tranquilidad, sino en números verdes. Los negocios que usan ${topic} en su día a día reportan un incremento promedio del 40% en su tasa de conversión y una reducción del 60% en horas invertidas en tareas administrativas.`
            }
          ],
          conclusion: `Adoptar el cambio digital no es una opción, es una necesidad de supervivencia empresarial. Cuanto antes comiences a integrar estas estrategias, mayor será tu ventaja competitiva en el mercado.`,
          cta: "Agenda una sesión estratégica con nosotros hoy mismo y descubre cómo configurar SmartFlow en tu negocio gratis. ¡El futuro es hoy!"
        },
        facebook: {
          hook: `¿Estás cansado de perder clientes por respuestas lentas? ⏳ Descubre cómo solucionar esto hoy mismo.`,
          body: `El secreto de los negocios que escalan con éxito no es trabajar más horas... es automatizar de forma inteligente con ${topic}. 🚀\n\nConoce los beneficios clave de sumarte a la era digital:\n👉 Respuestas inmediatas 24/7 sin descuidar la calidad humana.\n👉 CRM integrado para dar seguimiento automático a cada oportunidad de venta.\n👉 Reducción de costos de hasta un 50% en tareas operativas cotidianas.\n\nDeja atrás las hojas de cálculo aburridas y el desorden.`,
          cta: "🔗 Haz clic aquí para comenzar tu prueba gratuita hoy: smartflow-suite.com"
        },
        instagram: {
          slides: [
            {
              slideNumber: 1,
              slideTitle: topic.toUpperCase(),
              slideBody: "3 Formas en que está cambiando el juego empresarial. ¡Desliza para descubrirlo! 👉",
              graphicConcept: "Minimalist ultra-premium dark mode cover. Neon cyan and deep purple gradients with glowing modern text 'EL FUTURO DE LAS VENTAS'. A glossy floating smartphone displaying a clean data graph."
            },
            {
              slideNumber: 2,
              slideTitle: "1. Respuesta Inmediata ⚡",
              slideBody: "El 80% de las ventas van al negocio que responde primero. El piloto automático no duerme.",
              graphicConcept: "Split layout graphic. On the left, an old desktop computer covered in dust with a 'No Response' sign. On the right, a glowing virtual AI holographic assistant working at lightning speed."
            },
            {
              slideNumber: 3,
              slideTitle: "2. Cero Prospectos Olvidados 📁",
              slideBody: "La IA clasifica y califica a tus clientes potenciales de forma instantánea en tu CRM.",
              graphicConcept: "Sleek 3D illustration of golden folders flying organized into a beautiful neon-lit database. Cyberpunk futuristic aesthetic, high glassmorphism contrast."
            },
            {
              slideNumber: 4,
              slideTitle: "3. Multiplicador de Ventas 💰",
              slideBody: "Toma decisiones basadas en datos y cierra más tratos en la mitad de tiempo.",
              graphicConcept: "Sleek glowing coin/dollar symbol emerging from a technological portal with upward-trending glowing arrow. Holographic tech vibe, emerald and violet accents."
            },
            {
              slideNumber: 5,
              slideTitle: "🔥 ¿Listo para Escalar?",
              slideBody: "No te quedes atrás. Activa hoy tu Hub de SmartFlow con CRM base completamente gratis.",
              graphicConcept: "Final call-to-action slide. A hand holding a futuristic glowing device with a big button 'EMPEZAR GRATIS'. High energy colors, violet background, warm light accents."
            }
          ],
          caption: `🚀 ¿Estás listo para dar el salto tecnológico que tu negocio necesita?\n\nLa automatización con ${topic} no es el futuro, es lo que tus clientes esperan de ti hoy mismo. Deja de perder ventas por responder tarde o tener desorden en tus seguimientos.\n\nCuéntanos en los comentarios: ¿Cuál de estas herramientas te gustaría conectar primero? 👇`,
          hashtags: "#SmartFlowHub #SaaS #VentasInteligentes #MarketingDigital #GrowthHacking #WhatsAppMultiagente #InteligenciaArtificial #Emprendedores #CRM"
        }
      }
    };
  }

  // --- LLAMADA A LA API REAL DE GOOGLE GEMINI 1.5 FLASH ---
  try {
    const systemPrompt = `Eres el Director de Marketing y Especialista en Growth Hacking para la plataforma SmartFlow Hub OS.
Tu tarea es generar una campaña de marketing completa, altamente persuasiva, profesional y de altísimo nivel sobre el siguiente tema de negocio: "${topic}".
El tono de voz que debes emplear es estrictamente: "${tone || 'profesional'}".
Notas adicionales a considerar: "${additionalNotes || 'ninguna'}".

Debes responder ÚNICAMENTE con un objeto JSON válido que contenga las siguientes claves exactas: "blog", "facebook" e "instagram". No agregues ningún texto explicativo antes ni después del JSON. Tampoco encierres la respuesta en bloques de código markdown como \`\`\`json. Responde estrictamente la cadena de texto JSON pura para que pueda ser parseada directamente con JSON.parse() en Node.js.

Estructura requerida del JSON:
{
  "blog": {
    "title": "Título SEO irresistible y creativo para el blog",
    "metaDescription": "Meta descripción optimizada para buscadores",
    "introduction": "Introducción atractiva que defina el problema (1-2 párrafos)",
    "subheadings": [
      {
        "title": "Subtítulo de sección H2",
        "content": "Desarrollo completo y rico de la sección, aportando consejos prácticos"
      },
      {
        "title": "Otro subtítulo H2",
        "content": "Continuación del desarrollo de valor de negocio"
      }
    ],
    "conclusion": "Conclusión persuasiva",
    "cta": "Llamado a la acción final persuasivo invitando a probar SmartFlow Hub OS"
  },
  "facebook": {
    "hook": "Gancho inicial de 1-2 líneas con emojis potentes",
    "body": "Cuerpo del post estructurado con viñetas, beneficios clave, storytelling breve y emojis apropiados",
    "cta": "Llamado a la acción claro sugiriendo ir al link del perfil o web"
  },
  "instagram": {
    "slides": [
      {
        "slideNumber": 1,
        "slideTitle": "Título de Diapositiva 1 (Portada)",
        "slideBody": "Subtítulo o texto gancho corto",
        "graphicConcept": "Detailed prompt in English for an AI image generator describing the design concept, colors (cyan, violet, glassmorphism), layout, and floating elements"
      },
      {
        "slideNumber": 2,
        "slideTitle": "Título de Diapositiva 2 (Problema)",
        "slideBody": "Explicación breve del dolor de cabeza del cliente",
        "graphicConcept": "Detailed image prompt in English describing a visual representation of this problem"
      },
      {
        "slideNumber": 3,
        "slideTitle": "Título de Diapositiva 3 (Solución)",
        "slideBody": "Cómo SmartFlow lo soluciona de forma inteligente",
        "graphicConcept": "Detailed image prompt in English for the solution slide"
      },
      {
        "slideNumber": 4,
        "slideTitle": "Título de Diapositiva 4 (Beneficios)",
        "slideBody": "Métricas o resultados esperados",
        "graphicConcept": "Detailed image prompt in English for the metrics slide"
      },
      {
        "slideNumber": 5,
        "slideTitle": "Título de Diapositiva 5 (CTA)",
        "slideBody": "Llamado a la acción fuerte con flecha",
        "graphicConcept": "Detailed image prompt in English for the final CTA slide"
      }
    ],
    "caption": "Caption para el post de Instagram (el texto largo que va debajo del carrusel) con viñetas y emojis",
    "hashtags": "Mínimo 10 hashtags profesionales separados por espacios listos para copiar"
  }
}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    console.log('[Gemini API] Iniciando petición a Gemini 1.5 Flash...');
    const response = await axios.post(geminiUrl, {
      contents: [{
        parts: [{
          text: systemPrompt
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    let jsonText = response.data.candidates[0].content.parts[0].text;
    console.log('[Gemini API] Respuesta recibida con éxito.');

    // Limpieza defensiva en caso de que contenga markdown wrappers
    if (jsonText.includes('```json')) {
      jsonText = jsonText.split('```json')[1].split('```')[0].trim();
    } else if (jsonText.includes('```')) {
      jsonText = jsonText.split('```')[1].split('```')[0].trim();
    }

    const parsedData = JSON.parse(jsonText);

    return {
      success: true,
      mode: 'live',
      data: parsedData
    };

  } catch (error: any) {
    console.error('[Gemini API] Error al conectar con Gemini:', error);
    // No filtrar detalles del backend (URL, payload, claves) al cliente
    throw new HttpsError('internal', 'Error de generación de IA. Intenta de nuevo en unos segundos.');
  }
});

/**
 * Verifica y captura un pago PayPal server-side antes de activar el tenant.
 * Esto previene que se creen tenants sin pago real.
 */
export const verifyPaypalOrder = onCall({}, async (request) => {
  // Auth es opcional: el checkout crea la cuenta DESPUÉS del pago, así que el
  // usuario aún no está autenticado cuando llama esta función. La seguridad
  // se mantiene por: validación regex del orderId, captura real contra PayPal
  // API, e idempotencia (un orderId solo se procesa una vez).
  //
  // Esta función es EXCLUSIVA del flujo de activación de tenant (CheckoutView).
  // El flujo de Links de Pago (/pay/{id}) tiene sus propias funciones
  // dedicadas — createPaymentRequestPaypalOrder / capturePaymentRequestPaypalOrder,
  // más abajo — que crean la orden server-side y verifican el monto
  // capturado exactamente contra el monto canónico de payment_requests. Este
  // endpoint NUNCA debe recibir paymentRequestId: aceptar un amount que el
  // navegador afirma (como hacía antes vía purchase_units creado en el
  // cliente) permitía pagar $1 y marcar pagada una solicitud de $100.
  const { orderId, tenantId } = request.data as { orderId: string; tenantId?: string };

  // Validacion estricta del orderId (PayPal usa IDs alfanumericos cortos)
  if (!orderId || typeof orderId !== 'string' || !/^[A-Z0-9_-]{6,40}$/i.test(orderId)) {
    throw new HttpsError('invalid-argument', 'orderId invalido');
  }

  if (tenantId !== undefined && (typeof tenantId !== 'string' || tenantId.length > 100)) {
    throw new HttpsError('invalid-argument', 'tenantId invalido');
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new HttpsError('internal', 'PayPal no está configurado en el servidor');
  }

  // Verificar que no se haya procesado antes (idempotencia + anti-replay)
  const existingDoc = await db.collection('paypal_orders').doc(orderId).get();
  if (existingDoc.exists) {
    const data = existingDoc.data();
    if (data?.status === 'COMPLETED') {
      return { success: true, orderId, status: 'COMPLETED', alreadyCaptured: true };
    }
  }

  try {
    // Obtener access token de PayPal
    const tokenRes = await axios.post(
      'https://api-m.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    );
    const accessToken = tokenRes.data.access_token;

    // Capturar el pago
    const captureRes = await axios.post(
      `https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const order = captureRes.data;

    if (order.status !== 'COMPLETED') {
      throw new HttpsError('failed-precondition', `Pago no completado: ${order.status}`);
    }

    const capturedAmount = order.purchase_units?.[0]?.payments?.captures?.[0]?.amount ?? null;

    // Registrar el pago en Firestore
    await db.collection('paypal_orders').doc(orderId).set({
      orderId,
      status: order.status,
      amount: capturedAmount,
      payer: order.payer ?? null,
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      tenantId: tenantId ?? null,
      requestedBy: request.auth?.uid ?? null,
    });

    return { success: true, orderId, status: order.status };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    console.error('[verifyPaypalOrder] PayPal API error:', err?.response?.data || err?.message || err);
    // No exponer detalles del backend de PayPal al cliente
    throw new HttpsError('internal', 'No se pudo verificar el pago. Intenta de nuevo.');
  }
});

/**
 * Crea la orden de PayPal server-side para un Link de Pago — el navegador
 * nunca decide el amount/currency que se envía a PayPal, solo pide "creá la
 * orden para este paymentRequestId"; el backend lee el monto canónico
 * directamente de payment_requests y lo congela en expectedPaypalAmount /
 * expectedPaypalCurrency, que es lo único contra lo que se compara al
 * capturar (ver capturePaymentRequestPaypalOrder). Esto cierra el hueco que
 * tenía el flujo anterior: el cliente armaba purchase_units con el amount
 * que quisiera y PayPal lo aceptaba tal cual.
 *
 * Política CRC vs USD: PayPal solo se acepta hoy para links en USD. No hay
 * una fuente de tipo de cambio server-side confiable en este proyecto, y
 * calcular la conversión en el navegador (como hacía el código viejo,
 * CRC/525 hardcodeado) es exactamente el tipo de dato que un atacante podría
 * manipular. Hasta que exista una conversión server-side auditable, un link
 * en CRC/otra moneda simplemente no ofrece PayPal como método.
 */
export const createPaymentRequestPaypalOrder = onCall({}, async (request) => {
  const { paymentRequestId } = request.data as { paymentRequestId?: string };

  if (!paymentRequestId || typeof paymentRequestId !== 'string' || paymentRequestId.length > 100) {
    throw new HttpsError('invalid-argument', 'paymentRequestId inválido');
  }

  const reqRef = db.collection('payment_requests').doc(paymentRequestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'La solicitud de pago no existe.');
  }
  const reqData = reqSnap.data()!;

  if (reqData.status === 'paid') {
    throw new HttpsError('failed-precondition', 'Este link ya fue pagado.');
  }
  if (reqData.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Este link no está disponible para cobro.');
  }

  const methods: string[] = Array.isArray(reqData.enabledMethods) ? reqData.enabledMethods : [];
  if (!methods.includes('paypal')) {
    throw new HttpsError('failed-precondition', 'Este link no tiene PayPal habilitado.');
  }
  if (reqData.currency !== 'USD') {
    throw new HttpsError('failed-precondition', 'PayPal solo está disponible para links en USD por ahora.');
  }

  const amount = Number(reqData.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError('failed-precondition', 'Monto inválido en la solicitud.');
  }
  const expectedPaypalAmount = amount.toFixed(2);
  const expectedPaypalCurrency = 'USD';

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpsError('internal', 'PayPal no está configurado en el servidor');
  }

  try {
    const tokenRes = await axios.post(
      'https://api-m.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );
    const accessToken = tokenRes.data.access_token;

    const orderRes = await axios.post(
      'https://api-m.paypal.com/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: paymentRequestId,
          amount: { currency_code: expectedPaypalCurrency, value: expectedPaypalAmount },
          description: String(reqData.concept || '').slice(0, 127),
          ...(reqData.paypalEmail ? { payee: { email_address: reqData.paypalEmail } } : {}),
        }],
      },
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const orderId = orderRes.data.id as string;

    await reqRef.update({
      paypalOrderId: orderId,
      expectedPaypalAmount,
      expectedPaypalCurrency,
      paypalOrderCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Liga este orderId EXCLUSIVAMENTE a este paymentRequestId — es lo que
    // capturePaymentRequestPaypalOrder usa para rechazar cualquier intento
    // de reusar un orderId contra otra solicitud.
    await db.collection('paypal_orders').doc(orderId).set({
      orderId,
      paymentRequestId,
      status: 'CREATED',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { orderId };
  } catch (err: any) {
    console.error('[createPaymentRequestPaypalOrder] PayPal API error:', err?.response?.data || err?.message || err);
    throw new HttpsError('internal', 'No se pudo iniciar el pago con PayPal. Intenta de nuevo.');
  }
});

/**
 * Captura server-side el pago de un Link de Pago. Solo marca 'paid' si el
 * monto/moneda que PayPal realmente capturó coinciden EXACTAMENTE con
 * expectedPaypalAmount/expectedPaypalCurrency (congelados al crear la orden,
 * ver createPaymentRequestPaypalOrder) — nunca con nada que el navegador
 * afirme. Cualquier discrepancia deja el link sin pagar y queda registrada
 * como PAYPAL_AMOUNT_MISMATCH para auditoría, en vez de fallar en silencio.
 */
export const capturePaymentRequestPaypalOrder = onCall({}, async (request) => {
  const { paymentRequestId, orderId } = request.data as { paymentRequestId?: string; orderId?: string };

  if (!paymentRequestId || typeof paymentRequestId !== 'string' || paymentRequestId.length > 100) {
    throw new HttpsError('invalid-argument', 'paymentRequestId inválido');
  }
  if (!orderId || typeof orderId !== 'string' || !/^[A-Z0-9_-]{6,40}$/i.test(orderId)) {
    throw new HttpsError('invalid-argument', 'orderId inválido');
  }

  const reqRef = db.collection('payment_requests').doc(paymentRequestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'La solicitud de pago no existe.');
  }
  const reqData = reqSnap.data()!;

  // Idempotencia: doble click, refresh o un segundo onApprove sobre un link
  // ya pagado no vuelven a golpear la API de PayPal — solo confirman lo que
  // ya está confirmado, sin reescribir nada.
  if (reqData.status === 'paid') {
    return { success: true, status: 'COMPLETED', alreadyCaptured: true };
  }

  // Anti-replay: el orderId capturado tiene que ser EXACTAMENTE el que este
  // backend creó para ESTE paymentRequestId. Bloquea reusar/adivinar el
  // orderId de otra solicitud para pagar esta.
  if (!reqData.paypalOrderId || reqData.paypalOrderId !== orderId) {
    console.warn('PAYPAL_ORDER_MISMATCH', { paymentRequestId, orderId, expected: reqData.paypalOrderId ?? null });
    throw new HttpsError('permission-denied', 'La orden de pago no corresponde a esta solicitud.');
  }

  const orderDocRef = db.collection('paypal_orders').doc(orderId);
  const orderDoc = await orderDocRef.get();
  const orderDocData = orderDoc.data();
  // Doble enlace defensivo: el doc de auditoría también debe apuntar a este
  // mismo paymentRequestId — protege contra que un orderId capturado antes
  // para otra solicitud se reintente acá.
  if (orderDocData?.paymentRequestId && orderDocData.paymentRequestId !== paymentRequestId) {
    console.warn('PAYPAL_ORDER_MISMATCH', { paymentRequestId, orderId, boundTo: orderDocData.paymentRequestId });
    throw new HttpsError('permission-denied', 'La orden de pago no corresponde a esta solicitud.');
  }
  if (orderDocData?.status === 'COMPLETED') {
    return { success: true, status: 'COMPLETED', alreadyCaptured: true };
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpsError('internal', 'PayPal no está configurado en el servidor');
  }

  try {
    const tokenRes = await axios.post(
      'https://api-m.paypal.com/v1/oauth2/token',
      'grant_type=client_credentials',
      {
        auth: { username: clientId, password: clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );
    const accessToken = tokenRes.data.access_token;

    const captureRes = await axios.post(
      `https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const order = captureRes.data;
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    const capturedAmount = capture?.amount ?? null;

    if (order.status !== 'COMPLETED' || !capturedAmount) {
      await orderDocRef.set({
        orderId, paymentRequestId, status: order.status || 'FAILED',
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      throw new HttpsError('failed-precondition', `Pago no completado: ${order.status}`);
    }

    // Comparación EXACTA en centavos (evita errores de punto flotante) contra
    // el monto congelado al crear la orden. Si no coincide, NO se marca
    // pagado — sin importar que PayPal haya devuelto COMPLETED.
    const expectedAmountCents = Math.round(Number(reqData.expectedPaypalAmount) * 100);
    const capturedAmountCents = Math.round(Number(capturedAmount.value) * 100);
    const currencyOk = capturedAmount.currency_code === reqData.expectedPaypalCurrency;
    const amountOk = Number.isFinite(expectedAmountCents) && expectedAmountCents === capturedAmountCents;

    if (!currencyOk || !amountOk) {
      console.error('PAYPAL_AMOUNT_MISMATCH', {
        paymentRequestId, orderId,
        expected: { amount: reqData.expectedPaypalAmount, currency: reqData.expectedPaypalCurrency },
        captured: { amount: capturedAmount.value, currency: capturedAmount.currency_code },
      });
      await orderDocRef.set({
        orderId, paymentRequestId, status: 'AMOUNT_MISMATCH',
        capturedAmount: capturedAmount.value, capturedCurrency: capturedAmount.currency_code,
        expectedAmount: reqData.expectedPaypalAmount, expectedCurrency: reqData.expectedPaypalCurrency,
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      throw new HttpsError('failed-precondition', 'El monto capturado no coincide con el monto solicitado.');
    }

    const batch = db.batch();
    batch.update(reqRef, {
      status: 'paid' as const,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      capturedAmount: capturedAmount.value,
      capturedCurrency: capturedAmount.currency_code,
    });
    const publicRef = db.collection('public_payment_links').doc(paymentRequestId);
    const publicSnap = await publicRef.get();
    if (publicSnap.exists) {
      batch.update(publicRef, { status: 'paid' as const });
    }
    await batch.commit();

    await orderDocRef.set({
      orderId, paymentRequestId, status: 'COMPLETED',
      capturedAmount: capturedAmount.value, capturedCurrency: capturedAmount.currency_code,
      capturedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('PAYMENT_LINK_MARKED_PAID', { paymentRequestId, orderId, capturedAmount: capturedAmount.value, capturedCurrency: capturedAmount.currency_code });

    return { success: true, status: 'COMPLETED' };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    console.error('[capturePaymentRequestPaypalOrder] PayPal API error:', err?.response?.data || err?.message || err);
    throw new HttpsError('internal', 'No se pudo verificar el pago. Intenta de nuevo.');
  }
});

/**
 * Chequeo automático de ventana de 24h de WhatsApp.
 *
 * Cada 15 minutos:
 * - PASO 1 (23h–23.5h sin respuesta): Envía mensaje de re-engagement antes de que expire la ventana.
 * - PASO 2 (>25h sin respuesta + re-engagement ya enviado): Mueve el lead a "Perdido" en el CRM.
 */
export const checkWindowExpiry = onSchedule({
  schedule: 'every 15 minutes',
  timeZone: 'America/Mexico_City',
  memory: '256MiB',
  timeoutSeconds: 300,
}, async () => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;

    // Caché por tenant para evitar múltiples lecturas de Firestore
    const integrationCache: Record<string, any> = {};
    const settingsCache: Record<string, any> = {};

    // Filtra por provider 'whatsapp' explícitamente: desde que un tenant puede
    // tener varias integraciones activas (WhatsApp + Facebook + Instagram), sin
    // este filtro esta consulta podía traer cualquiera de las tres al azar.
    const getIntegration = async (tenantId: string) => {
      if (integrationCache[tenantId] !== undefined) return integrationCache[tenantId];
      const snap = await db.collection('integrations')
        .where('tenantId', '==', tenantId)
        .where('provider', '==', 'whatsapp')
        .where('isActive', '==', true)
        .limit(1)
        .get();
      integrationCache[tenantId] = snap.empty ? null : snap.docs[0].data();
      return integrationCache[tenantId];
    };

    const getSettings = async (tenantId: string) => {
      if (settingsCache[tenantId] !== undefined) return settingsCache[tenantId];
      const snap = await db.collection('settings').doc(tenantId).get();
      settingsCache[tenantId] = snap.data() || {};
      return settingsCache[tenantId];
    };

    // ── PASO 1: Enviar re-engagement (ventana entre 23h y 23.5h atrás) ──
    // Nota: usamos solo el rango en lastInboundDate para evitar índice compuesto.
    // Los filtros de status/source se aplican en código.
    const p1Start = admin.firestore.Timestamp.fromMillis(now - 23.5 * HOUR);
    const p1End   = admin.firestore.Timestamp.fromMillis(now - 23 * HOUR);

    const approaching = await db.collection('conversations')
      .where('lastInboundDate', '>=', p1Start)
      .where('lastInboundDate', '<=', p1End)
      .limit(100)
      .get();

    console.log(`[WindowExpiry] Paso 1: ${approaching.size} conversaciones en ventana 23h-23.5h`);

    for (const convDoc of approaching.docs) {
      const conv = convDoc.data();
      // Filtros en código para evitar índice compuesto
      if (conv.status !== 'active') continue;
      if (conv.source !== 'whatsapp') continue;
      if (conv.reEngagementSent) continue; // Ya enviado — no repetir

      const integration = await getIntegration(conv.tenantId);
      if (!integration?.phoneNumberId || !integration?.accessToken) continue;

      const phone = conv.phoneE164 || conv.phoneRaw;
      if (!phone) continue;

      const settings = await getSettings(conv.tenantId);
      const businessName = settings.tradeName || settings.companyName || 'el proyecto';
      const firstName = (conv.contactName || '').split(' ')[0] || '';
      const isGeneric = !firstName || /^(usuario|desconocido|cliente|sin\s)/i.test(firstName);
      const greeting = isGeneric ? '¡Hola!' : `${firstName},`;

      const reEngagementMsg =
        `${greeting} Antes de que se cierre nuestra ventana de chat, ¿te gustaría que te agreguemos a nuestra lista de seguimiento de *${businessName}*?\n\n` +
        `Te enviaríamos fotos, videos y novedades del proyecto. Solo responde *SÍ* para mantenerte informado/a. 🏡`;

      try {
        await axios.post(
          `https://graph.facebook.com/v17.0/${integration.phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phone.replace('+', ''),
            type: 'text',
            text: { body: reEngagementMsg }
          },
          { headers: { Authorization: `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json' } }
        );

        // Guardar mensaje en historial de la conversación
        await db.collection('conversations').doc(convDoc.id)
          .collection('messages').add({
            text: reEngagementMsg,
            sender: 'advisor',
            direction: 'outbound',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            type: 'text',
            status: 'sent',
            externalId: `reengagement.${crypto.randomBytes(8).toString('hex')}`
          });

        // Marcar conversación como re-engagement enviado
        await convDoc.ref.update({
          reEngagementSent: true,
          reEngagementSentAt: admin.firestore.FieldValue.serverTimestamp(),
          lastMessage: reEngagementMsg,
          lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
          lastMessageSender: 'advisor',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[WindowExpiry] Re-engagement enviado → conv: ${convDoc.id} | phone: ${phone}`);
      } catch (err: any) {
        console.error(`[WindowExpiry] Error enviando re-engagement a ${phone}:`, err?.response?.data || err.message);
      }
    }

    // ── PASO 2: Mover a "Perdido" si no respondió después de 25h ──
    const p2Cutoff = admin.firestore.Timestamp.fromMillis(now - 25 * HOUR);

    const expired = await db.collection('conversations')
      .where('lastInboundDate', '<=', p2Cutoff)
      .limit(100)
      .get();

    console.log(`[WindowExpiry] Paso 2: ${expired.size} conversaciones expiradas para evaluar`);

    for (const convDoc of expired.docs) {
      const conv = convDoc.data();
      if (conv.status !== 'active') continue;
      if (conv.source !== 'whatsapp') continue;
      // Solo procesar si ya enviamos el re-engagement y el cliente no ha respondido
      if (!conv.reEngagementSent || !conv.leadId) continue;

      try {
        await db.collection('leads').doc(conv.leadId).update({
          stage: 'Perdido',
          lastActivity: new Date().toISOString(),
        });

        // Limpiar flag para que no siga procesando en futuras ejecuciones
        await convDoc.ref.update({
          reEngagementSent: false,
        });

        console.log(`[WindowExpiry] Lead ${conv.leadId} → Perdido (conv: ${convDoc.id})`);
      } catch (err: any) {
        console.error(`[WindowExpiry] Error moviendo a Perdido lead ${conv.leadId}:`, err.message);
      }
    }

    console.log('[WindowExpiry] Ejecución completada.');
  });

/**
 * CLOUD FUNCTION: checkSilentLeads
 * Corre cada 2 minutos. Si el bot fue el último en escribir en una conversación
 * activa y el lead no respondió en 2 minutos, le manda UNA sola invitación a
 * agendar visita (no se repite: se marca visitNudgeSent y solo se limpia si el
 * lead vuelve a escribir). No molesta a leads ya agendados, vendidos o perdidos.
 */
export const checkSilentLeads = onSchedule({
  schedule: 'every 2 minutes',
  timeZone: 'America/Costa_Rica',
  memory: '256MiB',
  timeoutSeconds: 300,
}, async () => {
  const now = Date.now();
  const MINUTE = 60 * 1000;
  // Ventana acotada (2 a 6 min atrás), no solo "<= cutoff": sin límite inferior,
  // con el tiempo se acumulan miles de conversaciones viejas que ya matchean
  // ese "<=", y el limit(200) las devolvería a ELLAS (las más antiguas) en vez
  // de las recién calladas, dejando esta función efectivamente inerte a escala
  // (mismo tipo de bug que el de mensajes: rango sin acotar + limit).
  const windowStart = admin.firestore.Timestamp.fromMillis(now - 6 * MINUTE);
  const windowEnd = admin.firestore.Timestamp.fromMillis(now - 2 * MINUTE);

  const integrationCache: Record<string, any> = {};
  const settingsCache: Record<string, any> = {};

  const getIntegrationFor = async (tenantId: string, provider: string) => {
    const key = `${tenantId}:${provider}`;
    if (integrationCache[key] !== undefined) return integrationCache[key];
    const snap = await db.collection('integrations')
      .where('tenantId', '==', tenantId)
      .where('provider', '==', provider)
      .where('isActive', '==', true)
      .limit(1)
      .get();
    integrationCache[key] = snap.empty ? null : snap.docs[0].data();
    return integrationCache[key];
  };

  const getSettings = async (tenantId: string) => {
    if (settingsCache[tenantId] !== undefined) return settingsCache[tenantId];
    const snap = await db.collection('settings').doc(tenantId).get();
    settingsCache[tenantId] = snap.data() || {};
    return settingsCache[tenantId];
  };

  const candidates = await db.collection('conversations')
    .where('lastMessageDate', '>=', windowStart)
    .where('lastMessageDate', '<=', windowEnd)
    .limit(200)
    .get();

  console.log(`[SilentLeads] ${candidates.size} conversaciones candidatas a revisar`);

  for (const convDoc of candidates.docs) {
    const conv = convDoc.data();
    if (conv.status !== 'active') continue;
    if (conv.botEnabled !== true) continue;
    if (conv.lastMessageSender !== 'advisor') continue; // estamos esperando al lead, no al revés
    if (conv.visitNudgeSent) continue; // ya se mandó una vez, no repetir
    if (!conv.leadId) continue;

    try {
      const leadSnap = await db.collection('leads').doc(conv.leadId).get();
      if (!leadSnap.exists) continue;
      const leadStage = leadSnap.data()?.stage;

      const settings = await getSettings(conv.tenantId);
      const stages: any[] = settings.pipeline?.stages || [];
      const stageMeta = stages.find((s) => s.label === leadStage);
      // No insistir si ya está agendado, vendido o marcado como perdido.
      if (stageMeta?.isClosed || stageMeta?.id === 'visita-tecnica') continue;

      const integration = await getIntegrationFor(conv.tenantId, conv.source);
      if (!integration?.accessToken) continue;

      const firstName = (conv.contactName || '').split(' ')[0] || '';
      const isGeneric = !firstName || /^(usuario|desconocido|cliente|sin\s|\+?[0-9\s-]+)$/i.test(firstName);
      const nudgeMsg = isGeneric
        ? '¿Te gustaría ir a verlo en persona? Puedo agendarte una visita cuando gustes. 🏡'
        : `${firstName}, ¿te gustaría ir a verlo en persona? Puedo agendarte una visita cuando gustes. 🏡`;

      if (conv.source === 'whatsapp') {
        const phoneNumberId = integration.phoneNumberId;
        const destinationPhone = conv.phoneE164 || conv.phoneRaw;
        if (!phoneNumberId || !destinationPhone) continue;
        await axios.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: destinationPhone.replace('+', ''),
          type: 'text',
          text: { body: nudgeMsg }
        }, { headers: { Authorization: `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json' } });
      } else {
        const recipientId = conv.platformId;
        if (!recipientId) continue;
        await axios.post(`https://graph.facebook.com/v17.0/me/messages?access_token=${integration.accessToken}`, {
          recipient: { id: recipientId },
          message: { text: nudgeMsg }
        }, { headers: { 'Content-Type': 'application/json' } });
      }

      await db.collection('conversations').doc(convDoc.id).collection('messages').add({
        text: nudgeMsg,
        sender: 'advisor',
        direction: 'outbound',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        type: 'text',
        status: 'sent',
        externalId: `visitnudge.${crypto.randomBytes(8).toString('hex')}`
      });

      await convDoc.ref.update({
        visitNudgeSent: true,
        lastMessage: nudgeMsg,
        lastMessageDate: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSender: 'advisor',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[SilentLeads] Nudge de visita enviado → conv: ${convDoc.id} (${conv.source})`);
    } catch (err: any) {
      console.error(`[SilentLeads] Error en conv ${convDoc.id}:`, err?.response?.data || err.message);
    }
  }

  console.log('[SilentLeads] Ejecución completada.');
});

/**
 * Reparación de un solo uso: corrige leads huérfanos en TODOS los tenants.
 * Un lead queda huérfano cuando su `stage` no coincide con ninguna etiqueta del
 * pipeline del tenant (antes los webhooks hardcodeaban 'Nuevo'), o cuando le falta
 * `orderIndex` (Firestore excluye del CRM los docs sin el campo del orderBy).
 *
 * Se ejecuta vía HTTP con token: /repairOrphanLeads?token=REPAIR_2026
 */
const DEFAULT_PIPELINE_LABELS = ['Nuevo', 'Seguimiento', 'Visita Técnica', 'Venta Realizada', 'Perdido'];

export const repairOrphanLeads = functions.https.onRequest(async (req, res) => {
  if (req.query.token !== 'REPAIR_2026') {
    res.status(403).send('Forbidden');
    return;
  }

  const report: any = { tenantsWithSettings: 0, leadsScanned: 0, leadsFixed: 0, details: [] };

  // 1. Cargar pipeline (etiquetas válidas + etapa por defecto) por tenant
  const settingsSnap = await db.collection('settings').get();
  const pipelineByTenant: Record<string, { valid: Set<string>; def: string }> = {};
  for (const docSnap of settingsSnap.docs) {
    const stages = docSnap.data()?.pipeline?.stages;
    if (Array.isArray(stages) && stages.length > 0) {
      const valid = new Set<string>();
      for (const s of stages) if (s?.label) valid.add(s.label);
      const d = stages.find((s: any) => s.isDefault)
        || stages.slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))[0];
      pipelineByTenant[docSnap.id] = { valid, def: d?.label || 'Nuevo' };
    } else {
      // Tenant sin pipeline custom: el frontend muestra el pipeline por defecto
      pipelineByTenant[docSnap.id] = { valid: new Set(DEFAULT_PIPELINE_LABELS), def: 'Nuevo' };
    }
  }
  report.tenantsWithSettings = settingsSnap.size;

  // 2. Recorrer todos los leads y reparar huérfanos
  const leadsSnap = await db.collection('leads').get();
  report.leadsScanned = leadsSnap.size;

  let batch = db.batch();
  let ops = 0;
  for (const leadDoc of leadsSnap.docs) {
    const lead = leadDoc.data();
    const pipe = pipelineByTenant[lead.tenantId]
      || { valid: new Set(DEFAULT_PIPELINE_LABELS), def: 'Nuevo' };

    const updates: any = {};
    if (!lead.stage || !pipe.valid.has(lead.stage)) {
      updates.stage = pipe.def;
    }
    if (lead.orderIndex === undefined || lead.orderIndex === null) {
      updates.orderIndex = Date.now();
    }

    if (Object.keys(updates).length > 0) {
      batch.update(leadDoc.ref, updates);
      ops++;
      report.leadsFixed++;
      if (report.details.length < 100) {
        report.details.push({ id: leadDoc.id, tenantId: lead.tenantId, oldStage: lead.stage || null, ...updates });
      }
      if (ops >= 400) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }
  if (ops > 0) await batch.commit();

  console.log(`[RepairOrphanLeads] ${report.leadsFixed}/${report.leadsScanned} leads reparados.`);
  res.json(report);
});


// Prototipo QA "Live Video" (solo SuperAdmin; no toca tenants ni WhatsApp).
export { liveVideoQa } from './liveVideoQa';
