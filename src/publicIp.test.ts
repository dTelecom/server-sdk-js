import { isPrivateIp, _resetPublicIpCache } from './publicIp';

// We need to mock dgram at the module level since its exports are non-configurable
const mockSocket = {
  on: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
};

jest.mock('dgram', () => ({
  createSocket: jest.fn(() => mockSocket),
}));

// Import after mock setup
import dgram from 'dgram';
import { resolvePublicIp } from './publicIp';

/**
 * Build a STUN Binding Success Response with XOR-MAPPED-ADDRESS
 */
function buildStunResponse(ipBytes: number[]): Buffer {
  const xorIp =
    ((ipBytes[0] << 24) | (ipBytes[1] << 16) | (ipBytes[2] << 8) | ipBytes[3]) ^ 0x2112a442;

  const response = Buffer.alloc(32);
  response.writeUInt16BE(0x0101, 0);       // Binding Success Response
  response.writeUInt16BE(12, 2);           // Message length
  response.writeUInt32BE(0x2112a442, 4);   // Magic cookie
  // Transaction ID (12 bytes at offset 8) — zero is fine for tests
  response.writeUInt16BE(0x0020, 20);      // XOR-MAPPED-ADDRESS type
  response.writeUInt16BE(8, 22);           // Attribute length
  response.writeUInt8(0x00, 24);           // Reserved
  response.writeUInt8(0x01, 25);           // Family: IPv4
  response.writeUInt16BE(0, 26);           // XOR port (unused)
  response.writeInt32BE(xorIp, 28);        // XOR address
  return response;
}

describe('isPrivateIp', () => {
  it('detects loopback addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('127.255.255.255')).toBe(true);
  });

  it('detects 10.x.x.x private range', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('10.255.255.255')).toBe(true);
  });

  it('detects 172.16-31.x.x private range', () => {
    expect(isPrivateIp('172.16.0.1')).toBe(true);
    expect(isPrivateIp('172.31.255.255')).toBe(true);
    expect(isPrivateIp('172.15.0.1')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
  });

  it('detects 192.168.x.x private range', () => {
    expect(isPrivateIp('192.168.0.1')).toBe(true);
    expect(isPrivateIp('192.168.255.255')).toBe(true);
  });

  it('detects link-local addresses', () => {
    expect(isPrivateIp('169.254.0.1')).toBe(true);
    expect(isPrivateIp('169.254.255.255')).toBe(true);
  });

  it('detects 0.0.0.0', () => {
    expect(isPrivateIp('0.0.0.0')).toBe(true);
  });

  it('detects IPv6 loopback and private', () => {
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('fd00::1')).toBe(true);
    expect(isPrivateIp('fe80::1')).toBe(true);
  });

  it('returns true for invalid IPs', () => {
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  it('returns false for public IPs', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('203.45.67.89')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('52.84.100.200')).toBe(false);
  });
});

describe('resolvePublicIp', () => {
  beforeEach(() => {
    _resetPublicIpCache();
    jest.clearAllMocks();

    // Default mock behavior: simulate successful STUN response
    mockSocket.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'message') {
        const response = buildStunResponse([203, 0, 113, 1]);
        setTimeout(() => cb(response), 10);
      }
      return mockSocket;
    });
    mockSocket.send.mockImplementation(
      (_msg: Buffer, _port: number, _host: string, cb: Function) => cb(null),
    );
  });

  it('returns an IP address from STUN server', async () => {
    const result = await resolvePublicIp();
    expect(result).toBe('203.0.113.1');
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
  });

  it('caches the result across calls', async () => {
    const result1 = await resolvePublicIp();
    const result2 = await resolvePublicIp();
    expect(result1).toBe(result2);
    // createSocket should only be called once due to caching
    expect(dgram.createSocket).toHaveBeenCalledTimes(1);
  });

  it('returns null when all STUN servers fail', async () => {
    // Override: send fails immediately
    mockSocket.on.mockImplementation(() => mockSocket);
    mockSocket.send.mockImplementation(
      (_msg: Buffer, _port: number, _host: string, cb: Function) => {
        cb(new Error('send failed'));
      },
    );

    const result = await resolvePublicIp();
    expect(result).toBeNull();
  });
});
