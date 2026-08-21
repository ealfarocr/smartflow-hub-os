import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import * as Busboy from 'busboy';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import sgMail from '@sendgrid/mail';
import axios from 'axios';

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

// Limpia entradas expiradas del mapa cada 5 minutos para evitar memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now - val.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

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
- Maneja objeciones con seguridad y reencuadre al valor, nunca con evasivas.
- CIERRE VARIADO: alterna el siguiente paso — a veces envías el documento, a veces das el precio y preguntas cuál le interesa, a veces propones la visita. NUNCA termines todos los mensajes con la misma frase "¿te gustaría agendar una cita?": eso te delata como robot y se ve poco profesional.

REGLAS ESTRICTAS:
- Los precios en los documentos son los precios FINALES de contado en preventa. No existe ningún descuento adicional por pagar de contado — ese ya es el precio más bajo disponible.
- Nunca inventes precios, descuentos o condiciones que no estén explícitamente en los documentos.
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

PROPONER LA VISITA PROACTIVAMENTE (crítico — no esperes a que el cliente la pida):
La visita es lo que más vende: de cada 10 personas que agendan, ~4 compran. Preguntar sin agendar casi nunca cierra. Por eso, en cuanto el cliente muestre interés real (pregunta precio, ubicación, disponibilidad, financiamiento) y ya le diste 2 o 3 respuestas de valor, EL SIGUIENTE PASO NO ES otra pregunta ni otro dato: es invitarlo a verlo en persona.
- Ofrece la visita vos, con dos opciones concretas de día, en vez de esperar a que el cliente proponga fecha: "¿Te gustaría verlo en persona? Tengo espacio este sábado o el domingo, ¿cuál te acomoda?"
- No lo repitas en cada mensaje (ver CIERRE VARIADO) — pero si ya van 2-3 respuestas sin que le hayas ofrecido la visita, tu próxima respuesta debe incluir esa invitación.
- Si el cliente no responde a la invitación o cambia de tema, no insistas en el mismo mensaje — sigue la conversación y retoma la invitación más adelante, natural.

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

    // POST-PROCESADO: detectar cierres del cliente y evitar bucles de preguntas
    const closurePatterns = /^(si|sí|si claro|claro|ok|okay|perfecto|de acuerdo|ah bueno|bueno|entendido|listo|quedo atenta?|estoy pendiente|gracias|hasta luego|👍|🙏|bien|excelente|genial|ándale|va|dale)[\s!.]*$/i;
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
      const pipelineStages: any[] = settingsData.pipeline?.stages || [];
      const idForAction: Record<string, string> = {
        seguimiento: 'seguimiento', visita: 'visita-tecnica', venta: 'venta-realizada', perdido: 'perdido',
      };
      const kwForAction: Record<string, RegExp> = {
        seguimiento: /seguim/i, visita: /agend|visita|cita/i, venta: /venta|vendid|cerrad|ganad/i, perdido: /perd/i,
      };
      const fallbackLabel: Record<string, string> = {
        seguimiento: 'Seguimiento', visita: 'Agendado', venta: 'Venta Realizada', perdido: 'Perdido',
      };
      const resolveStageLabel = (action: string): string | undefined => {
        const byId = pipelineStages.find((s) => s.id === idForAction[action]);
        if (byId?.label) return byId.label;
        const kw = kwForAction[action];
        const byKw = kw ? pipelineStages.find((s) => kw.test(s.label || '')) : undefined;
        if (byKw?.label) return byKw.label;
        return fallbackLabel[action];
      };
      const newStage = resolveStageLabel(crmAction);
      if (newStage) {
        await db.collection('leads').doc(convData.leadId).update({
          stage: newStage,
          lastActivity: new Date().toISOString(),
        }).catch((e: any) => console.warn('[AI Autopilot] CRM update error:', e.message));
        console.log(`[AI Autopilot] CRM: Lead ${convData.leadId} → ${newStage}`);
      }

      if (crmAction === 'venta') {
        await db.collection('notifications').add({
          tenantId,
          type: 'venta_cerrada',
          title: '¡Venta cerrada! 🎉',
          body: `${convData.contactName || 'Cliente'} confirmó la compra`,
          link: '/crm',
          leadId: convData.leadId,
          conversationId,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch((e: any) => console.warn('[AI Autopilot] Notif venta error:', e.message));
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
              // El bot queda ON por defecto si el tenant tiene el Piloto Automático activado
              // (isAiAutomated). El asesor puede apagarlo por chat con el toggle "Bot ON/OFF".
              botEnabled: integrationData.isAiAutomated === true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              advisorId: 'u-1'
            });
            conversationId = newConvRef.id;
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
                const filePath = `whatsapp-media/${tenantId}/${Date.now()}.${ext}`;
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
              // Bot ON por defecto si el tenant tiene el Piloto Automático activado
              botEnabled: integrationData.isAiAutomated === true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              advisorId: 'u-1',
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
  const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
  const membershipDoc = await membershipRef.get();

  if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
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
      console.error('[Diagnostic] Meta API Error:', JSON.stringify(bodyData));
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

  const membershipRef = db.collection('memberships').doc(`${uid}_${tenantId}`);
  const membershipDoc = await membershipRef.get();
  if (!membershipDoc.exists || membershipDoc.data()?.status !== 'active') {
    throw new HttpsError('permission-denied', 'No tienes una membresía activa en este tenant');
  }

  const metaAppId = '265699977219364152'; // Meta App ID de SmartFlow Hub Connect (público)
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
    wabaId,
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
    } else {
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

    // Registrar el pago en Firestore
    await db.collection('paypal_orders').doc(orderId).set({
      orderId,
      status: order.status,
      amount: order.purchase_units?.[0]?.payments?.captures?.[0]?.amount ?? null,
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

    const getIntegration = async (tenantId: string) => {
      if (integrationCache[tenantId] !== undefined) return integrationCache[tenantId];
      const snap = await db.collection('integrations')
        .where('tenantId', '==', tenantId)
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

