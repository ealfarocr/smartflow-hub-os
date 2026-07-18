// @ts-ignore — el paquete no trae tipos
import * as lamejs from '@breezystack/lamejs';

/**
 * Grabador de notas de voz para WhatsApp.
 *
 * Chrome graba con MediaRecorder en `audio/webm`, formato que la WhatsApp Cloud
 * API NO acepta. Por eso capturamos PCM crudo del micrófono con la Web Audio API
 * y lo codificamos a MP3 (`audio/mpeg`), que WhatsApp sí acepta como audio.
 *
 * Devuelve un File `.mp3` listo para subir a Storage y enviar con el flujo
 * existente (sendWhatsappMessage detecta `.mp3` → type `audio`).
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Int16Array[] = [];
  private sampleRate = 44100;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // iOS Safari expone AudioContext con prefijo webkit.
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new Ctx();
    // iOS arranca el contexto "suspended"; hay que reanudarlo tras el gesto del usuario.
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    this.sampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      const buf = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.chunks.push(buf);
    };

    this.source.connect(this.processor);
    // ScriptProcessor necesita estar conectado al destino para emitir eventos.
    // No copiamos input→output, así que la salida es silencio (sin eco).
    this.processor.connect(this.audioContext.destination);
  }

  /** Detiene la grabación, codifica a MP3 y devuelve el File. */
  async stop(): Promise<File> {
    this.teardown();

    const mp3encoder = new lamejs.Mp3Encoder(1, this.sampleRate, 128);
    const mp3Data: Uint8Array[] = [];
    for (const chunk of this.chunks) {
      const enc = mp3encoder.encodeBuffer(chunk);
      if (enc.length > 0) mp3Data.push(new Uint8Array(enc));
    }
    const end = mp3encoder.flush();
    if (end.length > 0) mp3Data.push(new Uint8Array(end));

    this.chunks = [];
    const blob = new Blob(mp3Data as BlobPart[], { type: 'audio/mpeg' });
    return new File([blob], `nota-voz-${Date.now()}.mp3`, { type: 'audio/mpeg' });
  }

  /** Cancela y libera el micrófono sin codificar nada. */
  cancel(): void {
    this.teardown();
    this.chunks = [];
  }

  private teardown(): void {
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => { /* noop */ });
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;
  }
}
