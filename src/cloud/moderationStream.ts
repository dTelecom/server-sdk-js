import { CloudApiError, MediaInput, Raw, camelize, checkIdempotencyKey, toBlob } from './http.js';
import type { Moderation, ModerationStreamTicket } from './types.js';

const protocolName = 'dtelecom.moderation.v1';
const connectTimeoutMs = 10_000;
const replyTimeoutMs = 35_000;
const maxAudioBytes = 960_000; // 30 s of 16 kHz PCM16
const maxImageBytes = 6 * 1024 * 1024;

/** Maps a moderation request from the cloud, rejecting anything that is not one. */
export function toModeration(r: Raw): Moderation {
  if (
    !r ||
    typeof r !== 'object' ||
    typeof r.id !== 'string' ||
    !['moderation-audio', 'moderation-video'].includes(r.kind) ||
    !['running', 'completed', 'failed'].includes(r.status) ||
    typeof r.charged_microcredits !== 'string'
  ) {
    throw new Error('dTelecom Cloud: invalid moderation response');
  }
  return camelize(r);
}

/** The parts of a WebSocket the stream uses: the browser's, Node 22's global one, or `ws`. */
export interface ModerationSocket {
  send(data: string | ArrayBuffer): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: (event: any) => void): void;
}

export type ModerationSocketFactory = (url: string) => ModerationSocket;

type Pending = {
  id: string;
  resolve: (result: Moderation) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * A moderation WebSocket: send audio chunks or video frames one at a time and get each result.
 * Each item is billed like the HTTP call. There is no capture, sampling or retry.
 */
export class ModerationStream {
  private pending?: Pending;

  private sending = false;

  private closed = false;

  private constructor(private readonly socket: ModerationSocket) {}

  /** Opens the stream with a ticket from `moderation.streamTicket()`. */
  static async connect(
    ticket: ModerationStreamTicket,
    factory?: ModerationSocketFactory,
  ): Promise<ModerationStream> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Fallback = (globalThis as any).WebSocket;
    if (!factory && !Fallback) {
      throw new Error('dTelecom Cloud: no WebSocket in this runtime; pass a socket factory');
    }
    const socket: ModerationSocket = factory
      ? factory(ticket.websocketUrl)
      : new Fallback(ticket.websocketUrl);
    const stream = new ModerationStream(socket);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('dTelecom Cloud: moderation connection timeout'));
      }, connectTimeoutMs);
      const abort = (message: string) => {
        clearTimeout(timeout);
        reject(new Error(message));
        stream.fail(new Error(message));
      };
      socket.addEventListener('open', () =>
        socket.send(JSON.stringify({ type: 'auth', token: ticket.token })),
      );
      socket.addEventListener('message', (event: { data: unknown }) => {
        let value: Raw;
        try {
          value = JSON.parse(String(event.data));
        } catch {
          abort('dTelecom Cloud: invalid moderation protocol');
          return;
        }
        if (!ready) {
          if (value.type === 'error') {
            abort(`dTelecom Cloud: moderation ${value.error ?? 'error'}`);
            return;
          }
          if (value.type !== 'ready' || value.protocol !== protocolName) {
            abort('dTelecom Cloud: invalid moderation handshake');
            return;
          }
          ready = true;
          clearTimeout(timeout);
          resolve();
          return;
        }
        stream.reply(value);
      });
      socket.addEventListener('error', () => abort('dTelecom Cloud: moderation connection error'));
      socket.addEventListener('close', () => abort('dTelecom Cloud: moderation connection closed'));
    });
    return stream;
  }

  /** Moderates mono PCM16 little-endian audio at 16 kHz, up to 30 seconds. */
  sendAudio(idempotencyKey: string, pcm: MediaInput, language = 'en'): Promise<Moderation> {
    return this.send(idempotencyKey, 'audio', pcm, language);
  }

  /** Moderates one image, up to 6 MiB. */
  sendVideoFrame(idempotencyKey: string, image: MediaInput): Promise<Moderation> {
    return this.send(idempotencyKey, 'video', image);
  }

  close(): void {
    this.fail(new Error('dTelecom Cloud: moderation connection closed'));
  }

  private async send(
    id: string,
    kind: 'audio' | 'video',
    media: MediaInput,
    language?: string,
  ): Promise<Moderation> {
    if (this.closed) throw new Error('dTelecom Cloud: moderation connection closed');
    if (this.pending || this.sending) {
      throw new Error('dTelecom Cloud: await the previous moderation result before sending');
    }
    checkIdempotencyKey(id, 'inference');
    const blob = toBlob(media);
    const limit = kind === 'audio' ? maxAudioBytes : maxImageBytes;
    if (!blob.size || blob.size > limit || (kind === 'audio' && blob.size % 2)) {
      throw new Error('dTelecom Cloud: invalid moderation media');
    }
    this.sending = true;
    try {
      const binary = await blob.arrayBuffer();
      if (this.closed) throw new Error('dTelecom Cloud: moderation connection closed');
      return await new Promise<Moderation>((resolve, reject) => {
        const timer = setTimeout(
          () => this.fail(new Error('dTelecom Cloud: moderation response timeout')),
          replyTimeoutMs,
        );
        this.pending = { id, resolve, reject, timer };
        try {
          this.socket.send(JSON.stringify({ id, kind, ...(language ? { language } : {}) }));
          this.socket.send(binary);
        } catch {
          this.fail(new Error('dTelecom Cloud: moderation send failed'));
        }
      });
    } finally {
      this.sending = false;
    }
  }

  private reply(value: Raw): void {
    const { pending } = this;
    if (!pending || value.id !== pending.id || !['result', 'error'].includes(value.type)) {
      this.fail(new Error('dTelecom Cloud: unexpected moderation message'));
      return;
    }
    let result: Moderation | undefined;
    try {
      if (value.type === 'result') result = toModeration(value.request);
    } catch (error) {
      this.fail(error as Error);
      return;
    }
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (result) {
      pending.resolve(result);
    } else {
      pending.reject(
        new CloudApiError(
          value.http_status ?? 503,
          value.error ?? 'moderation_failed',
          undefined,
          value.id,
        ),
      );
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    this.socket.close();
  }
}
