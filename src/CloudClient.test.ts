import http from 'http';
import type { AddressInfo } from 'net';

import { CloudApiError, CloudClient, durationToMinutes } from './CloudClient';

type Recorded = { path: string; authorization?: string; body: any };

/** A stub of the cloud that records requests and answers from a script. */
function startCloud(
  answer: (
    path: string,
    body: any,
  ) => { status: number; body: any; headers?: Record<string, string> },
) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ path: req.url!, authorization: req.headers.authorization, body });
      const out = answer(req.url!, body);
      res.writeHead(out.status, { 'Content-Type': 'application/json', ...(out.headers ?? {}) });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise<{ url: string; requests: Recorded[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => server.close() });
    });
  });
}

describe('durationToMinutes', () => {
  it('rounds seconds up to minutes and parses units', () => {
    expect(durationToMinutes(undefined, 6 * 3600)).toBe(360);
    expect(durationToMinutes(90, 0)).toBe(2);
    expect(durationToMinutes('90s', 0)).toBe(2);
    expect(durationToMinutes('30m', 0)).toBe(30);
    expect(durationToMinutes('12h', 0)).toBe(720);
    expect(durationToMinutes('1 day', 0)).toBe(1440);
    expect(durationToMinutes('2 hours', 0)).toBe(120);
  });

  it('rejects nonsense and more than a day', () => {
    expect(() => durationToMinutes('soon', 0)).toThrow('invalid duration');
    expect(() => durationToMinutes(0, 0)).toThrow('invalid duration');
    expect(() => durationToMinutes('25h', 0)).toThrow('24 hour');
  });
});

