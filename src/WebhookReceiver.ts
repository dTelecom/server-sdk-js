import crypto from 'crypto';
import { TokenVerifier } from './AccessToken.js';
import { WebhookEvent } from './proto/livekit_webhook.js';
import { Room } from './proto/livekit_models.js';
import { getAllNode, getNodeByAddress } from './contract/contract.js';

export const authorizeHeader = 'Authorization';

// Extend Room type to make certain fields optional
type WebhookRoom = Omit<Room, 'name' | 'metadata' | 'turnPassword' | 'key'> & {
  name?: string;
  metadata?: string;
  turnPassword?: string;
  key?: string;
};

// Extend WebhookEvent type to use WebhookRoom
type WebhookEventWithOptionalFields = Omit<WebhookEvent, 'room'> & {
  room?: WebhookRoom;
};

export class WebhookReceiver {
  private nodeVerifiers: Map<string, TokenVerifier> = new Map();
  private validNodeKeys: Set<string> | null = null;

  constructor(_apiKey: string, _apiSecret: string) {
    // Arguments kept for backwards compatibility but are not used.
    // Webhooks are signed by SFU nodes with their own Ed25519 keys,
    // not with the application's API key.
  }

  /**
   * Decode JWT payload without signature verification.
   * Used to extract the `iss` claim (the SFU node's public key).
   */
  private decodePayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('invalid JWT format');
    }
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  }

  /**
   * Verify and decode a webhook event.
   *
   * Verification flow (decentralized):
   *   1. Decode the JWT to extract `iss` (the SFU node's public key)
   *   2. Confirm the key belongs to a registered node via the Solana registry
   *   3. Verify the Ed25519 signature with the node's public key
   *   4. Verify the SHA-256 body hash in the claims
   *
   * @param body  Raw POST body (string) or parsed object
   * @param authHeader  Value of the `Authorization` header
   * @param skipAuth  Set `true` to skip all verification
   */
  async receive(body: string | object, authHeader?: string, skipAuth: boolean = false): Promise<WebhookEventWithOptionalFields> {
    if (!skipAuth) {
      if (!authHeader) {
        throw new Error('authorization header is empty');
      }

      // 1. Decode JWT to get issuer (node's public key)
      const payload = this.decodePayload(authHeader);
      const nodeKey = payload.iss as string;
      if (!nodeKey) {
        throw new Error('JWT missing iss claim');
      }

      // 2. Verify node is in the Solana registry
      if (!this.validNodeKeys) {
        const nodes = await getAllNode();
        this.validNodeKeys = new Set(nodes.map(n => n.key));
      }
      if (!this.validNodeKeys.has(nodeKey)) {
        // Node not in cached list — query Solana registry directly
        try {
          const node = await getNodeByAddress(nodeKey);
          this.validNodeKeys.add(node.key);
        } catch {
          throw new Error('webhook signed by unknown node: ' + nodeKey);
        }
      }

      // 3. Verify JWT signature with the node's public key
      let verifier = this.nodeVerifiers.get(nodeKey);
      if (!verifier) {
        verifier = new TokenVerifier(nodeKey);
        this.nodeVerifiers.set(nodeKey, verifier);
      }
      const claims = verifier.verify(authHeader);

      // 4. Verify SHA-256 body hash
      const hash = crypto.createHash('sha256');
      hash.update(typeof body === 'string' ? body : JSON.stringify(body));
      if (claims.sha256 !== hash.digest('base64')) {
        throw new Error('sha256 checksum of body does not match');
      }
    }

    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    const event = WebhookEvent.fromJSON(parsedBody);

    const result: WebhookEventWithOptionalFields = {
      ...event,
      room: event.room ? {
        ...event.room,
        name: event.room.name === '' ? undefined : event.room.name,
        metadata: event.room.metadata === '' ? undefined : event.room.metadata,
        turnPassword: event.room.turnPassword === '' ? undefined : event.room.turnPassword,
        key: event.room.key === '' ? undefined : event.room.key,
      } : undefined
    };

    return result;
  }
}
