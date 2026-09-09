import {
  doc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { db } from '@/lib/firebase';
import { UserPresence, OperationalStatus, WorkSession } from '@/types';

export const PresenceService = {
  /**
   * Actualiza el estado de presencia de un usuario.
   * Se usa un ID compuesto {tenantId}_{uid} para facilitar consultas por tenant.
   */
  updatePresence: async (presence: Partial<UserPresence>) => {
    if (!presence.uid || !presence.tenantId) return;

    const presenceId = `${presence.tenantId}_${presence.uid}`;
    const docRef = doc(db, 'user_presence', presenceId);

    await setDoc(docRef, {
      ...presence,
      updatedAt: serverTimestamp()
    }, { merge: true });
  },

  /**
   * Suscribe a todos los estados de presencia de los usuarios de un tenant.
   */
  subscribeToTenantPresence: (tenantId: string, callback: (presenceList: UserPresence[]) => void) => {
    const q = query(
      collection(db, 'user_presence'),
      where('tenantId', '==', tenantId)
    );

    return onSnapshot(q, (snapshot) => {
      const presenceList = snapshot.docs.map(doc => ({
        ...doc.data(),
        uid: (doc.data() as any).uid || doc.id.split('_')[1], // fallback if uid missing
      })) as UserPresence[];
      callback(presenceList);
    });
  },

  /**
   * Cambia el estado operativo del vendedor — thin wrapper sobre la Cloud
   * Function setOperationalStatus (Admin SDK). CHECKPOINT DE SEGURIDAD:
   * este servicio YA NO escribe operationalStatus/work_sessions/
   * work_status_events directamente desde el cliente — Firestore Rules lo
   * bloquean con "if false" (ver firestore.rules). El servidor resuelve
   * uid/tenantId/timestamps; el cliente solo pide el cambio.
   */
  setOperationalStatus: async (tenantId: string, toStatus: OperationalStatus) => {
    const fn = httpsCallable<{ tenantId: string; status: OperationalStatus }, { status: OperationalStatus }>(
      getFunctions(), 'setOperationalStatus'
    );
    await fn({ tenantId, status: toStatus });
  },

  /**
   * Heartbeat de turno — thin wrapper sobre tickPresence (Admin SDK). El
   * cliente NUNCA envía una cantidad de segundos: solo `hadActivity`
   * (señal de baja confianza, ver usePresenceTracker) — el servidor calcula
   * el tiempo real transcurrido desde su propio último tick.
   */
  tickPresence: async (tenantId: string, hadActivity: boolean) => {
    const fn = httpsCallable<{ tenantId: string; hadActivity: boolean }, { ticked: boolean }>(
      getFunctions(), 'tickPresence'
    );
    await fn({ tenantId, hadActivity });
  },

  /**
   * Panel Owner/Admin (Fase 10) — la sesión de turno MÁS RECIENTE de cada
   * vendedor del tenant (abierta o recién cerrada), para mostrar "Turno de
   * hoy" / tiempo activo sin que cada fila del panel dispare su propia
   * query. Requiere el índice compuesto tenantId+startedAt (ver
   * firestore.indexes.json) — se pide un límite generoso y se agrupa por
   * userId en el cliente quedándose con la primera (más reciente) de cada uno.
   */
  subscribeToTenantWorkSessions: (tenantId: string, callback: (sessions: WorkSession[]) => void) => {
    const q = query(
      collection(db, 'work_sessions'),
      where('tenantId', '==', tenantId),
      orderBy('startedAt', 'desc'),
      limit(200)
    );

    return onSnapshot(q, (snapshot) => {
      const seen = new Set<string>();
      const latestPerUser: WorkSession[] = [];
      snapshot.docs.forEach((d) => {
        const data = d.data() as Omit<WorkSession, 'id'>;
        if (seen.has(data.userId)) return;
        seen.add(data.userId);
        latestPerUser.push({ id: d.id, ...data });
      });
      callback(latestPerUser);
    });
  },
};
