/** A non-2xx answer from the cloud. `code` is the cloud's error code, such as `insufficient_balance`. */
export class CloudApiError extends Error {
  readonly status: number;

  readonly code: string;

  /** Seconds to wait before retrying, when the cloud says so (429s and 503s). */
  readonly retryAfter?: number;

  /** Id of the job or request the error belongs to, when the cloud names one. */
  readonly id?: string;

  /**
   * What the speech or AI backend said about the input, with `backend_rejected` (422); for SSML,
   * `{ code, message, position }`, e.g. `{ code: 'UNSUPPORTED_TAG', message: 'Unsupported element: emphasis', position: 13 }`.
   */
  readonly detail?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    retryAfter?: number,
    id?: string,
    detail?: Record<string, unknown>,
  ) {
    super(`dTelecom Cloud: ${status} ${code}`);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.id = id;
    this.detail = detail;
  }
}

/** Media to upload: a `Blob`, or bytes such as a Node `Buffer`. */
export type MediaInput = Blob | Uint8Array;

export function toBlob(media: MediaInput): Blob {
  // A view over a SharedArrayBuffer is typed out of BlobPart, but Blob copies the bytes either way.
  return media instanceof Uint8Array ? new Blob([media as unknown as ArrayBuffer]) : media;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = Record<string, any>;

/** Authenticated HTTP to the cloud's hosted API. JSON bodies are sent as JSON, FormData as multipart. */
export class CloudHttp {
  constructor(
    private readonly authorization: string,
    readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async json<T = Raw>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await this.response(method, path, body, headers);
    return JSON.parse(await res.text()) as T;
  }

  /** Sends a request and returns the response; throws `CloudApiError` unless it is 2xx. */
  async response(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const multipart = body instanceof FormData;
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        Authorization: this.authorization,
        ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw await apiError(res);
    return res;
  }
}

async function apiError(res: Response): Promise<CloudApiError> {
  let code = `http_${res.status}`;
  let id: string | undefined;
  let detail: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(await res.text());
    if (parsed && typeof parsed.error === 'string') code = parsed.error;
    if (parsed && typeof parsed.id === 'string') id = parsed.id;
    if (
      parsed &&
      parsed.detail &&
      typeof parsed.detail === 'object' &&
      !Array.isArray(parsed.detail)
    ) {
      detail = parsed.detail;
    }
  } catch {
    // not JSON: keep the status code
  }
  const retryAfter = Number(res.headers.get('Retry-After'));
  return new CloudApiError(
    res.status,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    id,
    detail,
  );
}

const fileKeyPattern = /^[\x21-\x7e]{1,128}$/;
const inferenceKeyPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** Checks an Idempotency-Key before sending: file jobs take printable ASCII, requests a narrower set. */
export function checkIdempotencyKey(key: string, kind: 'file' | 'inference'): void {
  const pattern = kind === 'file' ? fileKeyPattern : inferenceKeyPattern;
  if (typeof key !== 'string' || !pattern.test(key)) {
    throw new Error(
      kind === 'file'
        ? 'dTelecom Cloud: idempotencyKey must be 1-128 printable ASCII characters'
        : 'dTelecom Cloud: idempotencyKey must be 1-128 letters, digits, underscores or hyphens',
    );
  }
}

/** Converts snake_case keys to camelCase, recursively. Values are kept. */
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((item) => camelize(item)) as unknown as T;
  if (value === null || typeof value !== 'object') return value as T;
  const out: Raw = {};
  Object.entries(value as Raw).forEach(([key, item]) => {
    out[key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = camelize(item);
  });
  return out as T;
}

export function segment(id: string): string {
  if (typeof id !== 'string' || id === '') throw new Error('dTelecom Cloud: an id is required');
  return encodeURIComponent(id);
}
