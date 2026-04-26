import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

admin.initializeApp();

const db = admin.firestore();

/**
 * Validar la firma HMAC de Meta
 */
function validateSignature(payload: any, signature: string, secret: string) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  const expectedSignature = `sha256=${hash}`;
  return signature === expectedSignature;
}

/**
 * Webhook de WhatsApp Cloud API
 */
export const whatsappWebhook = functions.https.onRequest(async (req, res) => {
  // 1. Verificación del Webhook (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Buscar integración por Verify Token
    const integrationsSnapshot = await db.collection('integrations')
      .where('verifyToken', '==', token)
      .limit(1)
      .get();
      
    // Fallback al token global si no se encuentra en DB
    const globalVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'psmx_verify_token_dev';

    if (mode === 'subscribe' && (!integrationsSnapshot.empty || token === globalVerifyToken)) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).type('text/plain').send(challenge);
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
          const phoneE164 = `+${waId}`;
          const contactName = contact.profile?.name || phoneE164;
          const text = message.text?.body || '[Mensaje no textual]';

          // D. UPSERT LEAD
          let leadId = '';
          const leadsSnapshot = await db.collection('leads')
            .where('tenantId', '==', tenantId)
            .where('phone', '==', waId) // O phoneE164 según tu seed anterior
            .limit(1)
            .get();

          if (leadsSnapshot.empty) {
            const newLeadRef = await db.collection('leads').add({
              tenantId,
              name: contactName,
              phone: waId,
              city: 'Desconocido',
              clientType: 'Residencial',
              keyData: 'Pendiente de calificar',
              advisorId: 'u-1', // Default or unassigned
              source: 'WhatsApp',
              stage: 'Nuevo',
              lastActivity: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              orderIndex: 0
            });
            leadId = newLeadRef.id;
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
              lastMessageSender: 'lead',
              unreadCount: 1,
              status: 'active',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              advisorId: 'u-1'
            });
            conversationId = newConvRef.id;
          } else {
            conversationId = convSnapshot.docs[0].id;
          }

          // F. TRANSACTIONAL PERSISTENCE (DEDUPLICATION + INSERCIÓN)
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
              type: 'text',
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

  if (!conversationId || !text || !tenantId) {
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
      console.log(`[Diagnostic] Adjuntando Documento PDF. Filename: ${mediaFilename}`);
      messagePayload.type = 'document';
      messagePayload.document = {
        link: mediaUrl,
        filename: mediaFilename || 'Documento adjunto',
        caption: text // Draft body attached as pdf caption
      };
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
  let finalMessageText = text;
  if (mediaUrl) {
    if (status === 'sent') {
      finalMessageText = `[Documento Enviado: ${mediaFilename || 'PDF'}]\n${text}`;
    } else {
      finalMessageText = `[Error al enviar Documento: ${mediaFilename || 'PDF'}]\n${text}`;
    }
  }

  const messageData = {
    text: finalMessageText,
    sender: 'advisor',
    direction: 'outbound',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    type: templateName ? 'template' : (mediaUrl ? 'document' : 'text'),
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
