"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkWindowExpiry = exports.verifyPaypalOrder = exports.generateSocialMediaContent = exports.onTenantCreatedAutomation = exports.processOutboundEmail = exports.inboundEmailV2 = exports.sendMetaMessage = exports.acceptTenantInvite = exports.sendWhatsappMessage = exports.generateMarketingImage = exports.chatWithAgent = exports.metaWebhook = exports.whatsappWebhook = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const Busboy = __importStar(require("busboy"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const mail_1 = __importDefault(require("@sendgrid/mail"));
const axios_1 = __importDefault(require("axios"));
admin.initializeApp();
const db = admin.firestore();
/**
 * Validar la firma HMAC de Meta (sha256).
 * Comparacion en tiempo constante para evitar timing attacks.
 */
function validateSignature(payload, signature, secret) {
    if (!payload || !signature || !secret)
        return false;
    try {
        const hash = crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
        const expectedSignature = `sha256=${hash}`;
        const a = Buffer.from(signature);
        const b = Buffer.from(expectedSignature);
        if (a.length !== b.length)
            return false;
        return crypto.timingSafeEqual(a, b);
    }
    catch {
        return false;
    }
}
/**
 * Comparacion de strings en tiempo constante (anti-timing-attack) para tokens cortos.
 */
function safeStrEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string')
        return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length)
        return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
// Rate limiter en memoria: máx 20 mensajes por número en ventana de 60s
// (protección contra flood/spam sin dependencias externas)
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60000;
function isRateLimited(phoneNumber) {
    const now = Date.now();
    const entry = rateLimitMap.get(phoneNumber);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(phoneNumber, { count: 1, windowStart: now });
        return false;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX)
        return true;
    return false;
}
// Limpia entradas expiradas del mapa cada 5 minutos para evitar memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
        if (now - val.windowStart > RATE_LIMIT_WINDOW_MS * 2)
            rateLimitMap.delete(key);
    }
}, 5 * 60000);
/**
 * Ejecuta el Piloto Automático con IA usando Gemini 1.5 Flash
 */
