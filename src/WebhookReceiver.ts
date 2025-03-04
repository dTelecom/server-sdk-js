import crypto from 'crypto';
import { TokenVerifier } from './AccessToken.js';
import { WebhookEvent } from './proto/livekit_webhook.js';
import { Room } from './proto/livekit_models.js';

export const authorizeHeader = 'Authorize';

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
  private verifier: TokenVerifier;

  constructor(apiKey: string, apiSecret: string) {
    this.verifier = new TokenVerifier(apiKey);
  }

  /**
   *
   * @param body string or object of the posted body
   * @param authHeader `Authorization` header from the request
   * @param skipAuth true to skip auth validation
   * @returns
   */
  receive(body: string | object, authHeader?: string, skipAuth: boolean = false): WebhookEventWithOptionalFields {
    // verify token
    if (!skipAuth) {
      if (!authHeader) {
        throw new Error('authorization header is empty');
      }
      const claims = this.verifier.verify(authHeader);
      // confirm sha
      const hash = crypto.createHash('sha256');
      hash.update(typeof body === 'string' ? body : JSON.stringify(body));

      if (claims.sha256 !== hash.digest('base64')) {
        throw new Error('sha256 checksum of body does not match');
      }
    }

    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body;
    const event = WebhookEvent.fromJSON(parsedBody);

    // Create a new object with optional fields
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
