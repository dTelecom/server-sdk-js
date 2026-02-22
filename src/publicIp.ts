import dgram from 'dgram';
import crypto from 'crypto';

const STUN_SERVERS = [
  { host: 'stun.l.google.com', port: 19302 },
  { host: 'stun.cloudflare.com', port: 3478 },
];

const STUN_TIMEOUT_MS = 3000;

// RFC 5389 constants
const STUN_BINDING_REQUEST = 0x0001;
const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const STUN_ATTR_MAPPED_ADDRESS = 0x0001;

/**
 * Returns true if the IP is a private/localhost/link-local address
 * that cannot be geolocated by an external service.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv6 loopback and private
  if (ip === '::1' || ip.startsWith('fd') || ip.startsWith('fe80:')) {
    return true;
  }

  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) {
    // Not a valid IPv4 — treat as private to be safe
    return true;
  }

  const [a, b] = parts;
  return (
    a === 127 ||                           // 127.0.0.0/8  loopback
    a === 10 ||                            // 10.0.0.0/8   private
    (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12 private
    (a === 192 && b === 168) ||            // 192.168.0.0/16 private
    (a === 169 && b === 254) ||            // 169.254.0.0/16 link-local
    (a === 0 && b === 0 && parts[2] === 0 && parts[3] === 0) // 0.0.0.0
  );
}

/**
 * Build a 20-byte STUN Binding Request per RFC 5389.
 */
function buildStunRequest(): Buffer {
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(STUN_BINDING_REQUEST, 0); // Message type
  buf.writeUInt16BE(0, 2);                     // Message length (no attributes)
  buf.writeUInt32BE(STUN_MAGIC_COOKIE, 4);     // Magic cookie
  crypto.randomBytes(12).copy(buf, 8);         // Transaction ID
  return buf;
}

/**
 * Parse the XOR-MAPPED-ADDRESS or MAPPED-ADDRESS from a STUN response.
 * Returns the IPv4 address as a dotted string, or null.
 */
function parseStunResponse(data: Buffer): string | null {
  if (data.length < 20) return null;

  // Verify it's a STUN success response (0x0101)
  const msgType = data.readUInt16BE(0);
  if (msgType !== 0x0101) return null;

  const msgLen = data.readUInt16BE(2);
  let offset = 20;
  const end = 20 + msgLen;

  while (offset + 4 <= end) {
    const attrType = data.readUInt16BE(offset);
    const attrLen = data.readUInt16BE(offset + 2);
    const attrStart = offset + 4;

    if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS && attrLen >= 8) {
      const family = data.readUInt8(attrStart + 1);
      if (family === 0x01) {
        // IPv4: XOR port and address with magic cookie
        const xorAddr = data.readUInt32BE(attrStart + 4);
        const addr = xorAddr ^ STUN_MAGIC_COOKIE;
        return [
          (addr >>> 24) & 0xff,
          (addr >>> 16) & 0xff,
          (addr >>> 8) & 0xff,
          addr & 0xff,
        ].join('.');
      }
    }

    if (attrType === STUN_ATTR_MAPPED_ADDRESS && attrLen >= 8) {
      const family = data.readUInt8(attrStart + 1);
      if (family === 0x01) {
        return [
          data.readUInt8(attrStart + 4),
          data.readUInt8(attrStart + 5),
          data.readUInt8(attrStart + 6),
          data.readUInt8(attrStart + 7),
        ].join('.');
      }
    }

    // Attributes are padded to 4-byte boundaries
    offset = attrStart + Math.ceil(attrLen / 4) * 4;
  }

  return null;
}

/**
 * Send a STUN Binding Request to a single server and resolve the public IP.
 */
function stunQuery(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const request = buildStunRequest();
    let done = false;

    const finish = (result: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), STUN_TIMEOUT_MS);

    socket.on('message', (msg) => {
      const ip = parseStunResponse(msg);
      finish(ip);
    });

    socket.on('error', () => finish(null));

    socket.send(request, port, host, (err) => {
      if (err) finish(null);
    });
  });
}

// Module-level cached promise (singleton)
let cachedPromise: Promise<string | null> | null = null;

/**
 * Discovers this server's public IP via STUN protocol.
 * Result is cached — subsequent calls return the same promise.
 * Returns null if all STUN servers are unreachable.
 */
export function resolvePublicIp(): Promise<string | null> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    for (const server of STUN_SERVERS) {
      const ip = await stunQuery(server.host, server.port);
      if (ip) return ip;
    }
    return null;
  })();

  return cachedPromise;
}

/**
 * Reset the cached public IP. For testing only.
 */
export function _resetPublicIpCache(): void {
  cachedPromise = null;
}