async function triggerAiAutopilot(tenantId, conversationId, incomingText, source, integrationData) {
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
        if (convData?.botEnabled === false) {
            console.log('[AI Autopilot] Bot desactivado por asesor.');
            return;
        }
        // Construir contexto desde documentos de entrenamiento (truncado a 6000 chars)
        const settingsData = settingsDoc.data() || {};
        const agentConfig = settingsData.aiAgentConfig || { knowledgeFiles: [], productFiles: [] };
        const businessName = settingsData.tradeName || settingsData.companyName || 'el negocio';
        const allFiles = [...(agentConfig.knowledgeFiles || []), ...(agentConfig.productFiles || [])];
        const mediaLibrary = agentConfig.mediaLibrary || [];
        const mediaContext = mediaLibrary.length > 0
            ? `\nARCHIVOS DISPONIBLES PARA ENVIAR AL CLIENTE:\n${mediaLibrary.map((m) => `- "${m.name}"${m.description ? ` (${m.description})` : ''}: ${m.url}`).join('\n')}\n`
            : '';
        const rawContext = allFiles
            .filter((f) => f.content)
            .map((f) => `=== ${f.name} ===\n${f.content}`)
            .join('\n\n');
        const knowledgeContext = rawContext.length > 10000 ? rawContext.slice(0, 10000) + '\n[...]' : rawContext;
        const history = recentMsgsSnap.docs
            .reverse()
            .map((d) => {
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
            ? `Eres el asistente virtual oficial de ${businessName}.
IDENTIDAD: Los documentos de entrenamiento definen quién eres, cómo te llamas y qué vendes. Síguelos al pie de la letra.
NUNCA menciones SmartFlow Hub OS ni ninguna otra plataforma. Solo representas a ${businessName}.

REGLAS ESTRICTAS:
- Los precios en los documentos son los precios FINALES de contado en preventa. No existe ningún descuento adicional por pagar de contado — ese ya es el precio más bajo disponible.
- Nunca inventes precios, descuentos o condiciones que no estén explícitamente en los documentos.
- Si el cliente pregunta por financiamiento o cuotas: indica que hay asesoría de crédito sin costo, pero que los términos exactos se coordinan con el equipo de ventas.
- ARCHIVOS — ENVÍO PROACTIVO: Cuando el cliente pide fotos, catálogo, información, precios o documentos: busca en ARCHIVOS DISPONIBLES y envía el más relevante poniendo su URL exacta en media_url y "image" o "document" en media_type. Si solo hay PDF → envíalo con reply "Aquí te comparto la información completa del proyecto." Si no hay ningún archivo disponible → di que un asesor coordinará el envío. NUNCA prometas enviar un archivo que no esté en ARCHIVOS DISPONIBLES.

TONO Y ESTILO (lo más importante):
Escribe como un asesor real de WhatsApp: directo, cálido, sin florituras. Máximo 2-3 líneas por mensaje.
- NUNCA uses frases de call center: "Si tienes más preguntas estoy aquí", "Con gusto te ayudo", "Quedo a tus órdenes", "No dudes en consultarme" — suenan a robot.
- NUNCA repitas en tu respuesta lo que el cliente acaba de decir. Si el cliente afirma algo, acúsalo en 3-4 palabras y avanza.
- NUNCA abras con "¡Eso suena genial!", "¡Excelente!", "¡Perfecto!" para afirmaciones neutras del cliente.
- Un emoji máximo, solo si suma naturalmente. Si no suma, ninguno.
- Solo haz UNA pregunta al final, solo si genuinamente avanza la venta.
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

⛔ REGLA CRÍTICA — PORCENTAJES PROHIBIDOS EN PRESENTACIÓN INICIAL:
NUNCA incluyas porcentajes de construcción (25%, 35%, etc.) en las primeras 2 respuestas ni cuando el cliente pide información general ("más información", "qué tienen", "cuánto cuesta").
Solo menciona porcentajes si el cliente pregunta DIRECTAMENTE "¿cuánto puedo construir?", "¿límite de construcción?" o similar.
Incumplir esta regla es un error grave.

AUDIO ENTRANTE (cuando el cliente envía 🎵 Audio):
- Responde SOLO: "Recibí tu mensaje. ¿Me puedes escribir tu consulta para atenderte mejor?"
- Sin frases adicionales. Sin emojis. Máximo esa línea.
- Usa crm_action: "seguimiento" si el cliente ya mostró interés previo.

CONFIRMACIONES DEL CLIENTE — ANTI-BUCLE (crítico):
Si el cliente responde "Si", "Si claro", "Claro", "Ok", "Perfecto", "Sí", "De acuerdo" a algo que ya propusiste:
- NO repitas la misma pregunta. NUNCA.
- Si confirmó una fecha de seguimiento → responde SOLO: "Listo, te escribimos el [fecha]." y usa crm_action: "seguimiento". FIN.
- Si confirmó algo más → acusa en 3 palabras y avanza o despídete.

DETECTAR INTENCIÓN DE VISITA (prioridad alta):
- Si el cliente menciona un día o fecha para visitar ("el sábado voy", "paso el viernes", "quiero ir esta semana", "voy para allá", "me gustaría visitar", "deseo agendar") → ofrece agendar de inmediato.
- Si el cliente muestra interés pero para una fecha futura ("sería para después del 26 de junio", "estoy fuera", "les contacto cuando vuelva", "más adelante") → responde: "Anotado, te escribimos el [fecha mencionada]." usa crm_action: "seguimiento". No hagas más preguntas.
- NO sigas hablando de precios o detalles sin antes ofrecer agendar cuando ya expresó intención de visita.

DATOS DEL CONTACTO ACTUAL:
${clientNameContext}

PROTOCOLO DE AGENDAMIENTO — SIN EXCEPCIONES:
Cuando el cliente menciona un día/hora para visitar o dice "deseo agendar":
- Si el nombre del contacto es DESCONOCIDO → responde ÚNICAMENTE: "¿Me confirmas tu nombre completo para registrar la cita?" Nada más.
- Si ya tienes el nombre real del contacto → confirma: "Listo [Nombre], quedas agendado/a el [día] a las [hora]." y usa crm_action: "visita".
- NUNCA confirmes la cita sin nombre completo real. NUNCA uses "Te esperaré en el proyecto", "Nos vemos el [día]", "Si necesitas algo más".

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
Reglas para crm_action: null=conversación general | "seguimiento"=cliente muestra interés serio O está ausente pero volverá | "visita"=tienes nombre+día+hora confirmados | "venta"=cliente confirma compra/pago | "perdido"=cliente rechaza claramente.
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
Reglas para crm_action: null=conversación general | "seguimiento"=cliente muestra interés serio O está ausente pero volverá | "visita"=tienes nombre+día+hora confirmados | "venta"=cliente confirma compra/pago | "perdido"=cliente rechaza claramente.`;
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            console.warn('[AI Autopilot] OPENAI_API_KEY no configurada.');
            return;
        }
        console.log(`[AI Autopilot] Consultando GPT-4o-mini...`);
        const response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: incomingText }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 350,
            temperature: 0.55
        }, { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' } });
        const candidate = response.data?.choices?.[0]?.message?.content;
        if (!candidate) {
            console.error('[AI Autopilot] GPT-4o-mini no retornó respuesta.');
            return;
        }
        let parsed = {};
        try {
            parsed = JSON.parse(candidate);
        }
        catch {
            parsed = { reply: candidate };
        }
        let aiReply = (parsed.reply || candidate).trim();
        const crmAction = parsed.crm_action || null;
        const visitDate = parsed.visit_date || null;
        const visitTime = parsed.visit_time || null;
        const botMediaUrl = parsed.media_url || null;
        const botMediaType = parsed.media_type || null;
        console.log(`[AI Autopilot] Respuesta raw: "${aiReply}" | crm_action: ${crmAction}`);
        // POST-PROCESADO: eliminar porcentajes de construcción en conversaciones tempranas
        // El modelo los incluye desde los documentos de entrenamiento aunque el prompt lo prohíba.
        const earlyConversation = recentMsgsSnap.docs.length <= 4;
        if (earlyConversation) {
            aiReply = aiReply
                .replace(/,?\s*con\s+construcci[oó]n\s+permitida\s+del\s+\d+\s*%/gi, '')
                .replace(/,?\s*y\s+permiten?\s+una?\s+construcci[oó]n\s+del\s+\d+\s*%/gi, '')
                .replace(/\(\s*\d+\s*%\s*de\s*construcci[oó]n\s*\)/gi, '')
                .replace(/\s*—?\s*\d+\s*%\s*de\s*construcci[oó]n/gi, '')
                .replace(/\s*con\s+\d+\s*%\s*de\s*construcci[oó]n/gi, '')
                .trim();
            console.log(`[AI Autopilot] Post-procesado (sin %): "${aiReply}"`);
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
            }
            catch (payErr) {
                console.error('[AI Autopilot] Error generando link de pago:', payErr.message);
                aiReply = aiReply.replace(paymentMarker[0], '');
            }
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
                const mediaPayload = { link: botMediaUrl, caption: aiReply };
                if (!isImage)
                    mediaPayload.filename = botMediaUrl.split('/').pop()?.split('?')[0] || 'archivo.pdf';
                await axios_1.default.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: destinationPhone.replace('+', ''),
                    type: waType,
                    [waType]: mediaPayload,
                }, { headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
            }
            else {
                await axios_1.default.post(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
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
        }
        else {
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
                await axios_1.default.post(metaBase, {
                    recipient: { id: recipientId },
                    message: {
                        attachment: {
                            type: isImage ? 'image' : 'file',
                            payload: { url: botMediaUrl, is_reusable: true }
                        }
                    }
                }, { headers: metaHeaders });
                if (aiReply) {
                    await axios_1.default.post(metaBase, {
                        recipient: { id: recipientId },
                        message: { text: aiReply }
                    }, { headers: metaHeaders });
                }
            }
            else {
                await axios_1.default.post(metaBase, {
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
            const stageMap = {
                'seguimiento': 'Seguimiento',
                'visita': 'Agendado',
                'venta': 'Venta Realizada',
                'perdido': 'Perdido',
            };
            const newStage = stageMap[crmAction];
            if (newStage) {
                await db.collection('leads').doc(convData.leadId).update({
                    stage: newStage,
                    lastActivity: new Date().toISOString(),
                }).catch((e) => console.warn('[AI Autopilot] CRM update error:', e.message));
                console.log(`[AI Autopilot] CRM: Lead ${convData.leadId} → ${newStage}`);
            }
            if (crmAction === 'visita') {
                const dateStr = visitDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
                const timeStr = visitTime || '10:00';
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
                }).catch((e) => console.warn('[AI Autopilot] Agenda create error:', e.message));
                console.log(`[AI Autopilot] Agenda: Visita creada ${dateStr} ${timeStr}`);
                // Email de notificación al equipo
                const adminEmail = settingsData.email || settingsData.adminEmail || settingsData.contactEmail;
                const sgKey = process.env.SENDGRID_API_KEY;
                if (adminEmail && sgKey) {
                    mail_1.default.setApiKey(sgKey);
                    await mail_1.default.send({
                        to: adminEmail,
                        from: 'noreply@smartflow-suite.com',
                        subject: `📅 Nueva visita agendada — ${convData.contactName || 'Cliente'}`,
                        html: `<h2>Nueva visita agendada por el Agente IA</h2>
<p><strong>Cliente:</strong> ${convData.contactName || 'Sin nombre'}</p>
<p><strong>Teléfono:</strong> ${convData.phoneRaw || '-'}</p>
<p><strong>Fecha:</strong> ${dateStr} a las ${timeStr}</p>
<p><strong>Canal:</strong> ${source.toUpperCase()}</p>
<p><a href="https://hub.smartflow-suite.com/agenda">Ver en Agenda →</a></p>`
                    }).catch((e) => console.warn('[AI Autopilot] Email notif error:', e.message));
                    console.log(`[AI Autopilot] Email enviado a ${adminEmail}`);
                }
            }
        }
    }
    catch (err) {
        console.error('[AI Autopilot] Error:', err.message || err);
    }
}
/**
 * Webhook de WhatsApp Cloud API
 */
