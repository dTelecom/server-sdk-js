import { durationToMinutes } from './duration.js';
import { CloudHttp, Raw, camelize, checkIdempotencyKey, segment, toBlob } from './http.js';
import { ModerationStream, ModerationSocketFactory, toModeration } from './moderationStream.js';
import type {
  CreateSTTSessionOptions,
  CreateTTSSessionOptions,
  CreateTranscriptionOptions,
  CreateWavOptions,
  ExtendedSTTSession,
  ExtendedTTSSession,
  ModerateAudioOptions,
  ModerateVideoFrameOptions,
  Moderation,
  ModerationStreamTicket,
  SpeechSession,
  TranscriptionJob,
  TranslateOptions,
  Translation,
  VisionSnapshot,
  VisionSnapshotOptions,
  WavJob,
} from './types.js';

function speechSession(r: Raw): SpeechSession {
  return {
    sessionId: r.session_id,
    token: r.token,
    serverUrl: r.server_url,
    expiresAt: new Date(r.expires_at),
  };
}

/** Live speech-to-text sessions on a speech server, prepaid by time. */
export class STTService {
  constructor(private readonly http: CloudHttp) {}

  /** Opens a session: connect to `serverUrl` and send `token` as `session_key`. */
  async createSession(options: CreateSTTSessionOptions): Promise<SpeechSession> {
    const body: Raw = { duration_minutes: durationToMinutes(options.duration, 0) };
    if (options.language) body.language = options.language;
    if (options.webrtcSessionId) body.webrtc_session_id = options.webrtcSessionId;
    return speechSession(await this.http.json('POST', '/v1/stt/session', body));
  }

  /**
   * Adds time: seconds as a number, or a string such as `'10m'`. Send the new token to the open
   * socket as `{ type: 'extend', session_key }`.
   */
  async extend(sessionId: string, additional: number | string): Promise<ExtendedSTTSession> {
    const r = await this.http.json('POST', '/v1/stt/session/extend', {
      session_id: sessionId,
      additional_minutes: durationToMinutes(additional, 0),
    });
    return { token: r.token, expiresAt: new Date(r.new_expires_at) };
  }
}

/** Live text-to-speech sessions on a speech server, prepaid by characters. */
export class TTSService {
  constructor(private readonly http: CloudHttp) {}

  /** Opens a session: connect to `serverUrl` and send `token` as `session_key`. */
  async createSession(options: CreateTTSSessionOptions): Promise<SpeechSession> {
    const body: Raw = { max_characters: options.maxCharacters };
    if (options.language) body.language = options.language;
    if (options.voice) body.voice = options.voice;
    if (options.webrtcSessionId) body.webrtc_session_id = options.webrtcSessionId;
    return speechSession(await this.http.json('POST', '/v1/tts/session', body));
  }

  /** Adds characters. Send the new token to the open socket as `{ type: 'extend', session_key }`. */
  async extend(sessionId: string, additionalCharacters: number): Promise<ExtendedTTSSession> {
    const r = await this.http.json('POST', '/v1/tts/session/extend', {
      session_id: sessionId,
      additional_characters: additionalCharacters,
    });
    return {
      token: r.token,
      maxCharacters: r.max_characters,
      expiresAt: new Date(r.new_expires_at),
    };
  }
}

/** Asynchronous transcription of audio and video files. */
export class TranscriptionsService {
  constructor(private readonly http: CloudHttp) {}

  /** Uploads a file and starts a job. A failed upload is not retried; retry with the same key. */
  async create(options: CreateTranscriptionOptions): Promise<TranscriptionJob> {
    checkIdempotencyKey(options.idempotencyKey, 'file');
    const form = new FormData();
    form.append('file', toBlob(options.file), options.filename ?? 'audio.media');
    if (options.language !== undefined) form.append('language', options.language);
    if (options.diarize !== undefined) form.append('diarize', String(options.diarize));
    return camelize(
      await this.http.json('POST', '/v1/transcriptions/jobs', form, {
        'Idempotency-Key': options.idempotencyKey,
      }),
    );
  }

  async get(jobId: string): Promise<TranscriptionJob> {
    return camelize(await this.http.json('GET', `/v1/transcriptions/jobs/${segment(jobId)}`));
  }

  /** Cancels unfinished work, or deletes a finished result. A finished job keeps its charge. */
  async delete(jobId: string): Promise<TranscriptionJob> {
    return camelize(await this.http.json('DELETE', `/v1/transcriptions/jobs/${segment(jobId)}`));
  }
}

/** Asynchronous synthesis of text or SSML into a 48 kHz mono PCM16 WAV file. */
export class WavService {
  constructor(private readonly http: CloudHttp) {}

  async create(options: CreateWavOptions): Promise<WavJob> {
    checkIdempotencyKey(options.idempotencyKey, 'file');
    const body: Raw = { text: options.text };
    if (options.voice !== undefined) body.voice = options.voice;
    if (options.language !== undefined) body.language = options.language;
    if (options.speed !== undefined) body.speed = options.speed;
    if (options.inputFormat !== undefined) body.input_format = options.inputFormat;
    if (options.dictionary !== undefined) body.dictionary = options.dictionary;
    if (options.watermark !== undefined) body.watermark = options.watermark;
    return camelize(
      await this.http.json('POST', '/v1/tts/jobs', body, {
        'Idempotency-Key': options.idempotencyKey,
      }),
    );
  }

