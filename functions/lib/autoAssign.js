"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickNextAdvisor = pickNextAdvisor;
exports.assignConversationAdvisor = assignConversationAdvisor;
exports.ensureConversationAdvisor = ensureConversationAdvisor;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Siguiente asesor después del cursor en una lista ya ordenada y estable.
 * Cursor ausente o que ya no es elegible (deshabilitado/fuera de turno) =
 * arranca desde el primero; nunca devuelve a alguien fuera de la lista.
 */
function pickNextAdvisor(eligibleIds, cursor) {
    if (eligibleIds.length === 0)
        return null;
    const cursorIndex = cursor ? eligibleIds.indexOf(cursor) : -1;
    const nextIndex = (cursorIndex + 1) % eligibleIds.length;
    return { selected: eligibleIds[nextIndex], cursorIndex, nextIndex };
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
 *
 * notifyIfNoEligible=false se usa al REINTENTAR una conversación que ya
 * existía sin asesor, para no crear una notificación por cada mensaje.
 */
async function assignConversationAdvisor(db, tenantId, opts = {}) {
    const notifyIfNoEligible = opts.notifyIfNoEligible !== false;
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
            const includedUserIds = Array.isArray(multiAgentConfig.includedUserIds) ? multiAgentConfig.includedUserIds : [];
            // null/undefined = todos los active+incluidos son elegibles (fallback,
            // comportamiento por defecto); array explícito = lista curada — ver
            // sección 8: este toggle NO afecta el estado de la cuenta del vendedor.
            const leadEnabledUserIds = Array.isArray(multiAgentConfig.leadEnabledUserIds) ? multiAgentConfig.leadEnabledUserIds : null;
            const candidateIds = [];
            membershipsSnap.forEach(doc => {
                const m = doc.data();
                if (m.status !== 'active')
                    return;
                const identifier = m.userId || doc.id;
                if (!includedUserIds.includes(identifier))
                    return;
                if (leadEnabledUserIds !== null && !leadEnabledUserIds.includes(identifier))
                    return;
                candidateIds.push(identifier);
            });
            // LOOP — dispositivo confiable + estado operativo: solo quien puso
            // 'working' entra al pool de asignación AUTOMÁTICA. coffee/lunch/
            // errand/off_shift lo sacan del round-robin sin tocar las conversaciones
            // que ya tenía asignadas (eso no cambia acá, solo futuras asignaciones).
            // Sin doc de presencia todavía (o sin operationalStatus) = tratar como
            // off_shift, nunca 'working' por defecto (ver Fase 21 - migración).
            const presenceSnaps = await Promise.all(candidateIds.map(id => tx.get(db.collection('user_presence').doc(`${tenantId}_${id}`))));
            const eligibleIds = candidateIds.filter((_, i) => {
                const presence = presenceSnaps[i];
                return presence.exists && presence.data()?.operationalStatus === 'working';
            });
            // Orden determinístico y estable — el round-robin necesita una
            // secuencia fija para que "el siguiente después del cursor" tenga
            // sentido entre llamadas.
            eligibleIds.sort();
            console.log('MULTI_AGENT_ELIGIBLE_ADVISORS', { tenantId, candidateIds, eligibleIds });
            const pick = pickNextAdvisor(eligibleIds, multiAgentConfig.roundRobinCursor);
            if (!pick) {
                console.warn('MULTI_AGENT_NO_ELIGIBLE_ADVISORS', { tenantId });
                if (notifyIfNoEligible) {
                    const notifRef = db.collection('notifications').doc();
                    tx.set(notifRef, {
                        tenantId,
                        type: 'multi_agent_unassigned',
                        title: 'Conversación sin asignar ⚠️',
                        body: 'Llegó una conversación nueva pero no hay ningún asesor elegible para recibir leads automáticamente. Revisá Multi-Agente.',
                        link: '/multi-agent',
                        read: false,
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
                return { advisorId: null, assignmentSource: 'unassigned_no_eligible' };
            }
            console.log('MULTI_AGENT_ROUND_ROBIN_SELECTED', { tenantId, selected: pick.selected, cursorIndex: pick.cursorIndex, nextIndex: pick.nextIndex, eligibleCount: eligibleIds.length });
            tx.update(settingsRef, {
                'multiAgentConfig.roundRobinCursor': pick.selected,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            console.log('MULTI_AGENT_ASSIGNMENT_SUCCESS', { tenantId, advisorId: pick.selected });
            return { advisorId: pick.selected, assignmentSource: 'auto_round_robin' };
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[MultiAgente] Error en assignConversationAdvisor:', message);
        return { advisorId: null, assignmentSource: 'unassigned_error' };
    }
}
/**
 * Una conversación que YA existe pero quedó sin asesor (no había nadie
 * elegible cuando nació, error transitorio) se reintenta cuando el lead
 * vuelve a escribir. Una conversación que YA tiene asesor no se toca jamás:
 * el round-robin es por conversación nueva, nunca por mensaje. El update es
 * condicional dentro de una transacción para no pisar una asignación que
 * llegó en paralelo (claim manual o reasignación).
 */
async function ensureConversationAdvisor(db, tenantId, conversationId, leadId) {
    const convRef = db.collection('conversations').doc(conversationId);
    const convSnap = await convRef.get();
    if (!convSnap.exists || convSnap.data()?.advisorId)
        return null;
    const assignment = await assignConversationAdvisor(db, tenantId, { notifyIfNoEligible: false });
    if (!assignment.advisorId)
        return assignment;
    const applied = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(convRef);
        if (!fresh.exists || fresh.data()?.advisorId)
            return false;
        tx.update(convRef, {
            advisorId: assignment.advisorId,
            assignmentSource: assignment.assignmentSource,
            assignedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return true;
    });
    if (applied && leadId) {
        const leadRef = db.collection('leads').doc(leadId);
        const leadSnap = await leadRef.get();
        if (leadSnap.exists && !leadSnap.data()?.advisorId) {
            await leadRef.update({ advisorId: assignment.advisorId }).catch((e) => console.warn('[MultiAgente] No se pudo propagar advisorId al lead:', e.message));
        }
    }
    console.log('MULTI_AGENT_REASSIGN_UNASSIGNED', { tenantId, conversationId, advisorId: assignment.advisorId, applied });
    return assignment;
}
//# sourceMappingURL=autoAssign.js.map