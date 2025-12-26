import type { ClaimGrants, VideoGrant } from './grants.js';

export interface AccessTokenOptions {
  ttl?: number | string;
  name?: string;
  identity?: string;
  metadata?: string;
  webHookURL?: string;
}

export class AccessToken {
  constructor(apiKey?: string, apiSecret?: string, options?: AccessTokenOptions) {
    throw new Error('AccessToken can only be used on the server side. Use your backend API to generate tokens.');
  }

  addGrant(grant: VideoGrant): void {
    throw new Error('AccessToken can only be used on the server side');
  }

  set metadata(md: string) {
    throw new Error('AccessToken can only be used on the server side');
  }

  set name(name: string) {
    throw new Error('AccessToken can only be used on the server side');
  }

  get sha256(): string | undefined {
    throw new Error('AccessToken can only be used on the server side');
  }

  set sha256(sha: string | undefined) {
    throw new Error('AccessToken can only be used on the server side');
  }

  set webHookURL(url: string | undefined) {
    throw new Error('AccessToken can only be used on the server side');
  }

  toJwt(): string {
    throw new Error('AccessToken can only be used on the server side');
  }

  async getWsUrl(clientIp?: string): Promise<string> {
    throw new Error('AccessToken can only be used on the server side');
  }

  async getWsUrls(clientIp?: string): Promise<string[]> {
    throw new Error('AccessToken can only be used on the server side');
  }
}

export class TokenVerifier {
  constructor(apiKey: string) {
    throw new Error('TokenVerifier can only be used on the server side');
  }

  verify(token: string): ClaimGrants {
    throw new Error('TokenVerifier can only be used on the server side');
  }
} 
