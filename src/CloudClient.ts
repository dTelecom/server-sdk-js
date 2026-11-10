import { RoomServiceClient } from './RoomServiceClient.js';
import { durationToMinutes } from './cloud/duration.js';
import { CloudHttp } from './cloud/http.js';
import {
  ModerationService,
  STTService,
  TTSService,
  TranscriptionsService,
  VisionService,
  WavService,
  getTranslation,
  translate,
} from './cloud/services.js';
import type { TranslateOptions, Translation } from './cloud/types.js';

export { CloudApiError } from './cloud/http.js';
export { durationToMinutes } from './cloud/duration.js';

const defaultTTLSeconds = 6 * 60 * 60;

/** Connection to dTelecom Cloud. Credentials fall back to env vars. */
export interface CloudClientOptions {
  /** API key of the project. Env: `DTELECOM_API_KEY`. */
  apiKey?: string;
  /** API secret of the key. Env: `DTELECOM_API_SECRET`. */
  apiSecret?: string;
  /** Cloud origin, such as `https://cloud.dtelecom.org`. Env: `DTELECOM_CLOUD_URL`. */
  baseUrl?: string;
  /** Fetch implementation; defaults to the global `fetch` (Node 18+). */
  fetch?: typeof fetch;
}

/** Node permissions of a participant token. Absent fields keep their defaults. */
export interface TokenGrants {
  /** Publish audio and video. Default true. */
  canPublish?: boolean;
  /** Subscribe to other participants' tracks. Default true. */
  canSubscribe?: boolean;
  /** Publish data messages. Default true. */
  canPublishData?: boolean;
  /** Control the room from the client (kick, mute). Default false. */
  roomAdmin?: boolean;
}

export interface CreateTokenOptions {
  /** Room name. Rooms are created when the first participant joins. */
  room: string;
  /** Participant identity, unique within the room. */
  identity: string;
  /** Display name. */
  name?: string;
  /** Opaque participant metadata, available to other participants. */
  metadata?: string;
  /**
   * Token lifetime: seconds as a number, or a string such as `'90s'`, `'30m'`, `'12h'`, `'1d'`.
   * Default 6 hours, maximum 24 hours. Rounded up to whole minutes.
   */
  ttl?: number | string;
  /** The participant's public IP, used to pick the nearest node. */
  clientIp?: string;
  /** HTTPS URLs that receive this participant's room events, up to 5. */
  webhookUrls?: string[];
  /** Permission overrides. */
  grants?: TokenGrants;
}

export interface ParticipantToken {
  /** Token for the client SDK. */
  token: string;
  /** Node URL (`wss://...`) for the client SDK. */
  wsUrl: string;
  /** Session id for `extendToken`. */
  sessionId: string;
  expiresAt: Date;
}

export interface ExtendedToken {
  token: string;
  wsUrl: string;
  expiresAt: Date;
}

export interface AdminToken {
  /** Token with room admin grants for direct node API calls. */
  token: string;
  /** HTTPS origins of the nodes hosting the room's joined participants. Empty when nobody joined. */
  apiUrls: string[];
  expiresAt: Date;
}

/**
 * Client of the dTelecom Cloud hosted API: participant tokens and room administration, live
 * speech sessions, file transcription, WAV synthesis, translation, vision and moderation. Use it
 * only on the server: it holds the API secret.
 */
export class CloudClient {
  /** Live speech-to-text sessions. */
  readonly stt: STTService;

  /** Live text-to-speech sessions. */
  readonly tts: TTSService;

  /** Asynchronous file transcription. */
  readonly transcriptions: TranscriptionsService;

  /** Asynchronous text or SSML to WAV synthesis. */
  readonly wav: WavService;

  /** Questions about images. */
  readonly vision: VisionService;

  /** Audio and video frame moderation, per item or over a WebSocket. */
  readonly moderation: ModerationService;

  private readonly http: CloudHttp;

