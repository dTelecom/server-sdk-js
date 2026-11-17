import crypto from 'crypto';
import bs58 from 'bs58';
import { createSigner } from 'fast-jwt';

import { WebhookReceiver } from './WebhookReceiver';
import { WebhookEvent } from './proto/livekit_webhook';

// A node keypair: the webhook is signed with the private key, iss is the base58 public key.
const nodeKeys = crypto.generateKeyPairSync('ed25519');
const nodePublicRaw = (
  nodeKeys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
).subarray(12);
const nodeKey = bs58.encode(nodePublicRaw);
const strangerKeys = crypto.generateKeyPairSync('ed25519');
const strangerKey = bs58.encode(
  (strangerKeys.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(12),
);

jest.mock('./contract/contract', () => ({
  getAllNode: async () => [{ domain: 'node.example', key: nodeKey }],
  getNodeByAddress: async () => {
    throw new Error('not found');
  },
}));

function sign(
  keys: crypto.KeyPairKeyObjectResult,
  iss: string,
  body: string,
  sha?: string,
  times: { nbf?: number; exp?: number } = {},
): string {
  const signer = createSigner({
    algorithm: 'EdDSA',
    key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    iss,
  });
  return signer({
    sha256: sha ?? crypto.createHash('sha256').update(body).digest('base64'),
    ...times,
  });
}

describe('WebhookReceiver', () => {
  const body =
    '{"event":"participant_joined","id":"EV_1","room":{"sid":"RM_1","name":"mytestroom","key":"room-key"},"participant":{"identity":"alice","rttMs":15}}';
  const receiver = new WebhookReceiver();

  it('verifies a node signature and decodes the event', async () => {
    const event = await receiver.receive(body, sign(nodeKeys, nodeKey, body));
    expect(event.event).toBe('participant_joined');
    expect(event.room?.name).toBe('mytestroom');
    expect(event.room?.key).toBe('room-key');
    expect(event.participant?.identity).toBe('alice');
    expect(event.participant?.rttMs).toBe(15);
  });

  it('allows a minute of clock difference with the node', async () => {
    const now = Math.floor(Date.now() / 1000);
    // A node clock slightly ahead: nbf a moment in the future.
    const ahead = await receiver.receive(
      body,
      sign(nodeKeys, nodeKey, body, undefined, { nbf: now + 2 }),
    );
    expect(ahead.event).toBe('participant_joined');
    const justExpired = await receiver.receive(
      body,
      sign(nodeKeys, nodeKey, body, undefined, { exp: now - 5 }),
    );
    expect(justExpired.event).toBe('participant_joined');
    await expect(
      receiver.receive(body, sign(nodeKeys, nodeKey, body, undefined, { exp: now - 120 })),
    ).rejects.toThrow();
  });

  it('accepts a Bearer prefix', async () => {
    const event = await receiver.receive(body, `Bearer ${sign(nodeKeys, nodeKey, body)}`);
    expect(event.room?.name).toBe('mytestroom');
  });

  it('rejects a key that is not a registered node', async () => {
    await expect(receiver.receive(body, sign(strangerKeys, strangerKey, body))).rejects.toThrow(
      'webhook signed by unknown node',
    );
  });

  it('rejects a forged signature', async () => {
    await expect(receiver.receive(body, sign(strangerKeys, nodeKey, body))).rejects.toThrow();
  });

  it('rejects a body that does not match the sha256 claim', async () => {
    await expect(receiver.receive(body, sign(nodeKeys, nodeKey, body, 'wrong'))).rejects.toThrow(
      'sha256 checksum of body does not match',
    );
  });

  it('rejects a missing header and malformed tokens', async () => {
    await expect(receiver.receive(body)).rejects.toThrow('authorization header is empty');
    await expect(receiver.receive(body, 'invalid.token')).rejects.toThrow('invalid JWT format');
  });

  it('skips verification on request', async () => {
    const event = await receiver.receive(body, undefined, true);
    expect(event.room?.name).toBe('mytestroom');
  });

  it('leaves empty room fields undefined', async () => {
    const event = await receiver.receive(
      '{"event":"room_finished","room":{"sid":"RM_1","name":""}}',
      undefined,
      true,
    );
    expect(event.room?.name).toBeUndefined();
    expect(event.room?.key).toBeUndefined();
  });
});

describe('WebhookEvent JSON', () => {
  it('ignores extra fields and fills missing ones', () => {
    const event = WebhookEvent.fromJSON({
      event: 'room_started',
      room: { sid: 'RM_1' },
      extra: 'x',
    });
    expect(event.room?.sid).toBe('RM_1');
    expect(event.room?.name).toBe('');
  });
});
