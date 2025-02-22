import axios, { AxiosInstance, AxiosResponse } from 'axios';
import camelcaseKeys from 'camelcase-keys';

// twirp RPC adapter for client implementation

const defaultPrefix = '/twirp';

export const livekitPackage = 'livekit';
export interface Rpc {
  request(service: string, method: string, data: any, headers?: any): Promise<string>;
}

/**
 * JSON based Twirp V7 RPC
 */
export class TwirpRpc {
  host: string;

  pkg: string;

  prefix: string;

  instance: AxiosInstance;

  constructor(host: string, pkg: string, prefix?: string) {
    this.host = host;
    this.pkg = pkg;
    this.prefix = prefix || defaultPrefix;
    this.instance = axios.create({
      baseURL: host,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async request<T>(
    service: string,
    method: string,
    data: any,
    options: { headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = `${this.prefix}/${this.pkg}.${service}/${method}`;

    return this.instance
      .post(url, data, {
        headers: {
          ...options.headers,
        },
      })
      .then((res: AxiosResponse) => {
        if (res.data === null || res.data === undefined) {
          return {};
        }
        return camelcaseKeys(res.data, { deep: true });
      });
  }
}