exports.whatsappWebhook = functions.runWith({ secrets: ['OPENAI_API_KEY'] }).https.onRequest(async (req, res) => {
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
        }
        else {
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
                // 2.1 Validación de firma HMAC de Meta usando el appSecret del tenant
                const signature = req.headers['x-hub-signature-256'];
                const tenantAppSecret = integrationData.appSecret || (process.env.WHATSAPP_APP_SECRET || '').trim();
                if (signature) {
                    const rawBody = req.rawBody;
                    if (!rawBody)
                        console.error('rawBody is undefined!');
                    const isValid = validateSignature(rawBody, signature, tenantAppSecret);
                    if (!isValid) {
                        console.error('Signature check failed para tenant:', tenantId);
                        res.status(403).send('Signature check failed');
                        return;
                    }
                }
                else {
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
                    }
                    else if (message.type === 'location') {
                        const loc = message.location;
                        const parts = ['[Ubicación compartida]'];
                        if (loc?.name)
                            parts.push(loc.name);
                        if (loc?.address)
                            parts.push(loc.address);
                        if (loc?.latitude && loc?.longitude) {
                            parts.push(`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`);
                        }
                        text = parts.join(' — ');
                    }
                    else if (message.type === 'image') {
                        text = '[El cliente envió una imagen]';
                    }
                    else if (message.type === 'audio') {
                        text = '[El cliente envió un audio]';
                    }
                    else if (message.type === 'document') {
                        text = `[El cliente envió un documento: ${message.document?.filename || 'archivo'}]`;
                    }
                    else if (message.type === 'sticker') {
                        text = '[El cliente envió un sticker]';
                    }
                    // D. DETECCIÓN DE ORIGEN DEL LEAD
                    const referral = message.referral;
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
                    }
                    else if (isCampaignTemplate) {
                        // Fallback: plantilla VEG2025 sin referral (doble seguridad)
                        utmSource = 'whatsapp_ad';
                        sourceLabel = 'Campaña WhatsApp Ads (VEG2025)';
                    }
                    else if (isLandingLote) {
                        utmSource = 'landing_page';
                        sourceLabel = 'Landing Page — Lote';
                        productInterest = 'Lote';
                    }
                    else if (isLandingQuinta) {
                        utmSource = 'landing_page';
                        sourceLabel = 'Landing Page — Quinta';
                        productInterest = 'Quinta';
                    }
                    else if (isLandingGeneral || isLandingInfo) {
                        utmSource = 'landing_page';
                        sourceLabel = 'Landing Page (botón web)';
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
                            stage: 'Nuevo',
                            lastActivity: new Date().toISOString(),
                            createdAt: new Date().toISOString(),
                            orderIndex: Date.now(),
                        });
                        leadId = newLeadRef.id;
                        console.log(`[Webhook WA] Nuevo lead creado: ${leadId} | Origen: ${sourceLabel}`);
                    }
                    else {
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
                            botEnabled: integrationData.isAiAutomated ?? false,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            advisorId: 'u-1'
                        });
                        conversationId = newConvRef.id;
                    }
                    else {
                        conversationId = convSnapshot.docs[0].id;
                    }
                    // F. MEDIA DOWNLOAD (audio/imagen entrante desde WhatsApp → Firebase Storage)
                    let inboundMediaUrl = null;
                    const inboundMsgType = (message.type === 'text' || message.type === 'location') ? 'text' : message.type;
                    if ((message.type === 'audio' || message.type === 'image') && integrationData.accessToken) {
                        const mediaId = message.audio?.id || message.image?.id;
                        if (mediaId) {
                            try {
                                const mediaInfoRes = await axios_1.default.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
                                    headers: { Authorization: `Bearer ${integrationData.accessToken}` }
                                });
                                const whatsappMediaUrl = mediaInfoRes.data.url;
                                const rawMime = mediaInfoRes.data.mime_type || (message.type === 'audio' ? 'audio/ogg' : 'image/jpeg');
                                const mimeType = rawMime.split(';')[0].trim();
                                const extMap = {
                                    'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
                                    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
                                };
                                const ext = extMap[mimeType] || (message.type === 'audio' ? 'ogg' : 'jpg');
                                const mediaBuffer = await axios_1.default.get(whatsappMediaUrl, {
                                    responseType: 'arraybuffer',
                                    headers: { Authorization: `Bearer ${integrationData.accessToken}` }
                                });
                                const bucket = admin.storage().bucket();
                                const filePath = `whatsapp-media/${tenantId}/${Date.now()}.${ext}`;
                                const fileRef = bucket.file(filePath);
                                await fileRef.save(Buffer.from(mediaBuffer.data), { metadata: { contentType: mimeType } });
                                await fileRef.makePublic();
                                inboundMediaUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                                text = message.type === 'audio' ? '🎵 Audio' : '📷 Imagen';
                                console.log(`[WhatsApp Media] ${message.type} descargado y subido: ${inboundMediaUrl}`);
                            }
                            catch (mediaErr) {
                                console.warn('[WhatsApp Media Download] Error:', mediaErr.message);
                            }
                        }
                    }
                    // G. TRANSACTIONAL PERSISTENCE (DEDUPLICATION + INSERCIÓN)
                    await db.runTransaction(async (transaction) => {
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
                                updatedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                        }
                    });
                    console.log(`Mensaje procesado para tenant ${tenantId}. Conv: ${conversationId}`);
                    // G. TRIGGER AI AUTOPILOT SI ESTÁ HABILITADO
                    if (integrationData.isAiAutomated) {
                        triggerAiAutopilot(tenantId, conversationId, text, 'whatsapp', {
                            phoneNumberId: integrationData.phoneNumberId,
                            accessToken: integrationData.accessToken
                        }).catch(e => console.error('Error running AI Autopilot WhatsApp:', e));
                    }
                }
                // G. GESTIÓN SILENCIOSA DE STATUSES (Delivery/Read Receipts)
                if (value && value.statuses?.[0]) {
                    const status = value.statuses[0];
                    console.log(`Webhook Status Update: ${status.status} for wamid: ${status.id}`);
                    // Aquí se podría actualizar el status del mensaje en Firestore en el futuro
                }
            }
            catch (error) {
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
exports.metaWebhook = functions.runWith({ secrets: ['OPENAI_API_KEY'] }).https.onRequest(async (req, res) => {
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
                const metaSignature = req.headers['x-hub-signature-256'];
                const metaAppSecret = integrationData.appSecret || (process.env.WHATSAPP_APP_SECRET || '').trim();
                if (!metaSignature) {
                    res.status(403).send('Missing signature');
                    return;
                }
                const rawBody = req.rawBody;
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
                    const referralMeta = messaging.referral;
                    let utmSourceMeta = 'organico';
                    let sourceLabelMeta = 'Orgánico / Directo';
                    if (referralMeta?.source === 'ADS' || referralMeta?.type === 'OPEN_THREAD') {
                        utmSourceMeta = 'meta_ad';
                        sourceLabelMeta = `Campaña Meta Ads${referralMeta.headline ? ` — "${referralMeta.headline}"` : ''}`;
                    }
                    else if (text && /quiero inform|me interes|lotes|quintas|iguana park|landing|precio|proyecto/i.test(text)) {
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
                        // Crear lead automáticamente
                        const newLeadRef = await db.collection('leads').add({
                            tenantId,
                            name: contactName,
                            stage: 'Nuevo',
                            source: sourceLabelMeta,
                            utmSource: utmSourceMeta,
                            keyData: `Origen: ${sourceLabelMeta}`,
                            phone: '',
                            email: '',
                            notes: '',
                            createdAt: new Date().toISOString(),
                            lastActivity: new Date().toISOString()
                        });
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
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            advisorId: 'u-1',
                            phoneRaw: '',
                            phoneE164: '',
                            phoneSearchKey: ''
                        });
                        conversationId = newConvRef.id;
                        // Vincular conversación al lead
                        await newLeadRef.update({ conversationId: newConvRef.id });
                    }
                    else {
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
            }
            catch (error) {
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
exports.chatWithAgent = (0, https_1.onCall)({
    maxInstances: 10,
    timeoutSeconds: 60,
    secrets: ['OPENAI_API_KEY'],
}, async (request) => {
    console.log('[chatWithAgent] HANDLER INVOCADO — auth uid:', request.auth?.uid ?? 'NONE');
    try {
        if (!request.auth)
            throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
        const { messages, tenantId } = request.data;
        console.log('[chatWithAgent] tenantId:', tenantId, '| messages:', messages?.length);
        if (!tenantId)
            throw new https_1.HttpsError('invalid-argument', 'tenantId requerido');
        if (!messages?.length)
            throw new https_1.HttpsError('invalid-argument', 'messages requerido');
        const apiKey = process.env.OPENAI_API_KEY;
        console.log('[chatWithAgent] apiKey present:', !!apiKey, '| length:', apiKey?.length ?? 0);
        if (!apiKey)
            throw new https_1.HttpsError('failed-precondition', 'OPENAI_API_KEY no configurada');
        // Leer config del agente y features del tenant desde Firestore
        const settingsDoc = await db.collection('settings').doc(tenantId).get();
        const raw = settingsDoc.data() || {};
        const agentConfig = raw.aiAgentConfig || { knowledgeFiles: [], productFiles: [] };
        const features = raw.features || {};
        const businessName = raw.tradeName || raw.companyName || 'el negocio';
        // Límite mensual de consultas según plan
        const LIMIT_FREE = 20; // trial sin módulo IA activo
        const LIMIT_PAID = 300; // hasAiAgent activo
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
            throw new https_1.HttpsError('resource-exhausted', features.hasAiAgent
                ? `Alcanzaste el límite de ${LIMIT_PAID} consultas este mes. Se renueva el próximo mes.`
                : `Límite de ${LIMIT_FREE} consultas gratuitas alcanzado. Activa el Agente IA para obtener 300/mes.`);
        }
        // Construir contexto desde archivos con content extraído
        const allFiles = [
            ...(agentConfig.knowledgeFiles || []),
            ...(agentConfig.productFiles || []),
        ];
        const knowledgeContextRaw = allFiles
            .filter((f) => f.content)
            .map((f) => `=== ${f.name} ===\n${f.content}`)
            .join('\n\n');
        const knowledgeContext = knowledgeContextRaw.length > 10000 ? knowledgeContextRaw.slice(0, 10000) + '\n[...]' : knowledgeContextRaw;
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
- Solo termina con una pregunta cuando genuinamente avanza la conversación
- Si el usuario dice "Gracias", "No", "Ok", "Listo", "Adiós" o cierra el tema → despídete de forma natural, sin forzar más preguntas
- Nunca hagas dos preguntas en el mismo mensaje

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
        let response;
        try {
            response = await axios_1.default.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages,
                ],
                max_tokens: 500,
                temperature: 0.7,
            }, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
            });
        }
        catch (axiosErr) {
            const status = axiosErr?.response?.status;
            const errData = axiosErr?.response?.data;
            console.error('[chatWithAgent] OpenAI error:', status, JSON.stringify(errData));
            throw new https_1.HttpsError('failed-precondition', `OpenAI error ${status}: ${errData?.error?.message || axiosErr.message}`);
        }
        const reply = response.data.choices?.[0]?.message?.content;
        if (!reply)
            throw new https_1.HttpsError('failed-precondition', 'El modelo no retornó respuesta');
        // Incrementar contador de uso
        await usageRef.set({ chatAgent: { count: chatUsage.count + 1, month: currentMonth } }, { merge: true });
        return {
            reply,
            usage: {
                used: chatUsage.count + 1,
                limit: queryLimit,
                remaining: queryLimit - chatUsage.count - 1,
            },
        };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        console.error('[chatWithAgent] UNHANDLED EXCEPTION:', err?.message, err?.stack);
        throw new https_1.HttpsError('failed-precondition', `Error interno: ${err?.message || String(err)}`);
    }
});
/**
 * Genera imágenes de marketing con gpt-image-1 (GPT-4o) — composite ads con mockups y copy real
 */
