import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  LiveVideoError, authorizeLiveVideoCall, composeChatLiveVideo, deleteChatLiveVideoJob, isSafePathId, isValidJobId, type BucketLike,
} from './chatLiveVideoCore';

// Live Video PRODUCTIVO. Los chunks los sube el cliente directo a Storage
// (chat-live-video/{tenantId}/{conversationId}/{uid}/{jobId}/, ver storage.rules);
// esta función solo los compone y devuelve la URL con token para enviar por el
// pipeline normal (ConversationService.sendMessage → sendWhatsappMessage).
// El uid sale SIEMPRE de request.auth, nunca del payload.
export const chatLiveVideo = onCall({ maxInstances: 10, memory: '256MiB', timeoutSeconds: 90 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Usuario no autenticado');
  const uid = request.auth.uid;
  const { action, tenantId, conversationId, jobId, chunkCount, mimeType } = request.data as {
    action?: string; tenantId?: string; conversationId?: string; jobId?: string; chunkCount?: number; mimeType?: string;
  };
  if (!isSafePathId(tenantId) || !isSafePathId(conversationId) || !isValidJobId(jobId)) {
    throw new HttpsError('invalid-argument', 'Parámetros inválidos');
  }
  if (action !== 'compose' && action !== 'delete') throw new HttpsError('invalid-argument', 'action inválida');

  const db = admin.firestore();
  const [userSnap, membershipSnap, convSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('memberships').doc(`${uid}_${tenantId}`).get(),
    db.collection('conversations').doc(conversationId).get(),
  ]);
  const membershipData = membershipSnap.data();
  const auth = authorizeLiveVideoCall({
    isSuperAdmin: userSnap.exists && userSnap.data()?.isSuperAdmin === true,
    membership: membershipSnap.exists && membershipData ? { status: membershipData.status, role: membershipData.role } : null,
    conversationTenantId: convSnap.exists ? String(convSnap.data()?.tenantId ?? '') : null,
    requestedTenantId: tenantId,
  });
  if (!auth.ok) throw new HttpsError(auth.code, auth.message);

  const bucket = admin.storage().bucket() as unknown as BucketLike & { name: string };
  const base = { tenantId, conversationId, uid, jobId };
  try {
    if (action === 'delete') {
      return { ok: true, deleted: await deleteChatLiveVideoJob(bucket, base) };
    }
    const t0 = Date.now();
    const token = crypto.randomUUID();
    const { finalName, sizeBytes } = await composeChatLiveVideo(bucket, { ...base, chunkCount: chunkCount as number, mimeType, token });
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(finalName)}?alt=media&token=${token}`;
    console.log('CHAT_LIVE_VIDEO_COMPOSED', { tenantId, conversationId, jobId, chunkCount, sizeBytes, ms: Date.now() - t0 });
    return { ok: true, url, sizeBytes };
  } catch (e) {
    if (e instanceof LiveVideoError) throw new HttpsError(e.code, e.message);
    console.error('[chatLiveVideo] error inesperado:', e instanceof Error ? e.message : e);
    throw new HttpsError('internal', 'No se pudo preparar el video.');
  }
});
