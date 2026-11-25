import { address, getAddressCodec, getProgramDerivedAddress } from '@solana/addresses';
import type { Address } from '@solana/addresses';
import { createSolanaRpc } from '@solana/rpc';
import type { Base58EncodedBytes } from '@solana/rpc-types';

const DEFAULT_CONTRACT_ADDRESS = 'E2FcHsC9STeB6FEtxBKGAwMTX7cbfYMyjSHKs4QbBAmh';
const DEFAULT_NETWORK_HOST = 'https://api.mainnet-beta.solana.com';
const DEFAULT_REGISTRY_AUTHORITY = '6KVRs6Yr2oYzddepFdtWrFmVq8sgELcXzbUy7apwuQX4';

const DISCRIMINATOR_LENGTH = 8;
const PUBLIC_KEY_LENGTH = 32;
const DOMAIN_LENGTH_SIZE = 4;
const ONLINE_STATUS_SIZE = 4;
const ACTIVE_STATUS_SIZE = 1;
const NODE_ENTRY_SIZE =
  DISCRIMINATOR_LENGTH +
  PUBLIC_KEY_LENGTH * 2 +
  DOMAIN_LENGTH_SIZE +
  253 +
  ONLINE_STATUS_SIZE +
  ACTIVE_STATUS_SIZE;

interface NodeEntry<Key = Address> {
  parent: Key;
  registered: Key;
  domain: string;
  online: number;
  active: boolean;
}

export interface RegistryConfig {
  contractAddress?: string;
  networkHost?: string;
  registryAuthority?: string;
}

export interface IAllNodeResponseItem {
  domain: string;
  key: string;
}

const addressCodec = getAddressCodec();

class RegistryClient {
  private readonly connection: ReturnType<typeof createSolanaRpc>;

  private readonly programId: Address;

  private readonly registryAuthority: Address;

  constructor(config?: RegistryConfig) {
    const contractAddress =
      config?.contractAddress || process.env.SOLANA_CONTRACT_ADDRESS || DEFAULT_CONTRACT_ADDRESS;
    const networkHost =
      config?.networkHost || process.env.SOLANA_NETWORK_HOST_HTTP || DEFAULT_NETWORK_HOST;
    const registryAuthority =
      config?.registryAuthority ||
      process.env.SOLANA_REGISTRY_AUTHORITY ||
      DEFAULT_REGISTRY_AUTHORITY;

    this.connection = createSolanaRpc(networkHost);
    this.programId = address(contractAddress);
    this.registryAuthority = address(registryAuthority);
  }

  private findRegistryPDA() {
    return getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [addressCodec.encode(this.registryAuthority), 'dtel-nodes'],
    });
  }

  private parseNodeEntry(data: Buffer): NodeEntry {
    // Skip discriminator
    let offset = DISCRIMINATOR_LENGTH;

    // Read parent public key
    const parent = addressCodec.decode(data.subarray(offset, offset + PUBLIC_KEY_LENGTH));
    offset += PUBLIC_KEY_LENGTH;

    // Read registered public key
    const registered = addressCodec.decode(data.subarray(offset, offset + PUBLIC_KEY_LENGTH));
    offset += PUBLIC_KEY_LENGTH;

    // Read domain length
    const domainLength = data.readUInt32LE(offset);
    offset += DOMAIN_LENGTH_SIZE;

    // Read domain
    const domain = data.slice(offset, offset + domainLength).toString();
    offset += domainLength;

    // Read online status
    const online = data.readInt32LE(offset);
    offset += ONLINE_STATUS_SIZE;

    // Read active status
    const active = data[offset] === 1;

    return {
      parent,
      registered,
      domain,
      online,
      active,
    };
  }

  async listNodes(): Promise<NodeEntry[]> {
    const [registryPDA] = await this.findRegistryPDA();
    const accounts = await this.connection
      .getProgramAccounts(this.programId, {
        commitment: 'finalized',
        encoding: 'base64',
        filters: [
          {
            memcmp: {
              offset: BigInt(DISCRIMINATOR_LENGTH),
              bytes: registryPDA.toString() as Base58EncodedBytes,
              encoding: 'base58',
            },
          },
          { dataSize: BigInt(NODE_ENTRY_SIZE) },
        ],
      })
      .send();

    return accounts.map(({ account }) =>
      this.parseNodeEntry(Buffer.from(account.data[0], 'base64')),
    );
  }

  async getNodeByAddress(nodeAddress: string): Promise<NodeEntry | null> {
    const [registryPDA] = await this.findRegistryPDA();
    const [entryPDA] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [addressCodec.encode(address(nodeAddress)), addressCodec.encode(registryPDA)],
    });
    const { value } = await this.connection
      .getAccountInfo(entryPDA, { commitment: 'finalized', encoding: 'base64' })
      .send();
    if (!value || !value.data[0]) {
      return null;
    }
    return this.parseNodeEntry(Buffer.from(value.data[0], 'base64'));
  }
}