exports.generateMarketingImage = (0, https_1.onCall)({
    maxInstances: 5,
    timeoutSeconds: 120,
    secrets: ['OPENAI_API_KEY']
}, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    const { format } = request.data;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new https_1.HttpsError('internal', 'OPENAI_API_KEY no configurada');
    // gpt-image-1 soporta: 1024x1024, 1024x1536, 1536x1024, auto
    const sizeMap = { instagram: '1024x1536', facebook: '1024x1024', blog: '1536x1024' };
    const size = sizeMap[format] || '1024x1024';
    const promptMap = {
        instagram: `Cinematic dark product photography for a tech SaaS ad. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: dramatic close-up of hands holding a sleek modern smartphone in a dark environment. The phone screen glows showing a WhatsApp Business dashboard with green chat bubbles and business metrics. Dark moody background with subtle green (#00C853) light glow from the screen illuminating the hands. Cinematic bokeh, shallow depth of field. 4:5 portrait format. Photorealistic, premium commercial photography, Apple-level aesthetic.`,
        facebook: `Cinematic dark commercial photography for a tech business ad. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: a confident Latin professional at a sleek modern dark desk, laptop open showing a colorful CRM sales pipeline dashboard with green metrics and charts, smartphone beside it showing WhatsApp conversations with green bubbles. Dramatic directional side lighting, shallow depth of field, dark background (#0D0D0D). Professional high-end commercial photography, square 1:1 composition, stop-scroll visual impact. Photorealistic.`,
        blog: `Cinematic wide editorial photography for a tech company blog. NO TEXT, NO WORDS, NO LETTERS anywhere in the image.
Scene: a premium dark desk environment — a sleek laptop and a smartphone side by side, both screens glowing showing a modern CRM business dashboard. Dark background with green (#00C853) accent lighting from the screens. Wide landscape composition, left third darker (for text overlay space), right two-thirds shows the devices in detail. Professional editorial product photography, 1536x1024. Photorealistic, premium tech aesthetic.`
    };
    const response = await axios_1.default.post('https://api.openai.com/v1/images/generations', {
        model: 'gpt-image-1',
        prompt: promptMap[format],
        n: 1,
        size,
        quality: 'medium'
    }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    const b64 = response.data?.data?.[0]?.b64_json;
    if (!b64)
        throw new https_1.HttpsError('internal', 'gpt-image-1 no retornó imagen');
    return { imageUrl: `data:image/png;base64,${b64}` };
});
/**
 * Función Callable para enviar mensajes de WhatsApp de forma segura
 */
