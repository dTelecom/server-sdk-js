import * as jwt from 'jsonwebtoken'
import KeyEncoder from "key-encoder"
import nearbySort from "nearby-sort"
import geoIp from "fast-geoip"
import {ClaimGrants, VideoGrant} from './grants'
import {getAllNode} from "./contract/contract"

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

  private keyEncoder: KeyEncoder;

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
    this.keyEncoder = new KeyEncoder('secp256k1');
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
    // TODO: check for video grant validity

    const opts: jwt.SignOptions = {
      issuer: this.apiKey,
      expiresIn: this.ttl,
      notBefore: 0,
      algorithm: 'ES256',
    };
    if (this.identity) {
      opts.subject = this.identity;
      opts.jwtid = this.identity;
    } else if (this.grants.video?.roomJoin) {
      throw Error('identity is required for join but not set');
    }

    const pemPrivateKey = this.keyEncoder.encodePrivate(this.apiSecret, 'raw', 'pem')

    return jwt.sign(this.grants, pemPrivateKey, opts);
  }

  /**
   * @returns wss url
   */
  async getWsUrl(clientIp?: string): Promise<string> {
    let nodes = await getAllNode();
    const location = clientIp ? await geoIp.lookup(clientIp) : null;

    // tmp filter by this working ip addresses
    const allowed = [
      "2499479479",
      "1097669481",
      "3630803538",
      "1742105714",
    ];
    nodes = nodes.filter(item => allowed.includes(item.ip));

    let urls = nodes.map((item) => (`wss://${item.ip}.dtel.network`)).sort(() => 0.5 - Math.random());

    if (location?.ll) {
      const ascSortedData = await nearbySort({lat: location.ll[0], long: location.ll[1]}, nodes);
      urls = ascSortedData.map((item) => (`wss://${item.ip}.dtel.network`));
    }

    return urls[0];
  }
}

export class TokenVerifier {
  private apiKey: string;

  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  verify(token: string): ClaimGrants {
    const decoded = jwt.verify(token, this.apiSecret, { issuer: this.apiKey });
    if (!decoded) {
      throw Error('invalid token');
    }

    return decoded as ClaimGrants;
  }
}
