import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { CloudClient } from '@dtelecom/server-sdk-js';
import { LogLevel, Room, setLogLevel } from '@dtelecom/server-sdk-node';

setLogLevel(LogLevel.SILENT);

async function waitFor(check, description) {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, description);
    await delay(200);
  }
}

test('issue two Cloud tokens and manage their live room', { timeout: 90_000 }, async () => {
  const cloud = new CloudClient();
  const roomName = 'sdk-js-' + randomUUID();
  const roomService = cloud.roomService();
  const alice = new Room();
  const bob = new Room();
  try {
    for (const [room, identity] of [[alice, 'alice'], [bob, 'bob']]) {
      const { token, wsUrl } = await cloud.createToken({ room: roomName, identity, ttl: '2m' });
      await room.connect(wsUrl, token);
      assert.equal(room.localParticipant.identity, identity);
    }
    await waitFor(
      () => alice.getParticipantByIdentity('bob') && bob.getParticipantByIdentity('alice'),
      'Both participants should discover their peer',
    );

    const participants = await roomService.listParticipants(roomName);
    assert.deepEqual(participants.map((participant) => participant.identity).sort(), ['alice', 'bob']);

    const metadata = 'verified-' + randomUUID();
    await roomService.updateRoomMetadata(roomName, metadata);
    await waitFor(
      () => alice.metadata === metadata && bob.metadata === metadata,
      'Both participants should observe the room metadata from the backend',
    );
  } finally {
    await Promise.all([alice.disconnect(), bob.disconnect()]);
  }
});
