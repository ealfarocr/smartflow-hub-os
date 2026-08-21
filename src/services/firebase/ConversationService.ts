import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  addDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  Timestamp,
  writeBatch,
  limit,
  increment
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { Conversation, Message } from '@/types';

export class ConversationService {
  private static collectionName = 'conversations';
  private static functions = getFunctions();

  static subscribeToInbox(tenantId: string, callback: (conversations: Conversation[]) => void, errorCallback?: (error: any) => void) {
    const q = query(
      collection(db, this.collectionName),
      where('tenantId', '==', tenantId),
      where('status', 'in', ['active', 'bot_handling']),
      orderBy('lastMessageDate', 'desc')
    );

    return onSnapshot(q, (snapshot) => {
      const conversations = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        lastMessageDate: doc.data().lastMessageDate instanceof Timestamp 
          ? doc.data().lastMessageDate.toDate().toISOString() 
          : doc.data().lastMessageDate,
        lastInboundDate: doc.data().lastInboundDate instanceof Timestamp 
          ? doc.data().lastInboundDate.toDate().toISOString() 
          : doc.data().lastInboundDate
      })) as Conversation[];
      callback(conversations);
    }, (error) => {
      console.error("Error subscribing to inbox:", error);
      if (errorCallback) errorCallback(error);
    });
  }

  static subscribeToMessages(conversationId: string, callback: (messages: Message[]) => void, errorCallback?: (error: any) => void) {
    // orderBy 'asc' + limit trae los N mensajes MAS VIEJOS, no los recientes.
    // Se pide 'desc' (los mas nuevos primero) y se revierte el array antes de
    // mostrarlo, para que el chat no se quede congelado una vez que la
    // conversacion pasa de 100 mensajes.
    const q = query(
      collection(db, this.collectionName, conversationId, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(100) // Optimization: latest 100 messages
    );

    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id,
        timestamp: doc.data().timestamp instanceof Timestamp
          ? doc.data().timestamp.toDate().toISOString()
          : doc.data().timestamp
      })).reverse() as Message[];
      callback(messages);
    }, (error) => {
      console.error("Error subscribing to messages:", error);
      if (errorCallback) errorCallback(error);
    });
  }

  static async sendMessage(
    conversationId: string, 
    text: string, 
    sender: 'advisor' | 'lead', 
    tenantId?: string, 
    mediaUrl?: string | null, 
    mediaFilename?: string | null,
    templateName?: string,
    languageCode?: string,
    components?: any[],
    source: string = 'whatsapp'
  ) {
    if (sender === 'lead') {
      const batch = writeBatch(db);
      const msgRef = doc(collection(db, this.collectionName, conversationId, 'messages'));
      batch.set(msgRef, {
        text,
        sender,
        direction: 'inbound',
        timestamp: serverTimestamp(),
        type: 'text'
      });
      const convRef = doc(db, this.collectionName, conversationId);
      batch.update(convRef, {
        lastMessage: text,
        lastMessageDate: serverTimestamp(),
        lastInboundDate: serverTimestamp(),
        lastMessageSender: sender,
        unreadCount: increment(1),
        updatedAt: serverTimestamp()
      });
      await batch.commit();
      return;
    }

    // ADVISOR OUTBOUND
    if (!tenantId) throw new Error('TenantId is required for advisor outbound');
    
    // Choose function based on source
    const functionName = source === 'whatsapp' ? 'sendWhatsappMessage' : 'sendMetaMessage';
    const sendFn = httpsCallable(this.functions, functionName);
    
    const result = await sendFn({
      conversationId,
      text,
      tenantId,
      source,
      ...(mediaUrl && { mediaUrl }),
      ...(mediaFilename && { mediaFilename }),
      ...(templateName && { templateName }),
      ...(languageCode && { languageCode }),
      ...(components && { components })
    });

    return result.data;
  }

  static async markAsRead(conversationId: string) {
    const convRef = doc(db, this.collectionName, conversationId);
    await updateDoc(convRef, {
      unreadCount: 0,
      updatedAt: serverTimestamp()
    });
  }

  static async assignAgent(conversationId: string, advisorId: string) {
    const convRef = doc(db, this.collectionName, conversationId);
    await updateDoc(convRef, {
      advisorId,
      updatedAt: serverTimestamp()
    });
  }

  static async toggleBot(conversationId: string, enabled: boolean) {
    const convRef = doc(db, this.collectionName, conversationId);
    await updateDoc(convRef, {
      botEnabled: enabled,
      updatedAt: serverTimestamp()
    });
  }

  static async createConversation(tenantId: string, data: Partial<Conversation>) {
    const docRef = await addDoc(collection(db, this.collectionName), {
      ...data,
      tenantId,
      status: 'active',
      unreadCount: data.unreadCount || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageDate: serverTimestamp()
    });
    return docRef.id;
  }

  static async seedSampleConversations(tenantId: string, advisorId: string) {
    const samples = [
      {
        contactName: 'Carlos Mendoza',
        phoneRaw: '5512345678',
        phoneE164: '+525512345678',
        phoneSearchKey: '5512345678',
        lastMessage: 'Hola, me interesa cotizar para mi casa',
        lastMessageSender: 'lead' as const,
        unreadCount: 1,
        aiSentiment: 'positive' as const,
        aiSuggestedReply: '¡Hola Carlos! Claro que sí, ¿te gustaría que agendemos una visita técnica para dimensionar tu sistema?'
      },
      {
        contactName: 'Empresa Alpha',
        phoneRaw: '8119876543',
        phoneE164: '+528119876543',
        phoneSearchKey: '8119876543',
        lastMessage: 'Gracias por la información',
        lastMessageSender: 'advisor' as const,
        unreadCount: 0,
        aiSentiment: 'neutral' as const
      }
    ];

    for (const s of samples) {
      const convId = await this.createConversation(tenantId, {
        ...s,
        advisorId,
      });
      
      // Add first message to sub-collection
      await this.sendMessage(convId, s.lastMessage, s.lastMessageSender, tenantId);

      // If last message was from lead, update lastInboundDate for the window counter
      if (s.lastMessageSender === 'lead') {
        const convRef = doc(db, this.collectionName, convId);
        await updateDoc(convRef, {
          lastInboundDate: serverTimestamp()
        });
      }
    }
  }
}
