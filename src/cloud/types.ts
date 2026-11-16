import type { MediaInput } from './http.js';

// ---- Speech sessions (live STT and TTS on a speech server) ----

export interface CreateSTTSessionOptions {
  /**
   * Prepaid streaming time: seconds as a number, or a string such as `'30m'`, `'2h'`. Rounded up
   * to whole minutes, at most 24 hours. Unused time is released when the session ends.
   */
  duration: number | string;
  /** Language code, such as `en`. */
  language?: string;
  /** WebRTC session (from `createToken`) this speech serves, which links it to that room. */
  webrtcSessionId?: string;
}

export interface CreateTTSSessionOptions {
  /** Characters the session may synthesise. Extend with `tts.extend`. */
  maxCharacters: number;
  /** Language code, such as `en`. */
  language?: string;
  /** Voice name. */
  voice?: string;
  /** WebRTC session (from `createToken`) this speech serves, which links it to that room. */
  webrtcSessionId?: string;
}

export interface SpeechSession {
  sessionId: string;
  /** Session key for the speech server (`session_key` in its protocol). */
  token: string;
  /** Speech server origin, as signed into the key. */
  serverUrl: string;
  /** WebSocket address to open: `serverUrl` + `/v1/stream`. */
  streamUrl: string;
  expiresAt: Date;
}

export interface ExtendedSTTSession {
  /** New session key; send it to the open socket as `{ type: 'extend', session_key }`. */
  token: string;
  expiresAt: Date;
}

export interface ExtendedTTSSession {
  /** New session key; send it to the open socket as `{ type: 'extend', session_key }`. */
  token: string;
  /** Characters the session may now synthesise in total. */
  maxCharacters: number;
  expiresAt: Date;
}

// ---- File jobs (transcription and WAV synthesis) ----

export type JobStatus =
  | 'uploading'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deleted';

export interface CreateTranscriptionOptions {
  /** Audio or video, up to 256 MiB. */
  file: MediaInput;
  /** 1-128 printable ASCII characters. Reuse it to retry the same upload. */
  idempotencyKey: string;
  filename?: string;
  /** Language code, `en` by default. `auto` is not accepted for files. */
  language?: string;
  /** Speaker diarization; on by default. */
  diarize?: boolean;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  segments: TranscriptionSegment[];
  media: { sampleCount: number; sampleRate: number; channels: number; durationSeconds: number };
  speakerSegments?: { start: number; end: number; speaker: string }[];
  speakerLabels?: string;
  timingType: string;
}

export interface TranscriptionJob {
  id: string;
  status: JobStatus;
  /** Length of the media, once decoded. */
  durationSeconds?: number;
  result?: TranscriptionResult;
  error?: string;
}

export interface CreateWavOptions {
  text: string;
  /** 1-128 printable ASCII characters. Reusing it with different text fails with 409. */
  idempotencyKey: string;
  voice?: string;
  language?: string;
  speed?: number;
  inputFormat?: 'text' | 'ssml';
  /** Locale, then source text, then spoken alias. SSML only. */
  dictionary?: Record<string, Record<string, string>>;
  /** Audio watermark; off unless set. */
  watermark?: boolean;
}

export interface WavResult {
  characters: number;
  sampleRate: number;
  channels: number;
  encoding: 'pcm_s16le';
  samples: number;
  bytes: number;
  sha256: string;
  watermark: boolean;
}

export interface WavJob {
  id: string;
  status: JobStatus;
  characters?: number;
  result?: WavResult;
  error?: string;
}

// ---- Requests (translation, vision, moderation) ----

export type RequestStatus = 'running' | 'completed' | 'failed';

/** Common fields of a translation, vision or moderation request. */
export interface CloudRequest<Kind extends string, Result> {
  id: string;
  kind: Kind;
  /** `running` means retry the same call, or poll with the get method. */
  status: RequestStatus;
  /** Charge in microcredits, as a decimal string. */
  chargedMicrocredits: string;
  result?: Result;
  error?: string;
}

export interface TranslateOptions {
  /** Text to translate, billed per Unicode code point. */
  q: string;
  target: string;
  /** Source language; detected when omitted. */
  source?: string;
  /** 1-128 letters, digits, underscores or hyphens. */
  idempotencyKey: string;
}

export interface TranslationResult {
  translatedText: string;
  source: string;
  target: string;
  detectedLanguage?: { language: string; confidence: number };
  /** Billing uses `characters`; `outputTokens` is informational. */
  usage: { characters: number; outputTokens?: number };
}

export type Translation = CloudRequest<'translation', TranslationResult>;

export interface VisionSnapshotOptions {
  /** Image, up to 6 MiB. */
  image: MediaInput;
  /** 1-128 letters, digits, underscores or hyphens. */
  idempotencyKey: string;
  question?: string;
  /** Where the image comes from; `camera` by default. */
  source?: 'camera' | 'screen';
  /** WebRTC session this belongs to, which links it to that room. */
  webrtcSessionId?: string;
}

export interface VisionResult {
  requestId: string;
  answer: string;
  model: string;
  generatedTokens: number;
  promptTokens: number;
  finishReason: string;
  outputTokenLimitReached: boolean;
  usage: { completedSnapshots: number };
}

export type VisionSnapshot = CloudRequest<'vision', VisionResult>;

export interface ModerateAudioOptions {
  /** Mono PCM16 little-endian at 16 kHz, up to 30 seconds. */
  audio: MediaInput;
  /** 1-128 letters, digits, underscores or hyphens. */
  idempotencyKey: string;
  language?: string;
  /** WebRTC session this belongs to, which links it to that room. */
  webrtcSessionId?: string;
}

export interface ModerateVideoFrameOptions {
  /** Image, up to 6 MiB. */
  image: MediaInput;
  /** 1-128 letters, digits, underscores or hyphens. */
  idempotencyKey: string;
  /** WebRTC session this belongs to, which links it to that room. */
  webrtcSessionId?: string;
}

export interface ModerationResult {
  policy: 'text_safety' | 'visual_safety';
  policyVersion: string;
  /** The categories the combined policy covers, not one prediction per category. */
  evaluatedCategories: string[];
  decision: 'pass' | 'flag';
  evidence: { model: string; yesProbability: number; calibrated: false; scoreType: string };
  imageScreening?: {
    model: string;
    nativeScores: Record<'neutral' | 'low' | 'medium' | 'high', number>;
    calibrated: false;
  };
  /** Audio only. */
  transcript?: string;
  /** Audio only. */
  language?: string;
  usage: { completedFrames?: number; audioSamples?: number; sampleRate?: number };
}

export type Moderation = CloudRequest<'moderation-audio' | 'moderation-video', ModerationResult>;

/** A ticket for one moderation WebSocket. It holds no API secret, so it can go to a browser. */
export interface ModerationStreamTicket {
  token: string;
  /** `wss://` URL of the stream. */
  websocketUrl: string;
  expiresAt: Date;
  protocol: string;
  /** Items in flight at once. */
  maxInflight: number;
  audioFormat: string;
  sampleRate: number;
  channels: number;
  maxAudioSeconds: number;
}
