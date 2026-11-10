import http from 'http';
import type { AddressInfo } from 'net';

import { CloudClient } from '../CloudClient';
import { CloudApiError } from './http';
import { ModerationSocket, ModerationStream } from './moderationStream';

type Recorded = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  json?: any;
  form?: FormData;
};

type Answer = { status: number; body: any; headers?: Record<string, string>; raw?: Buffer };

/** A stub of the cloud: records each request, parsing JSON and multipart bodies, and answers. */
function startCloud(answer: (req: Recorded) => Answer) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const type = req.headers['content-type'] ?? '';
      const recorded: Recorded = { method: req.method!, path: req.url!, headers: req.headers };
      if (type.startsWith('application/json')) recorded.json = JSON.parse(raw.toString());
      if (type.startsWith('multipart/form-data')) {
        recorded.form = await new Response(raw, { headers: { 'content-type': type } }).formData();
      }
      requests.push(recorded);
      const out = answer(recorded);
      if (out.raw) {
        res.writeHead(out.status, { 'Content-Type': 'audio/wav' });
        res.end(out.raw);
        return;
      }
      res.writeHead(out.status, { 'Content-Type': 'application/json', ...(out.headers ?? {}) });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise<{ client: CloudClient; url: string; requests: Recorded[]; close: () => void }>(
    (resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        const url = `http://127.0.0.1:${port}`;
        resolve({
          client: new CloudClient({ apiKey: 'key', apiSecret: 'secret', baseUrl: url }),
          url,
          requests,
          close: () => server.close(),
        });
      });
    },
  );
}

const moderationBody = {
  id: 'mod-1',
  kind: 'moderation-audio',
  status: 'completed',
  charged_microcredits: '4000',
  result: {
    policy: 'text_safety',
    policy_version: 'content-screen-v2',
    evaluated_categories: ['sexual_content', 'violence'],
    decision: 'pass',
    evidence: { model: 'Shieldstral', yes_probability: 0.01, calibrated: false, score_type: 'p' },
    transcript: 'hello',
    language: 'en',
    usage: { audio_samples: 16000, sample_rate: 16000 },
  },
};

