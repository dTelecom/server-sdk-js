const { createSigner, createVerifier } = require('fast-jwt');
const bs58 = require('bs58');
const axios = require('axios');
const { getAllNode } = require('./contract/contract');
const crypto = require('crypto');

// Import types
import type { ClaimGrants, VideoGrant } from './grants';
import type { IAllNodeResponseItem } from './contract/contract';

// Check if we're in a Node.js environment
const isNode = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

// 6 hours
const defaultTTL = 6 * 60 * 60;

const nodeRefreshInterval = 60 * 1000;

// Response from /relevants endpoint
interface RelevantResponse {
  domain: string;
  ip: string;
  id?: string;
  participants?: number;
  country?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

interface NodesCache {
  nodes: IAllNodeResponseItem[];
  nodesOrdered: RelevantResponse[];
  lastRefreshTime: number;
}

// Global cache for available servers
let nodesCache: NodesCache | null = null;

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
  private signJwt: (payload: any) => string;
  identity?: string;
  ttl?: number | string;

  constructor(apiKey?: string, apiSecret?: string, options?: AccessTokenOptions) {
    if (!apiKey) {
      apiKey = process.env.API_KEY;
    }
    if (!apiSecret) {
      apiSecret = process.env.API_SECRET;
    }
    if (!apiKey || !apiSecret) {
      throw Error('api-key and api-secret must be set');
    } else if (!isNode) {
      console.error(
        'You should not include your API secret in your web client bundle.\n\n' +
        'Your web client should request a token from your backend server which should then use ' +
        'the API secret to generate a token. See https://docs.livekit.io/client/connect/',
      );
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.grants = {};

    if (!isNode) {
      throw new Error('AccessToken should only be used on the server side');
    }

    // Create Ed25519 key pair using Node's crypto
    const privateKeyBytes = bs58.decode(apiSecret);
    const privateKeyObject = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
        Buffer.from(privateKeyBytes.slice(0, 32))
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
      iss: apiKey
    });

    this.identity = options?.identity;
    this.ttl = options?.ttl || defaultTTL;
    if (options?.metadata) {
      this.metadata = options.metadata;
    }
    if (options?.name) {
      this.name = options.name;
    }
    if (options?.webHookURL) {
      this.webHookURL = options.webHookURL;
    }
  }

  addGrant(grant: VideoGrant) {
    this.grants.video = {
      ...this.grants.video,
      ...grant,
    };
  }

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

  toJwt(): string {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('apiKey and apiSecret are required');
    }

    if (this.identity && this.grants.video?.roomJoin && !this.grants.video?.room) {
      throw Error('room is required for join but not set');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ...this.grants,
      iss: this.apiKey,
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
    const addresses = await this.requestRelevantsForIp(clientIp);
    const address = addresses[0];

    if (!address) {
      throw new Error('Not found');
    }

    return `wss://${address}`;
  }

  /**
   * @returns array of wss urls
   */
  async getWsUrls(clientIp?: string): Promise<string[]> {
    if (!clientIp) {
      const nodes = await this.listNodes();
      return nodes.map((node: IAllNodeResponseItem) => `wss://${node.domain}`);
    }

    const relevantNodes = await this.requestRelevantsForIp(clientIp);
    return relevantNodes.map((domain) => `wss://${domain}`);
  }

  private async listNodes(): Promise<IAllNodeResponseItem[]> {
    await this.ensureCacheInitialized();
    return nodesCache?.nodes || [];
  }

  private async getOrderedNodes(): Promise<string[]> {
    await this.ensureCacheInitialized();

    if (nodesCache && nodesCache.nodesOrdered.length > 0) {
      return nodesCache.nodesOrdered.map(n => n.domain);
    }

    const nodes = await this.listNodes();
    return nodes.map(n => n.domain);
  }

  private async ensureCacheInitialized(): Promise<void> {
    if (!nodesCache) {
      nodesCache = {
        nodes: [],
        nodesOrdered: [],
        lastRefreshTime: 0
      };

      await this.refresh();
      return;
    }

    const now = Date.now();
    if (now - nodesCache.lastRefreshTime >= nodeRefreshInterval) {
      await this.refresh()
    }
  }

  async refresh(): Promise<void> {
    try {
      const nodes = await getAllNode();
      const now = Date.now();

      if (!nodesCache) {
        nodesCache = {
          nodes: [],
          nodesOrdered: [],
          lastRefreshTime: now
        };
      }

      nodesCache.nodes = nodes;
      nodesCache.lastRefreshTime = now;

      const serverIp = process.env.SERVER_IP;
      if (serverIp) {
        const orderedNodes = await this.getOrderedNodes();
        const relevants = await this.fetchRelevants(orderedNodes, serverIp);
        if (relevants.length > 0) {
          nodesCache.nodesOrdered = relevants;
        }
      }
    } catch (error) {
      console.error('Error refreshing nodes cache:', error);
    }
  }

  private async fetchRelevants(domains: string[], ip: string): Promise<RelevantResponse[]> {
    for (const domain of domains) {
      try {
        const response = await axios.post(
          `https://${domain}/relevants`,
          { ip },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 1000
          }
        );
        if (response?.data && Array.isArray(response.data) && response.data.length > 0) {
          return response.data as RelevantResponse[];
        }
      } catch (error) {
        console.error(`Failed to fetch relevants from ${domain}:`, error);
      }
    }
    return [];
  }

  static clearCache(): void {
    nodesCache = null;
  }

  async requestRelevantsForIp(ip?: string): Promise<string[]> {
    const orderedNodes = await this.getOrderedNodes();

    if (!ip) {
      return orderedNodes;
    }

    const relevants = await this.fetchRelevants(orderedNodes, ip);
    if (relevants.length > 0) {
      return relevants.map(node => node.domain);
    }

    return orderedNodes;
  }
}

export class TokenVerifier {
  private verifyJwt: (token: string) => any;

  constructor(apiKey: string) {
    if (!isNode) {
      throw new Error('TokenVerifier should only be used on the server side');
    }

    // Create Ed25519 public key using Node's crypto
    const publicKeyBytes = bs58.decode(apiKey);
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

// CommonJS exports for runtime
module.exports = {
  AccessToken,
  TokenVerifier
};