  constructor(options: CloudClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DTELECOM_API_KEY;
    const apiSecret = options.apiSecret ?? process.env.DTELECOM_API_SECRET;
    const baseUrl = options.baseUrl ?? process.env.DTELECOM_CLOUD_URL;
    if (!apiKey || !apiSecret) {
      throw new Error(
        'dTelecom Cloud: apiKey and apiSecret are required (or DTELECOM_API_KEY, DTELECOM_API_SECRET)',
      );
    }
    if (!baseUrl) {
      throw new Error('dTelecom Cloud: baseUrl is required (or DTELECOM_CLOUD_URL)');
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('dTelecom Cloud: no fetch available; use Node 18+ or pass options.fetch');
    }
    this.http = new CloudHttp(
      `Bearer ${apiKey}:${apiSecret}`,
      baseUrl.replace(/\/+$/, ''),
      fetchImpl,
    );
    this.stt = new STTService(this.http);
    this.tts = new TTSService(this.http);
    this.transcriptions = new TranscriptionsService(this.http);
    this.wav = new WavService(this.http);
    this.vision = new VisionService(this.http);
    this.moderation = new ModerationService(this.http);
  }

  /** Creates a participant session and returns the token and node URL for the client. */
  async createToken(options: CreateTokenOptions): Promise<ParticipantToken> {
    const body: Record<string, unknown> = {
      room_name: options.room,
      identity: options.identity,
      duration_minutes: durationToMinutes(options.ttl, defaultTTLSeconds),
    };
    if (options.name) body.name = options.name;
    if (options.metadata) body.metadata = options.metadata;
    if (options.clientIp) body.client_ip = options.clientIp;
    if (options.webhookUrls && options.webhookUrls.length > 0)
      body.webhook_urls = options.webhookUrls;
    if (options.grants) {
      const grants: Record<string, boolean> = {};
      if (options.grants.canPublish !== undefined) grants.can_publish = options.grants.canPublish;
      if (options.grants.canSubscribe !== undefined)
        grants.can_subscribe = options.grants.canSubscribe;
      if (options.grants.canPublishData !== undefined)
        grants.can_publish_data = options.grants.canPublishData;
      if (options.grants.roomAdmin) grants.room_admin = true;
      body.grants = grants;
    }
    const res = await this.post<{
      session_id: string;
      token: string;
      ws_url: string;
      expires_at: string;
    }>('/v1/webrtc/token', body);
    return {
      token: res.token,
      wsUrl: res.ws_url,
      sessionId: res.session_id,
      expiresAt: new Date(res.expires_at),
    };
  }

  /**
   * Extends a session and returns a token for the whole remaining time. The client applies it
   * on its next reconnect; the node keeps the current connection open.
   */
  async extendToken(sessionId: string, additional: number | string): Promise<ExtendedToken> {
    const res = await this.post<{ token: string; ws_url: string; new_expires_at: string }>(
      '/v1/webrtc/token/extend',
      {
        session_id: sessionId,
        additional_minutes: durationToMinutes(additional, 0),
      },
    );
    return { token: res.token, wsUrl: res.ws_url, expiresAt: new Date(res.new_expires_at) };
  }

  /** Mints a 10-minute room admin token and lists the nodes hosting the room. */
  async adminToken(room: string): Promise<AdminToken> {
    const res = await this.post<{ token: string; api_urls: string[] | null; expires_at: string }>(
      '/v1/webrtc/admin-token',
      { room_name: room },
    );
    return { token: res.token, apiUrls: res.api_urls ?? [], expiresAt: new Date(res.expires_at) };
  }

  /** Room administration on the nodes, authorised through `adminToken`. */
  roomService(): RoomServiceClient {
    return new RoomServiceClient(this);
  }

  /**
   * Translates text, billed per Unicode code point of `q`. `status: 'running'` means call again
   * with the same key, or poll with `getTranslation`.
   */
  async translate(options: TranslateOptions): Promise<Translation> {
    return translate(this.http, options);
  }

  /** Polls a translation, or reads its stored result without another charge. */
  async getTranslation(requestId: string): Promise<Translation> {
    return getTranslation(this.http, requestId);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.http.json<T>('POST', path, body);
  }
}
