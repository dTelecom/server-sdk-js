import crypto from 'crypto';

import { getAllNode, getNodeByAddress } from './contract/contract.js';
import { Room } from './proto/livekit_models.js';
import { WebhookEvent } from './proto/livekit_webhook.js';
import { TokenVerifier } from './TokenVerifier.js';

export const authorizeHeader = 'Authorization';

// Room with the fields a node leaves empty made optional.
export type WebhookRoom = Omit<Room, 'name' | 'metadata' | 'turnPassword' | 'key'> & {
  name?: string;
  metadata?: string;
  turnPassword?: string;
  /** Project room key, set on participant and track events from cloud tokens. */
  key?: string;
};

export type WebhookEventWithOptionalFields = Omit<WebhookEvent, 'room'> & {
  room?: WebhookRoom;
};

/**
 * Verifies and decodes node webhooks. Nodes sign each delivery with their own Ed25519 key;
 * the receiver checks the key against the node registry (`SOLANA_REGISTRY_AUTHORITY` and
 * friends select the network, see `contract`).
 */
export class WebhookReceiver {
  private readonly nodeVerifiers = new Map<string, TokenVerifier>();

  private validNodeKeys: Set<string> | null = null;

  /**
   * @param _apiKey ignored, kept so 3.x call sites compile
   * @param _apiSecret ignored
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-useless-constructor, no-useless-constructor
  constructor(_apiKey?: string, _apiSecret?: string) {}

  private static decodePayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('invalid JWT format');
    }
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  }

  /**
   * Verifies a delivery and returns the event.
   *
   * 1. The JWT's `iss` is the node's public key.
   * 2. That key must be a registered node.
   * 3. The signature must verify with it.
   * 4. The `sha256` claim must match the body.
   *
   * @param body raw POST body, or the parsed object when the raw string is unavailable
   * @param authHeader the `Authorization` header value
   * @param skipAuth true to decode without verifying
   */
  async receive(
    body: string | object,
    authHeader?: string,
    skipAuth: boolean = false,
  ): Promise<WebhookEventWithOptionalFields> {
    if (!skipAuth) {
      if (!authHeader) {
        throw new Error('authorization header is empty');
      }
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

      const payload = WebhookReceiver.decodePayload(token);
      const nodeKey = payload.iss;
      if (typeof nodeKey !== 'string' || !nodeKey) {
        throw new Error('JWT missing iss claim');
      }

      if (!this.validNodeKeys) {
        const nodes = await getAllNode();
        this.validNodeKeys = new Set(nodes.map((n) => n.key));
      }
      if (!this.validNodeKeys.has(nodeKey)) {
        try {
          const node = await getNodeByAddress(nodeKey);
          this.validNodeKeys.add(node.key);
        } catch {
          throw new Error(`webhook signed by unknown node: ${nodeKey}`);
        }
      }

      let verifier = this.nodeVerifiers.get(nodeKey);
      if (!verifier) {
        verifier = new TokenVerifier(nodeKey);
        this.nodeVerifiers.set(nodeKey, verifier);
      }
      const claims = verifier.verify(token);

      const hash = crypto.createHash('sha256');
      hash.update(typeof body === 'string' ? body : JSON.stringify(body));
      if (claims.sha256 !== hash.digest('base64')) {
        throw new Error('sha256 checksum of body does not match');
      }
    }

    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    const event = WebhookEvent.fromJSON(parsedBody);

    return {
      ...event,
      room: event.room
        ? {
            ...event.room,
            name: event.room.name === '' ? undefined : event.room.name,
            metadata: event.room.metadata === '' ? undefined : event.room.metadata,
            turnPassword: event.room.turnPassword === '' ? undefined : event.room.turnPassword,
            key: event.room.key === '' ? undefined : event.room.key,
          }
        : undefined,
    };
  }
}