exports.sendWhatsappMessage = (0, https_1.onCall)({
    maxInstances: 10,
    secrets: ['WHATSAPP_TOKEN_DEFAULT'] // Ejemplo de uso de Secret Manager
}, async (request) => {
    // 1. VALIDACIÓN DE SESIÓN
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    }
    const { conversationId, text, tenantId, mediaUrl, mediaFilename, templateName, languageCode, components } = request.data;
    const uid = request.auth.uid;
    console.log(`[Diagnostic] sendWhatsappMessage invoked. tenantId: ${tenantId}, convId: ${conversationId}, textLength: ${text?.length}, hasMedia: ${!!mediaUrl}`);
    if (!conversationId || (!text && !mediaUrl) || !tenantId) {
        throw new https_1.HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
    }
    // 2. VALIDACIÓN DE MEMBRESÍA Y ROL
    const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
    const membershipDoc = await membershipRef.get();
    if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
        throw new https_1.HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
    }
    // 3. OBTENER INTEGRACIÓN ACTIVA
    const integrationSnapshot = await db.collection('integrations')
        .where('tenantId', '==', tenantId)
        .where('provider', '==', 'whatsapp')
        .where('isActive', '==', true)
        .limit(1)
        .get();
    if (integrationSnapshot.empty) {
        throw new https_1.HttpsError('failed-precondition', 'No hay una integración de WhatsApp activa para este tenant');
    }
    const integration = integrationSnapshot.docs[0].data();
    const phoneNumberId = integration.phoneNumberId;
    const accessToken = integration.accessToken;
    if (!phoneNumberId || !accessToken) {
        throw new https_1.HttpsError('failed-precondition', 'La integración de WhatsApp está mal configurada (faltan tokens)');
    }
    // 4. VALIDACIÓN DE VENTANA DE 24 HORAS
    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
        throw new https_1.HttpsError('not-found', 'Conversación no encontrada');
    }
    const convData = conversationDoc.data();
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
                throw new https_1.HttpsError('deadline-exceeded', 'Fuera de la ventana de 24 horas. Debes usar una plantilla aprobada.');
            }
        }
        else if (!templateName) {
            // Si no hay mensajes del lead aún, también forzamos plantilla
            throw new https_1.HttpsError('deadline-exceeded', 'No hay ventana activa. Debes usar una plantilla aprobada para iniciar contacto.');
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
        }
        catch (err) {
            throw new https_1.HttpsError('failed-precondition', `El PDF no es accesible para Meta: ${err.message}`);
        }
    }
    // 5. ENVÍO A META
    let status = 'sent';
    let externalId = `wamid.${crypto.randomBytes(8).toString('hex')}`;
    let errorMessage = '';
    try {
        console.log(`Enviando mensaje HTTP a Meta para tenant ${tenantId}...`);
        // Switch between document or text payload
        const messagePayload = {
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
        }
        else if (mediaUrl) {
            const isImage = /\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(jpg|jpeg|png|webp|gif)$/i.test(mediaFilename));
            if (isImage) {
                console.log(`[Diagnostic] Adjuntando Imagen. Filename: ${mediaFilename}`);
                messagePayload.type = 'image';
                messagePayload.image = {
                    link: mediaUrl,
                    ...(text && { caption: text })
                };
            }
            else {
                console.log(`[Diagnostic] Adjuntando Documento PDF. Filename: ${mediaFilename}`);
                messagePayload.type = 'document';
                messagePayload.document = {
                    link: mediaUrl,
                    filename: mediaFilename || 'Documento adjunto',
                    ...(text && { caption: text })
                };
            }
        }
        else {
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
            console.error('[Diagnostic] Meta API Error:', JSON.stringify(bodyData));
            throw new Error(bodyData.error?.message || 'Error en respuesta de Meta Graph API');
        }
        externalId = bodyData.messages?.[0]?.id || externalId;
    }
    catch (err) {
        status = 'failed';
        errorMessage = err.message || 'Error desconocido HTTP de Meta';
    }
    // 6. PERSISTENCIA EN FIRESTORE (TRANSACCIONAL)
    const isMsgImage = mediaUrl ? (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(mediaUrl) || (mediaFilename && /\.(jpg|jpeg|png|webp|gif)$/i.test(mediaFilename))) : false;
    let finalMessageText = text;
    if (mediaUrl) {
        if (status === 'sent') {
            finalMessageText = isMsgImage ? `[Imagen Enviada]\n${text}` : `[Documento Enviado: ${mediaFilename || 'PDF'}]\n${text}`;
        }
        else {
            finalMessageText = isMsgImage ? `[Error al enviar Imagen]\n${text}` : `[Error al enviar Documento: ${mediaFilename || 'PDF'}]\n${text}`;
        }
    }
    const messageData = {
        text: finalMessageText,
        sender: 'advisor',
        direction: 'outbound',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        type: templateName ? 'template' : (mediaUrl ? (isMsgImage ? 'image' : 'document') : 'text'),
        status,
        externalId: status === 'sent' ? externalId : null,
        errorMessage: status === 'failed' ? errorMessage : null,
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
    return { success: status === 'sent', messageId: msgRef.id, status, externalId };
});
/**
 * Vincula una invitación pendiente con el usuario autenticado (Google/Email).
 * Usa el Admin SDK para bypassear las reglas de Firestore durante el vínculo inicial.
 */
