import { Keypair } from '@solana/web3.js';
import { createSigner, createVerifier } from 'fast-jwt';
import * as bs58 from 'bs58';
import * as crypto from 'crypto';
import axios from "axios";
import {ClaimGrants, VideoGrant} from './grants';
import {getAllNode, IFormattedNodeItem} from "./contract/contract";

// 6 hours
const defaultTTL = 6 * 60 * 60;

export interface AccessTokenOptions {
  /**
   * amount of time before expiration
   * expressed in seconds or a string describing a time span zeit/ms.
   * eg: '2 days', '10h', or seconds as numeric value
   */
  ttl?: number | string;

  /**
   * display name for the participant, available as `Participant.name`
   */
  name?: string;

  /**
   * identity of the user, required for room join tokens
   */
  identity?: string;

  /**
   * custom metadata to be passed to participants
   */
  metadata?: string;

  /**
   * custom metadata to be passed to participants
   */
  webHookURL?: string;
}

export class AccessToken {
  private apiKey: string;
  private apiSecret: string;
  private grants: ClaimGrants;
  private keypair: Keypair;
  private signJwt: (payload: any) => string;
  identity?: string;
  ttl?: number | string;

  /**
   * Creates a new AccessToken
   * @param apiKey API Key, can be set in env API_KEY
   * @param apiSecret Secret, can be set in env API_SECRET
   */
  constructor(apiKey?: string, apiSecret?: string, options?: AccessTokenOptions) {
    if (!apiKey) {
      apiKey = process.env.API_KEY;
    }
    if (!apiSecret) {
      apiSecret = process.env.API_SECRET;
    }
    if (!apiKey || !apiSecret) {
      throw Error('api-key and api-secret must be set');
    } else if (typeof document !== 'undefined') {
      // check against document rather than window because deno provides window
      console.error(
        'You should not include your API secret in your web client bundle.\n\n' +
        'Your web client should request a token from your backend server which should then use ' +
        'the API secret to generate a token. See https://docs.livekit.io/client/connect/',
      );
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.grants = {};
    
    // Create Solana keypair from private key
    const privateKeyBytes = bs58.decode(apiSecret);
    this.keypair = Keypair.fromSecretKey(privateKeyBytes);

    // Create Ed25519 key pair using Node's crypto
    const privateKeyObject = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
        Buffer.from(this.keypair.secretKey.slice(0, 32))
      ]),
      format: 'der',
      type: 'pkcs8'
    });

    // Export private key in PEM format
    const privateKeyPem = privateKeyObject.export({
      format: 'pem',
      type: 'pkcs8'
    });

    // Create signer function
    this.signJwt = createSigner({
      algorithm: 'EdDSA',
      key: privateKeyPem as string,
      iss: this.keypair.publicKey.toBase58()
    });

    this.identity = options?.identity;
    this.ttl = options?.ttl || defaultTTL;
    if (options?.metadata) {
      this.metadata = options.metadata;
    }
    if (options?.name) {
      this.name = options.name;
    }
  }

  /**
   * Adds a video grant to this token.
   * @param grant
   */
  addGrant(grant: VideoGrant) {
    this.grants.video = grant;
  }

  /**
   * Set metadata to be passed to the Participant, used only when joining the room
   */
  set metadata(md: string) {
    this.grants.metadata = md;
  }

  set name(name: string) {
    this.grants.name = name;
  }

  get sha256(): string | undefined {
    return this.grants.sha256;
  }

  set sha256(sha: string | undefined) {
    this.grants.sha256 = sha;
  }

  set webHookURL(url: string | undefined) {
    this.grants.webHookURL = url;
  }

  /**
   * @returns JWT encoded token
   */
  toJwt(): string {
    if (this.identity && this.grants.video?.roomJoin && !this.grants.video?.room) {
      throw Error('room is required for join but not set');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ...this.grants,
      iss: this.keypair.publicKey.toBase58(),
      sub: this.identity || 'unknown',
      nbf: now,
      exp: now + (typeof this.ttl === 'number' ? this.ttl : defaultTTL)
    };

    return this.signJwt(payload);
  }

  /**
   * @returns wss url
   */
  async getWsUrl(clientIp?: string): Promise<string> {
    let nodes = await getAllNode();

    nodes = nodes.sort(() => 0.5 - Math.random());

    const address = await this.requestAddressForClient(nodes, clientIp);

    return address;
  }

  async requestAddressForClient(nodes: IFormattedNodeItem[], clientIp?: string) {
    let address = `wss://${nodes[0].ip}.dtel.network`;

    if (!clientIp) {
      return address;
    }

    for (const node of nodes) {
      const response = await axios.get<{ domain: string }>(`https://${node.ip}.dtel.network/relevant`, {
        data: {ip: clientIp},
        timeout: 3000
      }).catch(() => null);

      if (response?.data.domain) {
        address = `wss://${response.data.domain}`;
        break;
      }
    }

    return address;
  }
}

export class TokenVerifier {
  private verifyJwt: (token: string) => any;

  constructor(apiKey: string) {
    // Create public key object from apiKey
    const publicKeyBytes = bs58.decode(apiKey);
    
    // Create Ed25519 public key using Node's crypto
    const publicKeyObject = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]),
        Buffer.from(publicKeyBytes)
      ]),
      format: 'der',
      type: 'spki'
    });

    // Export public key in PEM format
    const publicKeyPem = publicKeyObject.export({
      format: 'pem',
      type: 'spki'
    });

    // Create verifier function
    this.verifyJwt = createVerifier({
      algorithms: ['EdDSA'],
      key: publicKeyPem as string,
      allowedIss: apiKey
    });
  }

  verify(token: string): ClaimGrants {
    const decoded = this.verifyJwt(token);

    if (!decoded) {
      throw Error('invalid token');
    }

    return decoded as ClaimGrants;
  }
}
