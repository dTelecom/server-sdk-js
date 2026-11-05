import { RoomServiceClient } from './RoomServiceClient.js';

const defaultTTLSeconds = 6 * 60 * 60;
const maxMinutes = 1440;

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

/** A non-2xx answer from the cloud. `code` is the cloud's error code, such as `insufficient_balance`. */
export class CloudApiError extends Error {
  readonly status: number;

  readonly code: string;

  /** Seconds to wait before retrying, when the cloud says so (503s). */
  readonly retryAfter?: number;

  constructor(status: number, code: string, retryAfter?: number) {
    super(`dTelecom Cloud: ${status} ${code}`);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * Parses a lifetime into whole minutes: a number of seconds, or a string with a unit
 * (s, m, h, d). Rounds up, at least 1 minute.
 */
export function durationToMinutes(
  value: number | string | undefined,
  fallbackSeconds: number,
): number {
  let seconds: number;
  if (value === undefined) {
    seconds = fallbackSeconds;
  } else if (typeof value === 'number') {
    seconds = value;
  } else {
    const match =
      /^\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)?\s*$/i.exec(
        value,
      );
    if (!match) {
      throw new Error(`invalid duration: ${JSON.stringify(value)}`);
    }
    const amount = Number(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    if (unit.startsWith('d')) {
      seconds = amount * 86400;
    } else if (unit.startsWith('h')) {
      seconds = amount * 3600;
    } else if (unit.startsWith('m')) {
      seconds = amount * 60;
    } else {
      seconds = amount;
    }
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`invalid duration: ${JSON.stringify(value)}`);
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes > maxMinutes) {
    throw new Error(`duration above the 24 hour maximum: ${JSON.stringify(value)}`);
  }
  return minutes;
}

/**
 * Client of the dTelecom Cloud hosted API. It issues participant tokens, extends sessions and
 * mints room admin tokens. Use it only on the server: it holds the API secret.
 */
export class CloudClient {
  private readonly authorization: string;

  private readonly baseUrl: string;

  private readonly fetchImpl: typeof fetch;

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
    this.authorization = `Bearer ${apiKey}:${apiSecret}`;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
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

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: 'POST',
      headers: { Authorization: this.authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.error === 'string') code = parsed.error;
      } catch {
        // not JSON: keep the status code
      }
      const retryAfter = Number(res.headers.get('Retry-After'));
      throw new CloudApiError(
        res.status,
        code,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return JSON.parse(text) as T;
  }
}