describe('CloudClient speech sessions', () => {
  it('creates and extends STT and TTS sessions', async () => {
    const cloud = await startCloud((req) => {
      switch (req.path) {
        case '/v1/stt/session':
        case '/v1/tts/session':
          return {
            status: 200,
            body: {
              session_id: 's1',
              token: 'key1',
              server_url: 'https://speech.example',
              expires_at: '2030-01-01T00:00:00Z',
            },
          };
        case '/v1/stt/session/extend':
          return { status: 200, body: { token: 'key2', new_expires_at: '2030-01-01T01:00:00Z' } };
        default:
          return {
            status: 200,
            body: { token: 'key3', max_characters: 3000, new_expires_at: '2030-01-01T02:00:00Z' },
          };
      }
    });
    try {
      const stt = await cloud.client.stt.createSession({
        duration: '30m',
        language: 'en',
        webrtcSessionId: 'w1',
      });
      expect(stt).toEqual({
        sessionId: 's1',
        token: 'key1',
        serverUrl: 'https://speech.example',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      expect(cloud.requests[0].headers.authorization).toBe('Bearer key:secret');
      expect(cloud.requests[0].json).toEqual({
        duration_minutes: 30,
        language: 'en',
        webrtc_session_id: 'w1',
      });

      expect(await cloud.client.stt.extend('s1', 600)).toEqual({
        token: 'key2',
        expiresAt: new Date('2030-01-01T01:00:00Z'),
      });
      expect(cloud.requests[1].json).toEqual({ session_id: 's1', additional_minutes: 10 });

      await cloud.client.tts.createSession({ maxCharacters: 1000, voice: 'af_heart' });
      expect(cloud.requests[2].json).toEqual({ max_characters: 1000, voice: 'af_heart' });

      expect(await cloud.client.tts.extend('s1', 2000)).toEqual({
        token: 'key3',
        maxCharacters: 3000,
        expiresAt: new Date('2030-01-01T02:00:00Z'),
      });
      expect(cloud.requests[3].json).toEqual({ session_id: 's1', additional_characters: 2000 });
    } finally {
      cloud.close();
    }
  });
});

describe('CloudClient file jobs', () => {
  it('uploads a transcription and maps the result to camelCase', async () => {
    const job = {
      id: 'job 1',
      status: 'completed',
      duration_seconds: 2.5,
      result: {
        text: 'hi there',
        language: 'en',
        segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00', text: 'hi there' }],
        media: { sample_count: 40000, sample_rate: 16000, channels: 1, duration_seconds: 2.5 },
        speaker_segments: [{ start: 0, end: 1, speaker: 'SPEAKER_00' }],
        timing_type: 'segment',
      },
    };
    const cloud = await startCloud((req) => ({
      status: req.method === 'POST' ? 202 : 200,
      body: req.method === 'POST' ? { id: 'job 1', status: 'queued' } : job,
    }));
    try {
      const created = await cloud.client.transcriptions.create({
        file: Buffer.from('RIFF....'),
        idempotencyKey: 'upload:1',
        filename: 'call.wav',
        language: 'en',
        diarize: false,
      });
      expect(created).toEqual({ id: 'job 1', status: 'queued' });
      const upload = cloud.requests[0];
      expect(upload.path).toBe('/v1/transcriptions/jobs');
      expect(upload.headers['idempotency-key']).toBe('upload:1');
      const file = upload.form!.get('file') as File;
      expect(file.name).toBe('call.wav');
      expect(await file.text()).toBe('RIFF....');
      expect(upload.form!.get('language')).toBe('en');
      expect(upload.form!.get('diarize')).toBe('false');

      const got = await cloud.client.transcriptions.get('job 1');
      expect(cloud.requests[1].path).toBe('/v1/transcriptions/jobs/job%201');
      expect(got.durationSeconds).toBe(2.5);
      expect(got.result!.media).toEqual({
        sampleCount: 40000,
        sampleRate: 16000,
        channels: 1,
        durationSeconds: 2.5,
      });
      expect(got.result!.speakerSegments).toEqual([{ start: 0, end: 1, speaker: 'SPEAKER_00' }]);
      expect(got.result!.timingType).toBe('segment');

      await cloud.client.transcriptions.delete('job 1');
      expect(cloud.requests[2].method).toBe('DELETE');
    } finally {
      cloud.close();
    }
  });

  it('creates, reads and downloads a WAV', async () => {
    const cloud = await startCloud((req) => {
      if (req.path.endsWith('/audio')) return { status: 200, body: null, raw: Buffer.from('WAVE') };
      return {
        status: req.method === 'POST' ? 202 : 200,
        body: {
          id: 'wav1',
          status: 'completed',
          characters: 5,
          result: {
            characters: 5,
            sample_rate: 48000,
            channels: 1,
            encoding: 'pcm_s16le',
            samples: 48000,
            bytes: 96044,
            sha256: 'abc',
            watermark: false,
          },
        },
      };
    });
    try {
      await cloud.client.wav.create({
        text: 'Hello',
        idempotencyKey: 'wav-1',
        voice: 'af_heart',
        inputFormat: 'ssml',
        watermark: false,
      });
      expect(cloud.requests[0].json).toEqual({
        text: 'Hello',
        voice: 'af_heart',
        input_format: 'ssml',
        watermark: false,
      });
      expect(cloud.requests[0].headers['idempotency-key']).toBe('wav-1');

      const job = await cloud.client.wav.get('wav1');
      expect(job.result!.sampleRate).toBe(48000);

      const audio = await cloud.client.wav.download('wav1');
      expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe('WAVE');
      expect(cloud.requests[2].path).toBe('/v1/tts/jobs/wav1/audio');
    } finally {
      cloud.close();
    }
  });
});

describe('CloudClient requests', () => {
  it('translates, including a request still running', async () => {
    const cloud = await startCloud((req) =>
      req.method === 'POST'
        ? {
            status: 202,
            body: { id: 't1', kind: 'translation', status: 'running', charged_microcredits: '0' },
            headers: { 'Retry-After': '1' },
          }
        : {
            status: 200,
            body: {
              id: 't1',
              kind: 'translation',
              status: 'completed',
              charged_microcredits: '25',
              result: {
                translated_text: 'Hola',
                source: 'auto',
                target: 'es',
                detected_language: { language: 'en', confidence: 0.9 },
                usage: { characters: 5, output_tokens: 3 },
              },
            },
          },
    );
    try {
      const running = await cloud.client.translate({
        q: 'Hello',
        target: 'es',
        idempotencyKey: 't-1',
      });
      expect(running.status).toBe('running');
      expect(cloud.requests[0].json).toEqual({ q: 'Hello', target: 'es' });
      expect(cloud.requests[0].headers['idempotency-key']).toBe('t-1');

      const done = await cloud.client.getTranslation('t1');
      expect(done.result).toEqual({
        translatedText: 'Hola',
        source: 'auto',
        target: 'es',
        detectedLanguage: { language: 'en', confidence: 0.9 },
        usage: { characters: 5, outputTokens: 3 },
      });
      expect(done.chargedMicrocredits).toBe('25');
    } finally {
      cloud.close();
    }
  });

  it('sends vision and moderation media as multipart with the room link', async () => {
    const cloud = await startCloud((req) => {
      if (req.path === '/v1/vision/snapshot') {
        return {
          status: 200,
          body: {
            id: 'v1',
            kind: 'vision',
            status: 'completed',
            charged_microcredits: '1000',
            result: {
              request_id: 'v1',
              answer: 'A cat',
              model: 'm',
              generated_tokens: 3,
              prompt_tokens: 10,
              finish_reason: 'stop',
              output_token_limit_reached: false,
              usage: { completed_snapshots: 1 },
            },
          },
        };
      }
      return { status: 200, body: moderationBody };
    });
    try {
      const vision = await cloud.client.vision.snapshot({
        image: Buffer.from([1, 2, 3]),
        idempotencyKey: 'v-1',
        question: 'What is it?',
        source: 'screen',
        webrtcSessionId: 'w1',
      });
      expect(vision.result!.answer).toBe('A cat');
      expect(vision.result!.outputTokenLimitReached).toBe(false);
      const form = cloud.requests[0].form!;
      expect((form.get('image') as File).size).toBe(3);
      expect(form.get('question')).toBe('What is it?');
      expect(form.get('source')).toBe('screen');
      expect(form.get('session_id')).toBe('w1');

      const audio = await cloud.client.moderation.audio({
        audio: new Blob([new Uint8Array(4)]),
        idempotencyKey: 'm-1',
        language: 'en',
      });
      expect(audio.result!.evidence.yesProbability).toBe(0.01);
      expect(audio.result!.usage).toEqual({ audioSamples: 16000, sampleRate: 16000 });
      expect(cloud.requests[1].path).toBe('/v1/moderation/audio');
      expect(cloud.requests[1].form!.get('language')).toBe('en');
      expect(cloud.requests[1].form!.has('session_id')).toBe(false);

      await cloud.client.moderation.videoFrame({
        image: Buffer.from([9]),
        idempotencyKey: 'm-2',
        webrtcSessionId: 'w1',
      });
      expect(cloud.requests[2].path).toBe('/v1/moderation/video-frame');
      expect(cloud.requests[2].form!.get('session_id')).toBe('w1');
      expect((cloud.requests[2].form!.get('image') as File).size).toBe(1);
    } finally {
      cloud.close();
    }
  });

  it('checks idempotency keys before sending anything', async () => {
    const cloud = await startCloud(() => ({ status: 200, body: {} }));
    try {
      await expect(
        cloud.client.translate({ q: 'x', target: 'es', idempotencyKey: 'has space' }),
      ).rejects.toThrow('idempotencyKey');
      await expect(
        cloud.client.transcriptions.create({ file: Buffer.from('a'), idempotencyKey: '' }),
      ).rejects.toThrow('idempotencyKey');
      // File jobs take any printable ASCII; requests do not take a colon.
      await expect(
        cloud.client.moderation.videoFrame({ image: Buffer.from('a'), idempotencyKey: 'a:b' }),
      ).rejects.toThrow('idempotencyKey');
      expect(cloud.requests).toHaveLength(0);
    } finally {
      cloud.close();
    }
  });

  it('maps errors with the code, Retry-After and the id', async () => {
    const cloud = await startCloud((req) =>
      req.path === '/v1/transcriptions/jobs'
        ? { status: 402, body: { error: 'insufficient_balance', id: 'job-9' } }
        : {
            status: 429,
            body: { error: 'inference_capacity' },
            headers: { 'Retry-After': '1' },
          },
    );
    try {
      const err = await cloud.client.transcriptions
        .create({ file: Buffer.from('a'), idempotencyKey: 'k' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(CloudApiError);
      expect(err).toMatchObject({ status: 402, code: 'insufficient_balance', id: 'job-9' });
      await expect(cloud.client.vision.get('v1')).rejects.toMatchObject({
        status: 429,
        code: 'inference_capacity',
        retryAfter: 1,
      });
    } finally {
      cloud.close();
    }
  });
});

/** A socket that plays the server side of dtelecom.moderation.v1 from a script. */
class FakeSocket implements ModerationSocket {
  sent: (string | ArrayBuffer)[] = [];

  closed = false;

  private listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(private readonly onSend: (socket: FakeSocket, data: string | ArrayBuffer) => void) {
    setTimeout(() => this.emit('open', {}), 0);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
    this.onSend(this, data);
  }

  close(): void {
    this.closed = true;
  }

  reply(value: unknown): void {
    setTimeout(() => this.emit('message', { data: JSON.stringify(value) }), 0);
  }

  emit(type: string, event: unknown): void {
    (this.listeners[type] ?? []).forEach((listener) => listener(event));
  }
}

describe('Moderation stream', () => {
  it('gets a ticket with the WebSocket URL and limits', async () => {
    const cloud = await startCloud(() => ({
      status: 200,
      body: {
        token: 'ticket',
        websocket_path: '/v1/moderation/stream',
        expires_at: '2030-01-01T00:10:00Z',
        protocol: 'dtelecom.moderation.v1',
        max_inflight: 1,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        channels: 1,
        max_audio_seconds: 30,
      },
    }));
    try {
      const ticket = await cloud.client.moderation.streamTicket();
      expect(ticket).toEqual({
        token: 'ticket',
        websocketUrl: `${cloud.url.replace('http:', 'ws:')}/v1/moderation/stream`,
        expiresAt: new Date('2030-01-01T00:10:00Z'),
        protocol: 'dtelecom.moderation.v1',
        maxInflight: 1,
        audioFormat: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
        maxAudioSeconds: 30,
      });
      expect(cloud.requests[0].method).toBe('POST');
      expect(cloud.requests[0].path).toBe('/v1/moderation/streams');
    } finally {
      cloud.close();
    }
  });

  const ticket = {
    token: 'ticket',
    websocketUrl: 'wss://cloud.example/v1/moderation/stream',
    expiresAt: new Date(),
    protocol: 'dtelecom.moderation.v1',
    maxInflight: 1,
    audioFormat: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
    maxAudioSeconds: 30,
  };

  it('authenticates, then sends one item at a time and maps results and errors', async () => {
    let metadata: any;
    const socket = new FakeSocket((self, data) => {
      if (typeof data !== 'string') {
        self.reply(
          metadata.id === 'bad'
            ? { type: 'error', id: 'bad', http_status: 402, error: 'insufficient_balance' }
            : { type: 'result', id: metadata.id, request: moderationBody },
        );
        return;
      }
      const value = JSON.parse(data);
      if (value.type === 'auth') {
        expect(value.token).toBe('ticket');
        self.reply({ type: 'ready', protocol: 'dtelecom.moderation.v1', max_inflight: 1 });
      } else {
        metadata = value;
      }
    });
    const stream = await ModerationStream.connect(ticket, (url) => {
      expect(url).toBe(ticket.websocketUrl);
      return socket;
    });

    const first = stream.sendAudio('a-1', Buffer.alloc(32000));
    await expect(stream.sendAudio('a-2', Buffer.alloc(2))).rejects.toThrow('previous');
    const result = await first;
    expect(result.result!.transcript).toBe('hello');
    expect(metadata).toEqual({ id: 'a-1', kind: 'audio', language: 'en' });

    await expect(stream.sendVideoFrame('bad', Buffer.from([1]))).rejects.toMatchObject({
      name: 'CloudApiError',
      status: 402,
      code: 'insufficient_balance',
      id: 'bad',
    });
    await expect(stream.sendAudio('odd', Buffer.alloc(3))).rejects.toThrow(
      'invalid moderation media',
    );

    stream.close();
    expect(socket.closed).toBe(true);
    await expect(stream.sendAudio('late', Buffer.alloc(2))).rejects.toThrow('closed');
  });

  it('rejects a connection the server refuses', async () => {
    const socket = new FakeSocket((self, data) => {
      if (typeof data === 'string' && JSON.parse(data).type === 'auth') {
        self.reply({ type: 'error', error: 'invalid_token' });
      }
    });
    await expect(ModerationStream.connect(ticket, () => socket)).rejects.toThrow('invalid_token');
    expect(socket.closed).toBe(true);
  });
});
