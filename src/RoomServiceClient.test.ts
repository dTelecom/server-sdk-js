import http from 'http';
import type { AddressInfo } from 'net';

import type { AdminToken, CloudClient } from './CloudClient';
import { NodeApiError, RoomNotLiveError, RoomServiceClient } from './RoomServiceClient';

type Call = { method: string; authorization?: string; body: any };

/** A stub node whose Twirp answers come from a script keyed by method name. */
function startNode(answer: (method: string, body: any) => { status: number; body: any }) {
  const calls: Call[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const method = req.url!.split('/').pop()!;
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method, authorization: req.headers.authorization, body });
      const out = answer(method, body);
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  return new Promise<{ url: string; calls: Call[]; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => server.close() });
    });
  });
}

function fakeCloud(apiUrls: string[], expiresInMs = 10 * 60 * 1000) {
  const calls: string[] = [];
  const cloud = {
    adminToken: async (room: string): Promise<AdminToken> => {
      calls.push(room);
      return {
        token: `admin-${calls.length}`,
        apiUrls,
        expiresAt: new Date(Date.now() + expiresInMs),
      };
    },
  } as unknown as CloudClient;
  return { cloud, calls };
}

const notFound = { status: 404, body: { code: 'not_found', msg: 'participant does not exist' } };

describe('RoomServiceClient', () => {
  it('sends participant calls to their node and room calls to one node', async () => {
    const a = await startNode((method) =>
      method === 'ListParticipants'
        ? { status: 200, body: { participants: [{ identity: 'alice' }] } }
        : { status: 200, body: {} },
    );
    const b = await startNode((method) =>
      method === 'ListParticipants'
        ? { status: 200, body: { participants: [{ identity: 'bob' }] } }
        : { status: 200, body: {} },
    );
    try {
      const { cloud, calls } = fakeCloud([a.url, b.url]);
      const svc = new RoomServiceClient(cloud);

      await svc.removeParticipant('room1', 'bob');
      expect(a.calls.map((c) => c.method)).toEqual(['ListParticipants']);
      expect(b.calls.map((c) => c.method)).toEqual(['ListParticipants', 'RemoveParticipant']);
      expect(b.calls[1].authorization).toBe('Bearer admin-1');
      expect(b.calls[1].body).toEqual({ room: 'room1', identity: 'bob' });

      const participants = await svc.listParticipants('room1');
      expect(participants.map((p) => p.identity).sort()).toEqual(['alice', 'bob']);

      await svc.sendData('room1', new Uint8Array([104, 105]), 0, { topic: 'chat' });
      await svc.deleteRoom('room1');
      expect(a.calls.map((c) => c.method)).toEqual([
        'ListParticipants',
        'ListParticipants',
        'SendData',
        'DeleteRoom',
      ]);
      expect(b.calls.map((c) => c.method)).not.toContain('SendData');
      expect(b.calls.map((c) => c.method)).not.toContain('DeleteRoom');

      // One admin token serves every call until it nears expiry.
      expect(calls).toEqual(['room1']);
    } finally {
      a.close();
      b.close();
    }
  });

  it('moves a room call to the next node when one is down, but not after a refusal', async () => {
    const down = await startNode(() => ({
      status: 503,
      body: { code: 'unavailable', msg: 'busy' },
    }));
    const up = await startNode(() => ({ status: 200, body: {} }));
    const refusing = await startNode(() => ({
      status: 400,
      body: { code: 'invalid_argument', msg: 'bad' },
    }));
    try {
      await new RoomServiceClient(fakeCloud([down.url, up.url]).cloud).sendData(
        'room1',
        new Uint8Array([1]),
        0,
      );
      expect(up.calls.map((c) => c.method)).toEqual(['SendData']);

      const err = await new RoomServiceClient(fakeCloud([refusing.url, up.url]).cloud)
        .sendData('room1', new Uint8Array([1]), 0)
        .catch((e) => e);
      expect(err).toBeInstanceOf(NodeApiError);
      expect(err.status).toBe(400);
      expect(up.calls.map((c) => c.method)).toEqual(['SendData']);
    } finally {
      down.close();
      up.close();
      refusing.close();
    }
  });

  it('reports the node error when no node accepts', async () => {
    const a = await startNode(() => notFound);
    try {
      const svc = new RoomServiceClient(fakeCloud([a.url]).cloud);
      const err = await svc.removeParticipant('room1', 'ghost').catch((e) => e);
      expect(err).toBeInstanceOf(NodeApiError);
      expect(err.code).toBe('not_found');
      expect(err.status).toBe(404);
      expect(err.apiUrl).toBe(a.url);
    } finally {
      a.close();
    }
  });

  it('treats a room nobody joined as already gone, and refuses participant calls on it', async () => {
    const svc = new RoomServiceClient(fakeCloud([]).cloud);
    await expect(svc.deleteRoom('empty')).resolves.toBeUndefined();
    await expect(svc.listParticipants('empty')).resolves.toEqual([]);
    await expect(svc.removeParticipant('empty', 'x')).rejects.toBeInstanceOf(RoomNotLiveError);
  });

  it('does not cache a room without nodes', async () => {
    const { cloud, calls } = fakeCloud([]);
    const svc = new RoomServiceClient(cloud);
    await svc.listParticipants('empty');
    await svc.listParticipants('empty');
    expect(calls).toEqual(['empty', 'empty']);
  });

  it('refreshes the admin token when it is about to expire', async () => {
    const a = await startNode(() => ({ status: 200, body: {} }));
    try {
      const { cloud, calls } = fakeCloud([a.url], 30 * 1000);
      const svc = new RoomServiceClient(cloud);
      await svc.removeParticipant('room1', 'x');
      await svc.removeParticipant('room1', 'y');
      expect(calls).toEqual(['room1', 'room1']);
      expect(a.calls.map((c) => c.authorization)).toEqual(['Bearer admin-1', 'Bearer admin-2']);
    } finally {
      a.close();
    }
  });
  it("sends subscriptions grouped by the tracks' publishers", async () => {
    const node = await startNode((method) =>
      method === 'ListParticipants'
        ? {
            status: 200,
            body: {
              participants: [
                { sid: 'PA_A', identity: 'alice', tracks: [{ sid: 'TR_1' }, { sid: 'TR_2' }] },
                { sid: 'PA_B', identity: 'bob', tracks: [{ sid: 'TR_3' }] },
              ],
            },
          }
        : { status: 200, body: {} },
    );
    try {
      const rs = new RoomServiceClient(fakeCloud([node.url]).cloud);
      await rs.updateSubscriptions('demo', 'carol', ['TR_1', 'TR_3', 'TR_2'], false);
      const call = node.calls.find((c) => c.method === 'UpdateSubscriptions')!;
      expect(call.body.subscribe ?? false).toBe(false); // toJSON leaves out the default
      expect(call.body.trackSids ?? []).toEqual([]);
      expect(call.body.participantTracks).toEqual([
        { participantSid: 'PA_A', trackSids: ['TR_1', 'TR_2'] },
        { participantSid: 'PA_B', trackSids: ['TR_3'] },
      ]);
      await expect(rs.updateSubscriptions('demo', 'carol', ['TR_X'], true)).rejects.toThrow(
        'track TR_X is not published',
      );
    } finally {
      node.close();
    }
  });
});
