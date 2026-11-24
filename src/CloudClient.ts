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
  /** Session id for `extendToken` and `getSession`. */
  sessionId: string;
  /** Where the chosen node is: its city, else its country; empty when unknown. */
  region: string;
  expiresAt: Date;
}

export interface ExtendedToken {
  token: string;
  wsUrl: string;
  /** The session's node location, as in `createToken`. */
  region: string;
  expiresAt: Date;
}

/** A session of the project and what it was charged. */
export interface SessionCharge {
  sessionId: string;
  /** `webrtc` for a participant, else the service: `stt`, `tts`, `file-stt`, `vision`, ... */
  service: string;
  status: 'pending' | 'active' | 'completed' | 'expired' | 'failed' | 'rejected';
  /** The participant's room and identity; for a service session, those of its linked participant. */
  roomName?: string;
  identity?: string;
  /** The participant session a service session was linked to. */
  webrtcSessionId?: string;
  /** Node location of a participant session. */
  region?: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
  /** TTS characters used. */
  characters?: number;
  /** Charge in microcredits (1,000,000 per dollar), as a decimal string. */
  chargedMicrocredits: string;
  /** The same charge in dollars, e.g. `"0.00127"`. */
  chargedUsd: string;
  /** True once the session ended or was rejected; until then the charge is 0. */
  final: boolean;
  /** True when the bandwidth add-on covered this participant session. */
  coveredByAddon: boolean;
}

export interface ListSessionsOptions {
  /** Only sessions created at or after this time; a room name can be reused. */
  since?: Date;
  /** At most this many sessions, default 100, maximum 500. */
  limit?: number;
}

export interface SessionCharges {
  /** Newest first. */
  sessions: SessionCharge[];
  totalMicrocredits: string;
  totalUsd: string;
}

interface RawSessionCharge {
  session_id: string;
  service: string;
  status: SessionCharge['status'];
  room_name?: string;
  identity?: string;
  webrtc_session_id?: string;
  region?: string;
  created_at: string;
  started_at?: string;
  ended_at?: string;
  characters?: number;
  charged_microcredits: string;
  charged_usd: string;
  final: boolean;
  covered_by_addon: boolean;
}

function sessionCharge(raw: RawSessionCharge): SessionCharge {
  const out: SessionCharge = {
    sessionId: raw.session_id,
    service: raw.service,
    status: raw.status,
    createdAt: new Date(raw.created_at),
    chargedMicrocredits: raw.charged_microcredits,
    chargedUsd: raw.charged_usd,
    final: raw.final,
    coveredByAddon: raw.covered_by_addon,
  };
  if (raw.room_name) out.roomName = raw.room_name;
  if (raw.identity) out.identity = raw.identity;
  if (raw.webrtc_session_id) out.webrtcSessionId = raw.webrtc_session_id;
  if (raw.region) out.region = raw.region;
  if (raw.started_at) out.startedAt = new Date(raw.started_at);
  if (raw.ended_at) out.endedAt = new Date(raw.ended_at);
  if (raw.characters) out.characters = raw.characters;
  return out;
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
      region?: string;
      expires_at: string;
    }>('/v1/webrtc/token', body);
    return {
      token: res.token,
      wsUrl: res.ws_url,
      sessionId: res.session_id,
      region: res.region ?? '',
      expiresAt: new Date(res.expires_at),
    };
  }

  /**
   * Extends a session and returns a token for the whole remaining time. The client applies it
   * on its next reconnect; the node keeps the current connection open.
   *
   * Call it before `expiresAt`: a participant whose token expired without an extension is
   * removed from the room a minute after the expiry, and later calls throw a `CloudApiError`
   * with code `session_not_extendable` (409).
   *
   * @param additional Time to add: seconds as a number, or a string such as `'15m'` or `'2h'`.
   *   Rounded up to whole minutes, at most 24 hours per call.
   */
  async extendToken(sessionId: string, additional: number | string): Promise<ExtendedToken> {
    const res = await this.post<{
      token: string;
      ws_url: string;
      region?: string;
      new_expires_at: string;
    }>('/v1/webrtc/token/extend', {
      session_id: sessionId,
      additional_minutes: durationToMinutes(additional, 0),
    });
    return {
      token: res.token,
      wsUrl: res.ws_url,
      region: res.region ?? '',
      expiresAt: new Date(res.new_expires_at),
    };
  }

  /** Mints a 10-minute room admin token and lists the nodes hosting the room. */
  async adminToken(room: string): Promise<AdminToken> {
    const res = await this.post<{ token: string; api_urls: string[] | null; expires_at: string }>(
      '/v1/webrtc/admin-token',
      { room_name: room },
    );
    return { token: res.token, apiUrls: res.api_urls ?? [], expiresAt: new Date(res.expires_at) };
  }

  /**
   * Reads a session of the project (a participant from `createToken`, or a service session)
   * and what it was charged. Sessions are charged when they end: check `final`.
   */
  async getSession(sessionId: string): Promise<SessionCharge> {
    return sessionCharge(
      await this.http.json<RawSessionCharge>(
        'GET',
        `/v1/sessions/${encodeURIComponent(sessionId)}`,
      ),
    );
  }

  /**
   * Lists a room's participant sessions and the service sessions linked to them, newest first,
   * with their charges and the total.
   */
  async listSessions(room: string, options: ListSessionsOptions = {}): Promise<SessionCharges> {
    const query = new URLSearchParams({ room });
    if (options.since) query.set('since', options.since.toISOString());
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const res = await this.http.json<{
      sessions: RawSessionCharge[] | null;
      total_microcredits: string;
      total_usd: string;
    }>('GET', `/v1/sessions?${query}`);
    return {
      sessions: (res.sessions ?? []).map(sessionCharge),
      totalMicrocredits: res.total_microcredits,
      totalUsd: res.total_usd,
    };
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