describe('CloudClient', () => {
  it('requires credentials and a base URL', () => {
    delete process.env.DTELECOM_API_KEY;
    delete process.env.DTELECOM_API_SECRET;
    delete process.env.DTELECOM_CLOUD_URL;
    expect(() => new CloudClient({})).toThrow('apiKey and apiSecret');
    expect(() => new CloudClient({ apiKey: 'k', apiSecret: 's' })).toThrow('baseUrl');
    process.env.DTELECOM_API_KEY = 'k';
    process.env.DTELECOM_API_SECRET = 's';
    process.env.DTELECOM_CLOUD_URL = 'https://cloud.example/';
    expect(() => new CloudClient()).not.toThrow();
    delete process.env.DTELECOM_API_KEY;
    delete process.env.DTELECOM_API_SECRET;
    delete process.env.DTELECOM_CLOUD_URL;
  });

  it('reads a session and lists a room with charges', async () => {
    const stt = {
      session_id: 'stt-1',
      service: 'stt',
      status: 'completed',
      room_name: 'call',
      identity: 'alice',
      webrtc_session_id: 'sess-1',
      created_at: '2030-01-01T00:00:05Z',
      started_at: '2030-01-01T00:00:06Z',
      ended_at: '2030-01-01T00:01:06Z',
      charged_microcredits: '4000',
      charged_usd: '0.004',
      final: true,
      covered_by_addon: false,
    };
    const cloud = await startCloud((path) => {
      if (path === '/v1/sessions/stt-1') return { status: 200, body: stt };
      if (path.startsWith('/v1/sessions?')) {
        return {
          status: 200,
          body: { sessions: [stt], total_microcredits: '4000', total_usd: '0.004' },
        };
      }
      if (path === '/v1/sessions/none') return { status: 404, body: { error: 'session_not_found' } };
      return { status: 404, body: { error: 'not_found' } };
    });
    try {
      const client = new CloudClient({ apiKey: 'k', apiSecret: 's', baseUrl: cloud.url });
      const expected = {
        sessionId: 'stt-1',
        service: 'stt',
        status: 'completed',
        roomName: 'call',
        identity: 'alice',
        webrtcSessionId: 'sess-1',
        createdAt: new Date('2030-01-01T00:00:05Z'),
        startedAt: new Date('2030-01-01T00:00:06Z'),
        endedAt: new Date('2030-01-01T00:01:06Z'),
        chargedMicrocredits: '4000',
        chargedUsd: '0.004',
        final: true,
        coveredByAddon: false,
      };
      expect(await client.getSession('stt-1')).toEqual(expected);
      const list = await client.listSessions('my call', {
        since: new Date('2030-01-01T00:00:00Z'),
        limit: 10,
      });
      expect(list).toEqual({ sessions: [expected], totalMicrocredits: '4000', totalUsd: '0.004' });
      expect(cloud.requests[1].path).toBe(
        '/v1/sessions?room=my+call&since=2030-01-01T00%3A00%3A00.000Z&limit=10',
      );
      await expect(client.getSession('none')).rejects.toMatchObject({
        status: 404,
        code: 'session_not_found',
      });
    } finally {
      cloud.close();
    }
  });

  it('creates, extends and mints admin tokens with the hosted API shapes', async () => {
    const cloud = await startCloud((path) => {
      if (path === '/v1/webrtc/token') {
        return {
          status: 200,
          body: {
            session_id: 'sess-1',
            token: 'tok',
            ws_url: 'wss://node.example',
            region: 'Frankfurt',
            expires_at: '2030-01-01T00:00:00Z',
          },
        };
      }
      if (path === '/v1/webrtc/token/extend') {
        return {
          status: 200,
          body: {
            token: 'tok2',
            ws_url: 'wss://node.example',
            region: 'Frankfurt',
            new_expires_at: '2030-01-02T00:00:00Z',
          },
        };
      }
      if (path === '/v1/webrtc/admin-token') {
        return {
          status: 200,
          body: { token: 'admin', api_urls: null, expires_at: '2030-01-01T00:10:00Z' },
        };
      }
      return { status: 404, body: { error: 'not_found' } };
    });
    try {
      const client = new CloudClient({
        apiKey: 'key',
        apiSecret: 'secret',
        baseUrl: `${cloud.url}/`,
      });

      const token = await client.createToken({
        room: 'room1',
        identity: 'alice',
        name: 'Alice',
        metadata: '{"role":"host"}',
        ttl: '12h',
        clientIp: '203.0.113.5',
        webhookUrls: ['https://app.example/webhook'],
        grants: { canPublish: false, roomAdmin: true },
      });
      expect(token).toEqual({
        token: 'tok',
        wsUrl: 'wss://node.example',
        sessionId: 'sess-1',
        region: 'Frankfurt',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      });
      expect(cloud.requests[0].authorization).toBe('Bearer key:secret');
      expect(cloud.requests[0].body).toEqual({
        room_name: 'room1',
        identity: 'alice',
        duration_minutes: 720,
        name: 'Alice',
        metadata: '{"role":"host"}',
        client_ip: '203.0.113.5',
        webhook_urls: ['https://app.example/webhook'],
        grants: { can_publish: false, room_admin: true },
      });

      const minimal = await client.createToken({ room: 'room1', identity: 'bob' });
      expect(minimal.sessionId).toBe('sess-1');
      expect(cloud.requests[1].body).toEqual({
        room_name: 'room1',
        identity: 'bob',
        duration_minutes: 360,
      });

      const extended = await client.extendToken('sess-1', '15m');
      expect(extended).toEqual({
        token: 'tok2',
        wsUrl: 'wss://node.example',
        region: 'Frankfurt',
        expiresAt: new Date('2030-01-02T00:00:00Z'),
      });
      expect(cloud.requests[2].body).toEqual({ session_id: 'sess-1', additional_minutes: 15 });

      const admin = await client.adminToken('room1');
      expect(admin).toEqual({
        token: 'admin',
        apiUrls: [],
        expiresAt: new Date('2030-01-01T00:10:00Z'),
      });
      expect(cloud.requests[3].body).toEqual({ room_name: 'room1' });
    } finally {
      cloud.close();
    }
  });

  it('maps errors to CloudApiError with the code and Retry-After', async () => {
    const cloud = await startCloud((_path, body) => {
      if (body.identity === 'poor') return { status: 402, body: { error: 'insufficient_balance' } };
      if (body.identity === 'wait') {
        return {
          status: 503,
          body: { error: 'nodes_unavailable' },
          headers: { 'Retry-After': '30' },
        };
      }
      return { status: 500, body: 'boom' };
    });
    try {
      const client = new CloudClient({ apiKey: 'key', apiSecret: 'secret', baseUrl: cloud.url });

      await expect(client.createToken({ room: 'r', identity: 'poor' })).rejects.toMatchObject({
        name: 'CloudApiError',
        status: 402,
        code: 'insufficient_balance',
        retryAfter: undefined,
      });
      await expect(client.createToken({ room: 'r', identity: 'wait' })).rejects.toMatchObject({
        status: 503,
        code: 'nodes_unavailable',
        retryAfter: 30,
      });
      const err = await client.createToken({ room: 'r', identity: 'x' }).catch((e) => e);
      expect(err).toBeInstanceOf(CloudApiError);
      expect(err.code).toBe('http_500');
    } finally {
      cloud.close();
    }
  });
});
