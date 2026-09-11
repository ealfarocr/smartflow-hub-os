// Texto del botón "Copiar diagnóstico" del panel QA multimedia, y la
// explicación de por qué no hay controles del chat en pantalla. Funciones puras
// (sin DOM) para poder probarlas; el panel les pasa lo que ve.
//
// Nunca incluye contenido de mensajes, nombres ni teléfonos: solo el entorno del
// navegador, el estado del chat y los pasos registrados (que ya son metadatos).

import type { DeviceEnvironment, MediaDiagEvent } from './mediaDiag';

export interface ChatDiagState {
  /** En el teléfono la lista y el chat se alternan: sin conversación abierta no hay composer. */
  conversacionAbierta: boolean;
  /** Estado de la ventana de 24 h de WhatsApp de la conversación abierta. */
  ventana: 'active' | 'expiring' | 'expired' | null;
  grabando: boolean;
}

/** Controles del chat presentes en el DOM y cuáles tienen tamaño (visibles). */
export interface ControlsSnapshot {
  enDom: string[];
  visibles: string[];
}

/**
 * Por qué no hay 📎 / 📷 en pantalla, en palabras. Antes el panel decía solo "no
 * hay controles en pantalla" y parecía una falla del detector, cuando en
 * realidad el composer no estaba dibujado (lista de conversaciones abierta,
 * ventana de 24 h vencida o grabando una nota de voz).
 */
export function explainMissingControls(chat: ChatDiagState | null, controls: ControlsSnapshot): string {
  if (controls.visibles.length) return `visibles: ${controls.visibles.join(', ')}`;
  if (!chat) return 'fuera del chat: esta pantalla no tiene 📎 ni 📷';
  if (!chat.conversacionAbierta) return 'no hay conversación abierta (estás en la lista): abrí una para ver 📎 y 📷';
  if (chat.ventana === 'expired') return 'ventana de 24 h vencida: el chat muestra "Reactivar chat" en lugar de 📎 y 📷';
  if (chat.grabando) return 'grabando nota de voz: 📎 y 📷 se ocultan mientras dura';
  if (controls.enDom.length) return `en el DOM pero sin tamaño (ocultos): ${controls.enDom.join(', ')}`;
  return 'conversación abierta pero el composer no está en el DOM';
}

export interface DiagnosticReportInput {
  now: Date;
  url: string;
  env: DeviceEnvironment;
  viewport: { w: number; h: number; dpr: number; visualH?: number };
  chat: ChatDiagState | null;
  controls: ControlsSnapshot;
  events: MediaDiagEvent[];
}

const yesNo = (v: boolean) => (v ? 'sí' : 'no');

export function buildDiagnosticText(r: DiagnosticReportInput): string {
  const lines: string[] = [];
  lines.push(`SmartFlow MEDIA_DIAG — ${r.now.toLocaleString('es-CR', { hour12: false })}`);
  lines.push(`Ruta: ${r.url}`);
  lines.push(
    `Navegador: ${r.env.browser} · Embebido: ${r.env.embedded ?? 'no'} · showPicker: ${yesNo(r.env.showPickerApi)}` +
    ` · Táctil: ${yesNo(r.env.touch)} (${r.env.maxTouchPoints} puntos) · PWA instalada: ${yesNo(r.env.standalonePwa)}`,
  );
  lines.push(`Contenedor: ${r.env.container} · display-mode: ${r.env.displayMode} · marcas: ${r.env.brands}${r.env.referrerApp ? ` · abierta por ${r.env.referrerApp}` : ''}`);
  lines.push(`Pantalla: ${r.viewport.w}x${r.viewport.h} @${r.viewport.dpr}x${r.viewport.visualH ? ` · visible ${r.viewport.visualH}px de alto` : ''}`);
  lines.push(`UA: ${r.env.userAgent}`);
  if (r.chat) {
    lines.push(
      `Chat: conversación abierta ${yesNo(r.chat.conversacionAbierta)} · ventana 24 h ${r.chat.ventana ?? '-'} · grabando ${yesNo(r.chat.grabando)}`,
    );
  }
  lines.push(`Controles del chat: ${explainMissingControls(r.chat, r.controls)} · en DOM: ${r.controls.enDom.join(', ') || 'ninguno'}`);
  lines.push(`--- ${r.events.length} eventos (más reciente primero) ---`);
  for (const e of r.events) lines.push(`${e.at} ${e.step}${e.data ? ` ${JSON.stringify(e.data)}` : ''}`);
  return lines.join('\n');
}