let registryClient: RegistryClient | null = null;

function getRegistryClient(config?: RegistryConfig): RegistryClient {
  if (!registryClient) {
    registryClient = new RegistryClient(config);
  }
  return registryClient;
}

// Existing callers may pass a web3.js PublicKey.
export const formatNode = async (
  node: NodeEntry<Address | { toBase58(): string }>,
): Promise<IAllNodeResponseItem> => ({
  domain: node.domain,
  key: typeof node.registered === 'string' ? node.registered : node.registered.toBase58(),
});

export const getAllNode = async (config?: RegistryConfig): Promise<IAllNodeResponseItem[]> => {
  const authority =
    config?.registryAuthority ||
    process.env.SOLANA_REGISTRY_AUTHORITY ||
    DEFAULT_REGISTRY_AUTHORITY;
  if (authority === '6KVRs6Yr2oYzddepFdtWrFmVq8sgELcXzbUy7apwuQX4') {
    return [
      { domain: '1097678512.dtel.network', key: '56EfQS7to175rMGiZ3kSYpT3xp5sK6SXVx4VhAbw7PcP' },
      { domain: '3630803282.dtel.network', key: '7spwAJL7TLpBRV3ZYHNCd2R8RLwEZteyeAuqN7DWs3dZ' },
      { domain: '1080957690.dtel.network', key: 'EtPNdLSf2QbNESa2gkJQikpdNwdDA1Qft2qaNqwUoE4e' },
      { domain: '3115567758.dtel.network', key: 'E21pjHeVJLWLQSBANrE4GXSPvh7ZUpgbMjGBgNDFLbdz' },
      { domain: '533500229.dtel.network', key: 'DSerT5fmaw1GQFS2xJcYjTb1kJudKUcezEqGCfueiPfZ' },
      { domain: '3585329288.dtel.network', key: '2TWwNKMi2vtNpRVVySS8nVW2JKUhmcVgD4bKYAFaR5Zo' },
      { domain: '2639923154.dtel.network', key: 'wTXA7UUP8sJFmbXi2jTC8wXQsf7AUEJNuYVeNCR7d1d' },
    ];
  }

  if (authority === '8bxabQhCLRfpHZQjAXg9AmqqyQ2WJrXQVAQXH3YFzxwT') {
    return [
      { domain: '581250763.dtel.network', key: 'CiKDiqBjHs9jTaJANgreQkVgA6J4YhVbYx55tU7swKfk' },
      { domain: '600666983.dtel.network', key: '644PeDtMTPE1WFSaTC8BSjaNUN697frNRifciWSqiAZz' },
      { domain: '581956361.dtel.network', key: '5g3euBKXqhdbfzkgbWQ7o1C6HQzbyr1noX6wiqfv2i3x' },
    ];
  }

  try {
    const client = getRegistryClient(config);
    const nodes = await client.listNodes();
    return await Promise.all(nodes.map(formatNode));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error getting all nodes:', error);
    return [];
  }
};

export const getNodeByAddress = async (
  nodeAddress: string,
  config?: RegistryConfig,
): Promise<IAllNodeResponseItem> => {
  try {
    const client = getRegistryClient(config);
    const node = await client.getNodeByAddress(nodeAddress);
    if (!node) {
      throw new Error('Node not found');
    }
    return await formatNode(node);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error getting node by address:', error);
    throw error;
  }
};
