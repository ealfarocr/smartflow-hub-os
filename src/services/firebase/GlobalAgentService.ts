import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface GlobalAgentFile {
  name: string;
  url: string;
  type?: string;
  size?: number;
  content?: string;
  description?: string;
}

export interface GlobalAgentConfig {
  generalInstructions: string;
  knowledgeFiles: GlobalAgentFile[];
  mediaLibrary: GlobalAgentFile[];
}

const DEFAULT: GlobalAgentConfig = {
  generalInstructions: '',
  knowledgeFiles: [],
  mediaLibrary: [],
};

/**
 * Base GLOBAL del Agente IA: instrucciones y documentos que se aplican a TODOS
 * los negocios (actuales y futuros). Se guarda en config/agent_global.
 * Solo el SuperAdmin la edita (regla de Firestore); los negocios solo la heredan.
 */
export const GlobalAgentService = {
  async get(): Promise<GlobalAgentConfig> {
    const snap = await getDoc(doc(db, 'config', 'agent_global'));
    if (!snap.exists()) return { ...DEFAULT };
    return { ...DEFAULT, ...(snap.data() as any) };
  },

  async save(config: Partial<GlobalAgentConfig>): Promise<void> {
    await setDoc(doc(db, 'config', 'agent_global'), config, { merge: true });
  },
};