exports.acceptTenantInvite = (0, https_1.onCall)({ maxInstances: 10 }, async (request) => {
    // 1. VALIDACIÓN DE SESIÓN
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    }
    const { uid } = request.auth;
    const email = request.auth.token.email;
    if (!email) {
        throw new https_1.HttpsError('failed-precondition', 'El usuario no tiene un correo electrónico verificado');
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
    const linkedTenants = [];
    // 3. PROCESAR VÍNCULOS
    const batch = db.batch();
    for (const doc of membershipsSnapshot.docs) {
        const data = doc.data();
        const tenantId = data.tenantId;
        if (!tenantId)
            continue;
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
                linkedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            // Eliminar el documento de invitación original (ID aleatorio)
            batch.delete(doc.ref);
        }
        else {
            // Si el ID ya es el correcto (re-re-login), solo aseguramos activación si era pending
            batch.update(targetRef, {
                userId: uid,
                status: data.status === 'suspended' ? 'suspended' : 'active',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
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
/**
 * Función Callable para enviar mensajes de Instagram/Facebook
 */
exports.sendMetaMessage = (0, https_1.onCall)({ maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Usuario no autenticado');
    }
    const { conversationId, text, tenantId, source } = request.data;
    const uid = request.auth.uid;
    if (!conversationId || !text || !tenantId || !source) {
        throw new https_1.HttpsError('invalid-argument', 'Faltan parámetros obligatorios');
    }
    // 1. VALIDACIÓN DE MEMBRESÍA
    const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
    const membershipDoc = await membershipRef.get();
    if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
        throw new https_1.HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
    }
    // 2. OBTENER INTEGRACIÓN
    const integrationSnapshot = await db.collection('integrations')
        .where('tenantId', '==', tenantId)
        .where('provider', '==', source)
        .where('isActive', '==', true)
        .limit(1)
        .get();
    if (integrationSnapshot.empty) {
        throw new https_1.HttpsError('failed-precondition', `No hay una integración de ${source} activa`);
    }
    const integration = integrationSnapshot.docs[0].data();
    const accessToken = integration.accessToken;
    // 3. OBTENER CONVERSACIÓN
    const conversationRef = db.collection('conversations').doc(conversationId);
    const conversationDoc = await conversationRef.get();
    if (!conversationDoc.exists) {
        throw new https_1.HttpsError('not-found', 'Conversación no encontrada');
    }
    const recipientId = conversationDoc.data()?.platformId;
    // 4. ENVÍO A META
    let status = 'sent';
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
    }
    catch (err) {
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
const https_2 = require("firebase-functions/v2/https");
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
exports.inboundEmailV2 = (0, https_2.onRequest)({
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
    const authHeader = (req.headers['authorization'] || '');
    if (!authHeader.toLowerCase().startsWith('basic ')) {
        res.status(401).set('WWW-Authenticate', 'Basic realm="inbound"').send('Unauthorized');
        return;
    }
    let providedUser = '';
    let providedPass = '';
    try {
        const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        if (idx === -1)
            throw new Error('bad credentials');
        providedUser = decoded.slice(0, idx);
        providedPass = decoded.slice(idx + 1);
    }
    catch {
        res.status(401).send('Unauthorized');
        return;
    }
    // Comparacion en tiempo constante para evitar timing attacks
    const safeEqual = (a, b) => {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);
        if (bufA.length !== bufB.length)
            return false;
        return crypto.timingSafeEqual(bufA, bufB);
    };
    if (!safeEqual(providedUser, expectedUser) || !safeEqual(providedPass, expectedPass)) {
        res.status(401).send('Unauthorized');
        return;
    }
    // 2. Limites de tamano (anti-DoS / anti-storage-abuse)
    const MAX_FIELD_LEN = 50000; // 50 KB por campo
    const MAX_TOTAL_LEN = 200000; // 200 KB total
    const busboy = Busboy.default({
        headers: req.headers,
        limits: {
            fieldSize: MAX_FIELD_LEN,
            fields: 50,
            fileSize: 0,
            files: 0,
        }
    });
    const formData = {};
    let totalBytes = 0;
    let rejected = false;
    busboy.on('field', (fieldname, val) => {
        if (rejected)
            return;
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
        }
        catch (error) {
            console.error('[Email v2] Error:', error);
            // No exponer detalles internos al cliente
            res.status(500).send('Internal Server Error');
        }
    });
    busboy.on('error', (err) => {
        console.error('[Email v2] Busboy error:', err);
        if (!res.headersSent)
            res.status(400).send('Bad Request');
    });
    if (req.rawBody) {
        busboy.end(req.rawBody);
    }
    else {
        req.pipe(busboy);
    }
});
/**
 * Trigger para enviar correos salientes vía SendGrid
 */
exports.processOutboundEmail = (0, firestore_1.onDocumentCreated)({
    document: 'admin_emails/{emailId}',
    memory: '512MiB'
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
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
        mail_1.default.setApiKey(apiKey);
        const attachments = [];
        if (data.attachmentUrl && data.attachmentName) {
            try {
                console.log(`[SendGrid] Descargando adjunto: ${data.attachmentName} desde ${data.attachmentUrl}`);
                const response = await axios_1.default.get(data.attachmentUrl, { responseType: 'arraybuffer' });
                const base64Content = Buffer.from(response.data).toString('base64');
                attachments.push({
                    content: base64Content,
                    filename: data.attachmentName,
                    type: response.headers['content-type'] || 'application/octet-stream',
                    disposition: 'attachment'
                });
                console.log(`[SendGrid] Adjunto procesado con éxito (${response.data.length} bytes)`);
            }
            catch (err) {
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
        await mail_1.default.send(msg);
        // Marcar como procesado
        await snapshot.ref.update({
            processedBySendGrid: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[SendGrid] Éxito: Correo enviado a ${data.to}`);
    }
    catch (error) {
        console.error('[SendGrid] Error al enviar:', error);
        await snapshot.ref.update({
            deliveryError: error.message,
            status: 'failed'
        });
    }
});
/**
 * TRIGGER DE AUTOMATIZACIÓN: Al registrar un nuevo negocio (Tenant)
 * Envía correo de bienvenida premium, factura real desglosada y programa el seguimiento.
 */
exports.onTenantCreatedAutomation = (0, firestore_1.onDocumentCreated)({
    document: 'tenants/{tenantId}',
    memory: '256MiB'
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const data = snapshot.data();
    const tenantId = snapshot.id;
    try {
        const companyName = data.name || 'tu negocio';
        const tradeName = data.tradeName || tenantId;
        const email = data.ownerEmail;
        if (!email) {
            console.log('[Onboarding Automation] No email found for tenant:', tenantId);
            return;
        }
        // --- 1. DETERMINAR MÓDULOS CONTRATADOS Y CALCULAR FACTURA REAL ---
        const features = data.features || {};
        const purchasedItems = [];
        // Mapeo oficial de precios de CheckoutView.tsx
        if (features.hasMultiAgent)
            purchasedItems.push({ name: 'WhatsApp Coexistente (CRM Multiagente)', price: 69 });
        if (features.hasAiAgent)
            purchasedItems.push({ name: 'Agente IA (Ventas autónomas)', price: 49 });
        if (features.hasQualityAuditor)
            purchasedItems.push({ name: 'Auditor IA (Análisis de calidad)', price: 25 });
        if (features.hasPaymentLinks)
            purchasedItems.push({ name: 'Links de pago (Cobros por chat)', price: 12 });
        if (features.hasQuotes)
            purchasedItems.push({ name: 'Cotizaciones PDF profesionales', price: 15 });
        if (features.hasCatalog)
            purchasedItems.push({ name: 'Catálogo de Productos', price: 27 });
        if (features.hasAgenda)
            purchasedItems.push({ name: 'Agenda inteligente y confirmación', price: 20 });
        let rawTotal = purchasedItems.reduce((sum, item) => sum + item.price, 0);
        let finalTotal = rawTotal > 197 ? 197 : rawTotal;
        const isFullSuite = rawTotal > 197;
        // --- 2. GENERAR HTML DEL CORREO DE BIENVENIDA ---
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
              <a href="https://${tradeName}.smartflow-suite.com" style="color: #1877f2; text-decoration: none; font-weight: bold; border-bottom: 1px dashed #1877f2;">https://${tradeName}.smartflow-suite.com</a>
            </p>
            <p style="font-size: 14px; margin: 8px 0; color: #334155;"><strong>Correo de Administración:</strong> ${email}</p>
          </div>
          
          <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 24px; margin-bottom: 12px;">🎯 Tus primeros pasos para comenzar:</h3>
          <ol style="font-size: 14px; line-height: 1.8; color: #475569; padding-left: 20px; margin-bottom: 24px;">
            <li style="margin-bottom: 8px;"><strong>Inicia sesión</strong> usando tu correo y contraseña en tu Workspace.</li>
            <li style="margin-bottom: 8px;"><strong>Conecta tu WhatsApp:</strong> Accede a la sección "WhatsApp", escanea el código QR y activa la conexión multiagente en 10 segundos.</li>
            <li style="margin-bottom: 8px;"><strong>Carga tu conocimiento:</strong> Entrena a tu Agente IA subiendo tus productos o preguntas frecuentes para activar el autopilot.</li>
          </ol>
          
          <div style="text-align: center; margin-top: 32px; margin-bottom: 20px;">
            <a href="https://smartflow-suite.com/login" style="background-color: #1877f2; color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 30px; font-weight: bold; font-size: 14px; display: inline-block; box-shadow: 0 4px 10px rgba(24, 119, 242, 0.25);">ENTRAR A MI DASHBOARD</a>
          </div>
        </div>
        
        <div style="padding-top: 24px; border-t: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          <p style="margin: 0 0 6px 0;">Este es un correo automático de SmartFlow Hub OS.</p>
          <p style="margin: 0;">¿Necesitas ayuda técnica? Escríbenos a <a href="mailto:hola@smartflow-suite.com" style="color: #1877f2; text-decoration: none;">hola@smartflow-suite.com</a></p>
        </div>
      </div>
    `;
        const welcomeText = `¡Bienvenido a SmartFlow Hub OS!\n\nTu espacio de trabajo en la nube ha sido aprovisionado con éxito para ${companyName}.\n\nTu acceso directo: https://${tradeName}.smartflow-suite.com\nEmail de administración: ${email}\n\nInicia sesión y conecta tu WhatsApp desde el menú de la izquierda para comenzar.`;
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
        }
        else if (purchasedItems.length > 0) {
            tableRows = purchasedItems.map(item => `
        <tr>
          <td style="padding: 12px 8px; border-bottom: 1px solid #f1f5f9;">
            <strong style="color: #0f172a;">${item.name}</strong><br>
            <span style="font-size: 12px; color: #64748b;">Licencia de módulo mensual activa.</span>
          </td>
          <td style="padding: 12px 8px; text-align: right; border-bottom: 1px solid #f1f5f9; font-weight: bold; color: #0f172a;">$${item.price.toFixed(2)} USD</td>
        </tr>
      `).join('');
        }
        else {
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
        // Guardar factura en cola saliente
        await db.collection('admin_emails').add({
            to: email,
            subject: `Tu factura de compra ${invoiceNumber} - SmartFlow Hub OS`,
            text: `Confirmación de cobro aprobado de tu suscripción de SmartFlow Hub OS por $${finalTotal.toFixed(2)} USD.`,
            html: invoiceHtml,
            folder: 'sent',
            processedBySendGrid: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[Onboarding Automation] Invoice email created for tenant: ${tenantId}`);
        // --- 4. PROGRAMAR SEGUIMIENTO DE 3 DÍAS Y 7 DÍAS EN LA BASE DE DATOS ---
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
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[Onboarding Automation] Onboarding tracking initialized for tenant: ${tenantId}`);
    }
    catch (error) {
        console.error('[Onboarding Automation] Error executing trigger:', error);
    }
});
/**
 * CLOUD FUNCTION: generateSocialMediaContent
 * Generador de campañas de marketing con IA impulsado por Google Gemini.
 * Genera Blog, Facebook e Instagram en un solo paso con respuesta JSON estructurada.
 */
exports.generateSocialMediaContent = (0, https_1.onCall)({
    memory: '256MiB',
    timeoutSeconds: 60,
}, async (request) => {
    // Asegurar que el usuario está logueado
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesión para usar este generador.');
    }
    const { topic, tone, additionalNotes } = request.data || {};
    if (!topic || typeof topic !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'El tema de la publicación es obligatorio.');
    }
    // Limites de tamano para evitar abuso de prompt-injection / costos LLM
    if (topic.length > 500) {
        throw new https_1.HttpsError('invalid-argument', 'El tema es demasiado largo (max 500 caracteres).');
    }
    if (tone !== undefined && (typeof tone !== 'string' || tone.length > 100)) {
        throw new https_1.HttpsError('invalid-argument', 'tone invalido');
    }
    if (additionalNotes !== undefined && (typeof additionalNotes !== 'string' || additionalNotes.length > 2000)) {
        throw new https_1.HttpsError('invalid-argument', 'additionalNotes invalido');
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
        const response = await axios_1.default.post(geminiUrl, {
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
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        const parsedData = JSON.parse(jsonText);
        return {
            success: true,
            mode: 'live',
            data: parsedData
        };
    }
    catch (error) {
        console.error('[Gemini API] Error al conectar con Gemini:', error);
        // No filtrar detalles del backend (URL, payload, claves) al cliente
        throw new https_1.HttpsError('internal', 'Error de generación de IA. Intenta de nuevo en unos segundos.');
    }
});
/**
 * Verifica y captura un pago PayPal server-side antes de activar el tenant.
 * Esto previene que se creen tenants sin pago real.
 */
exports.verifyPaypalOrder = (0, https_1.onCall)({}, async (request) => {
    // SEGURIDAD: antes era publica y cualquiera podia invocarla con un orderId
    // arbitrario, intentando capturar/replay pagos de otros tenants.
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Debes iniciar sesion para verificar pagos.');
    }
    const { orderId, tenantId } = request.data;
    // Validacion estricta del orderId (PayPal usa IDs alfanumericos cortos)
    if (!orderId || typeof orderId !== 'string' || !/^[A-Z0-9_-]{6,40}$/i.test(orderId)) {
        throw new https_1.HttpsError('invalid-argument', 'orderId invalido');
    }
    if (tenantId !== undefined && (typeof tenantId !== 'string' || tenantId.length > 100)) {
        throw new https_1.HttpsError('invalid-argument', 'tenantId invalido');
    }
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
        throw new https_1.HttpsError('internal', 'PayPal no está configurado en el servidor');
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
        const tokenRes = await axios_1.default.post('https://api-m.paypal.com/v1/oauth2/token', 'grant_type=client_credentials', {
            auth: { username: clientId, password: clientSecret },
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
        });
        const accessToken = tokenRes.data.access_token;
        // Capturar el pago
        const captureRes = await axios_1.default.post(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {}, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        const order = captureRes.data;
        if (order.status !== 'COMPLETED') {
            throw new https_1.HttpsError('failed-precondition', `Pago no completado: ${order.status}`);
        }
        // Registrar el pago en Firestore
        await db.collection('paypal_orders').doc(orderId).set({
            orderId,
            status: order.status,
            amount: order.purchase_units?.[0]?.payments?.captures?.[0]?.amount ?? null,
            payer: order.payer ?? null,
            capturedAt: admin.firestore.FieldValue.serverTimestamp(),
            tenantId: tenantId ?? null,
            requestedBy: request.auth.uid,
        });
        return { success: true, orderId, status: order.status };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        console.error('[verifyPaypalOrder] PayPal API error:', err?.response?.data || err?.message || err);
        // No exponer detalles del backend de PayPal al cliente
        throw new https_1.HttpsError('internal', 'No se pudo verificar el pago. Intenta de nuevo.');
    }
});
/**
 * Chequeo automático de ventana de 24h de WhatsApp.
 *
 * Cada 15 minutos:
 * - PASO 1 (23h–23.5h sin respuesta): Envía mensaje de re-engagement antes de que expire la ventana.
 * - PASO 2 (>25h sin respuesta + re-engagement ya enviado): Mueve el lead a "Perdido" en el CRM.
 */
exports.checkWindowExpiry = (0, scheduler_1.onSchedule)({
    schedule: 'every 15 minutes',
    timeZone: 'America/Mexico_City',
    memory: '256MiB',
    timeoutSeconds: 300,
}, async () => {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    // Caché por tenant para evitar múltiples lecturas de Firestore
    const integrationCache = {};
    const settingsCache = {};
    const getIntegration = async (tenantId) => {
        if (integrationCache[tenantId] !== undefined)
            return integrationCache[tenantId];
        const snap = await db.collection('integrations')
            .where('tenantId', '==', tenantId)
            .where('isActive', '==', true)
            .limit(1)
            .get();
        integrationCache[tenantId] = snap.empty ? null : snap.docs[0].data();
        return integrationCache[tenantId];
    };
    const getSettings = async (tenantId) => {
        if (settingsCache[tenantId] !== undefined)
            return settingsCache[tenantId];
        const snap = await db.collection('settings').doc(tenantId).get();
        settingsCache[tenantId] = snap.data() || {};
        return settingsCache[tenantId];
    };
    // ── PASO 1: Enviar re-engagement (ventana entre 23h y 23.5h atrás) ──
    const p1Start = admin.firestore.Timestamp.fromMillis(now - 23.5 * HOUR);
    const p1End = admin.firestore.Timestamp.fromMillis(now - 23 * HOUR);
    const approaching = await db.collection('conversations')
        .where('status', '==', 'active')
        .where('source', '==', 'whatsapp')
        .where('lastInboundDate', '>=', p1Start)
        .where('lastInboundDate', '<=', p1End)
        .limit(50)
        .get();
    console.log(`[WindowExpiry] Paso 1: ${approaching.size} conversaciones cerca del límite`);
    for (const convDoc of approaching.docs) {
        const conv = convDoc.data();
        if (conv.reEngagementSent)
            continue; // Ya enviado — no repetir
        const integration = await getIntegration(conv.tenantId);
        if (!integration?.phoneNumberId || !integration?.accessToken)
            continue;
        const phone = conv.phoneE164 || conv.phoneRaw;
        if (!phone)
            continue;
        const settings = await getSettings(conv.tenantId);
        const businessName = settings.tradeName || settings.companyName || 'el proyecto';
        const firstName = (conv.contactName || '').split(' ')[0] || '';
        const isGeneric = !firstName || /^(usuario|desconocido|cliente|sin\s)/i.test(firstName);
        const greeting = isGeneric ? '¡Hola!' : `${firstName},`;
        const reEngagementMsg = `${greeting} Antes de que se cierre nuestra ventana de chat, ¿te gustaría que te agreguemos a nuestra lista de seguimiento de *${businessName}*?\n\n` +
            `Te enviaríamos fotos, videos y novedades del proyecto. Solo responde *SÍ* para mantenerte informado/a. 🏡`;
        try {
            await axios_1.default.post(`https://graph.facebook.com/v17.0/${integration.phoneNumberId}/messages`, {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: phone.replace('+', ''),
                type: 'text',
                text: { body: reEngagementMsg }
            }, { headers: { Authorization: `Bearer ${integration.accessToken}`, 'Content-Type': 'application/json' } });
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
        }
        catch (err) {
            console.error(`[WindowExpiry] Error enviando re-engagement a ${phone}:`, err?.response?.data || err.message);
        }
    }
    // ── PASO 2: Mover a "Perdido" si no respondió después de 25h ──
    const p2Cutoff = admin.firestore.Timestamp.fromMillis(now - 25 * HOUR);
    const expired = await db.collection('conversations')
        .where('status', '==', 'active')
        .where('source', '==', 'whatsapp')
        .where('lastInboundDate', '<=', p2Cutoff)
        .limit(50)
        .get();
    console.log(`[WindowExpiry] Paso 2: ${expired.size} conversaciones expiradas para evaluar`);
    for (const convDoc of expired.docs) {
        const conv = convDoc.data();
        // Solo procesar si ya enviamos el re-engagement y el cliente no ha respondido
        if (!conv.reEngagementSent || !conv.leadId)
            continue;
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
        }
        catch (err) {
            console.error(`[WindowExpiry] Error moviendo a Perdido lead ${conv.leadId}:`, err.message);
        }
    }
    console.log('[WindowExpiry] Ejecución completada.');
});
//# sourceMappingURL=index.js.map