  async get(jobId: string): Promise<WavJob> {
    return camelize(await this.http.json('GET', `/v1/tts/jobs/${segment(jobId)}`));
  }

  /** The finished WAV file: stream `response.body`, or read it with `arrayBuffer()`. */
  async download(jobId: string): Promise<Response> {
    return this.http.response('GET', `/v1/tts/jobs/${segment(jobId)}/audio`);
  }

  /** Cancels unfinished work, or deletes a finished file. A finished job keeps its charge. */
  async delete(jobId: string): Promise<WavJob> {
    return camelize(await this.http.json('DELETE', `/v1/tts/jobs/${segment(jobId)}`));
  }
}

/** Questions about images, answered by dTelecom's own vision model. */
export class VisionService {
  constructor(private readonly http: CloudHttp) {}

  /** Answers a question about an image. `status: 'running'` means call again with the same key. */
  async snapshot(options: VisionSnapshotOptions): Promise<VisionSnapshot> {
    checkIdempotencyKey(options.idempotencyKey, 'inference');
    const form = new FormData();
    form.append('image', toBlob(options.image), 'image.media');
    if (options.question !== undefined) form.append('question', options.question);
    if (options.source !== undefined) form.append('source', options.source);
    if (options.webrtcSessionId) form.append('session_id', options.webrtcSessionId);
    return camelize(
      await this.http.json('POST', '/v1/vision/snapshot', form, {
        'Idempotency-Key': options.idempotencyKey,
      }),
    );
  }

  /** Polls a request, or reads its stored answer without another charge. */
  async get(requestId: string): Promise<VisionSnapshot> {
    return camelize(await this.http.json('GET', `/v1/vision/requests/${segment(requestId)}`));
  }
}

export interface ModerationStreamOptions {
  /**
   * Opens the WebSocket. Defaults to the global `WebSocket` (Node 22+ and browsers); on older
   * Node pass one, e.g. `(url) => new (require('ws'))(url)`.
   */
  socketFactory?: ModerationSocketFactory;
}

/** Content moderation of audio and video frames, per item or over a WebSocket. */
export class ModerationService {
  constructor(private readonly http: CloudHttp) {}

  async audio(options: ModerateAudioOptions): Promise<Moderation> {
    return this.upload('audio', 'audio', options.audio, options.idempotencyKey, {
      language: options.language,
      session_id: options.webrtcSessionId,
    });
  }

  async videoFrame(options: ModerateVideoFrameOptions): Promise<Moderation> {
    return this.upload('video-frame', 'image', options.image, options.idempotencyKey, {
      session_id: options.webrtcSessionId,
    });
  }

  /** Polls a request, or reads its stored result without another charge. */
  async get(requestId: string): Promise<Moderation> {
    return toModeration(
      await this.http.json('GET', `/v1/moderation/requests/${segment(requestId)}`),
    );
  }

  /**
   * A ticket for one moderation WebSocket, valid for 10 minutes. It holds no API secret, so a
   * server can hand it to a browser, which connects with `ModerationStream.connect`.
   */
  async streamTicket(): Promise<ModerationStreamTicket> {
    const r = await this.http.json('POST', '/v1/moderation/streams');
    const url = new URL(r.websocket_path, this.http.baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return {
      token: r.token,
      websocketUrl: url.toString(),
      expiresAt: new Date(r.expires_at),
      protocol: r.protocol,
      maxInflight: r.max_inflight,
      audioFormat: r.audio_format,
      sampleRate: r.sample_rate,
      channels: r.channels,
      maxAudioSeconds: r.max_audio_seconds,
    };
  }

  /** Gets a ticket and opens the moderation WebSocket with it. */
  async stream(options: ModerationStreamOptions = {}): Promise<ModerationStream> {
    return ModerationStream.connect(await this.streamTicket(), options.socketFactory);
  }

  private async upload(
    path: 'audio' | 'video-frame',
    field: 'audio' | 'image',
    media: ModerateAudioOptions['audio'],
    key: string,
    fields: Record<string, string | undefined>,
  ): Promise<Moderation> {
    checkIdempotencyKey(key, 'inference');
    const form = new FormData();
    form.append(field, toBlob(media), 'media.bin');
    Object.entries(fields).forEach(([name, value]) => {
      if (value) form.append(name, value);
    });
    return toModeration(
      await this.http.json('POST', `/v1/moderation/${path}`, form, { 'Idempotency-Key': key }),
    );
  }
}

/** Translation: `translate` and `getTranslation` on `CloudClient`. */
export async function translate(http: CloudHttp, options: TranslateOptions): Promise<Translation> {
  checkIdempotencyKey(options.idempotencyKey, 'inference');
  const body: Raw = { q: options.q, target: options.target };
  if (options.source !== undefined) body.source = options.source;
  return camelize(
    await http.json('POST', '/v1/translation', body, {
      'Idempotency-Key': options.idempotencyKey,
    }),
  );
}

export async function getTranslation(http: CloudHttp, requestId: string): Promise<Translation> {
  return camelize(await http.json('GET', `/v1/translation/requests/${segment(requestId)}`));
}
