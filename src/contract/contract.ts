import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import bs58 from 'bs58';

const DISCRIMINATOR_LENGTH = 8;
const PUBLIC_KEY_LENGTH = 32;
const DOMAIN_LENGTH_SIZE = 4;
const ONLINE_STATUS_SIZE = 4;
const ACTIVE_STATUS_SIZE = 1;
const NODE_ENTRY_SIZE = DISCRIMINATOR_LENGTH + PUBLIC_KEY_LENGTH * 2 + DOMAIN_LENGTH_SIZE + 253 + ONLINE_STATUS_SIZE + ACTIVE_STATUS_SIZE;

interface NodeEntry {
  parent: PublicKey;
  registered: PublicKey;
  domain: string;
  online: number;
  active: boolean;
}

export interface IAllNodeResponseItem {
  domain: string;
  key: string;
}

interface ProgramAccount {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
}

interface RegistryConfig {
  contractAddress: string;
  networkHost: string;
  registryAuthority: string;
}

class RegistryClient {
  private connection: Connection;
  private programId: PublicKey;
  private registryAuthority: PublicKey;

  constructor(config?: RegistryConfig) {
    const contractAddress = config?.contractAddress || process.env.SOLANA_CONTRACT_ADDRESS;
    const networkHost = config?.networkHost || process.env.SOLANA_NETWORK_HOST_HTTP;
    const registryAuthority = config?.registryAuthority || process.env.SOLANA_REGISTRY_AUTHORITY;

    if (!contractAddress || !networkHost || !registryAuthority) {
      throw new Error('Missing required configuration. Required: contractAddress, networkHost, registryAuthority');
    }

    this.connection = new Connection(networkHost);
    this.programId = new PublicKey(contractAddress);
    this.registryAuthority = new PublicKey(registryAuthority);
  }

  private async findRegistryPDA(authority: PublicKey, name: string): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddress(
      [authority.toBytes(), Buffer.from(name)],
      this.programId
    );
  }

  private async findRegistryEntryPDA(accountToAdd: PublicKey, registry: PublicKey): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddress(
      [accountToAdd.toBytes(), registry.toBytes()],
      this.programId
    );
  }

  private parseNodeEntry(data: Buffer): NodeEntry {
    // Skip discriminator
    let offset = DISCRIMINATOR_LENGTH;

    // Read parent public key
    const parent = new PublicKey(data.slice(offset, offset + PUBLIC_KEY_LENGTH));
    offset += PUBLIC_KEY_LENGTH;

    // Read registered public key
    const registered = new PublicKey(data.slice(offset, offset + PUBLIC_KEY_LENGTH));
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
      active
    };
  }

  async listNodes(): Promise<NodeEntry[]> {
    const [registryPDA] = await this.findRegistryPDA(this.registryAuthority, 'nodes');

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        {
          memcmp: {
            offset: DISCRIMINATOR_LENGTH,
            bytes: registryPDA.toBase58()
          }
        },
        {
          dataSize: NODE_ENTRY_SIZE
        }
      ]
    });

    return accounts.map((account: ProgramAccount) => this.parseNodeEntry(account.account.data));
  }

  async getNodeByAddress(address: string): Promise<NodeEntry | null> {
    const [registryPDA] = await this.findRegistryPDA(this.registryAuthority, 'nodes');
    const accountToCheck = new PublicKey(address);
    const [entryPDA] = await this.findRegistryEntryPDA(accountToCheck, registryPDA);

    const accountInfo = await this.connection.getAccountInfo(entryPDA);
    if (!accountInfo || accountInfo.data.length === 0) {
      return null;
    }

    return this.parseNodeEntry(accountInfo.data);
  }
}

let registryClient: RegistryClient | null = null;

function getRegistryClient(config?: RegistryConfig): RegistryClient {
  if (!registryClient) {
    registryClient = new RegistryClient(config);
  }
  return registryClient;
}

export const formatNode = async (node: NodeEntry): Promise<IAllNodeResponseItem> => {
  return {
    domain: node.domain,
    key: node.registered.toBase58()
  };
};

export const getAllNode = async (config?: RegistryConfig): Promise<IAllNodeResponseItem[]> => {
  try {
    const client = getRegistryClient(config);
    const nodes = await client.listNodes();
    return Promise.all(nodes.map(formatNode));
  } catch (error) {
    console.error('Error getting all nodes:', error);
    return [];
  }
};

export const getNodeByAddress = async (address: string, config?: RegistryConfig): Promise<IAllNodeResponseItem> => {
  try {
    const client = getRegistryClient(config);
    const node = await client.getNodeByAddress(address);
    if (!node) {
      throw new Error('Node not found');
    }
    return formatNode(node);
  } catch (error) {
    console.error('Error getting node by address:', error);
    throw error;
  }
};