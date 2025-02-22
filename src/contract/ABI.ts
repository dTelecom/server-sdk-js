export interface AbiItem {
  anonymous?: boolean;
  constant?: boolean;
  inputs?: Array<{
    name: string;
    type: string;
    internalType?: string;
    indexed?: boolean;
    components?: Array<{
      name: string;
      type: string;
      internalType?: string;
    }>;
  }>;
  name?: string;
  outputs?: Array<{
    name: string;
    type: string;
    internalType?: string;
    components?: Array<{
      name: string;
      type: string;
      internalType?: string;
    }>;
  }>;
  payable?: boolean;
  stateMutability?: string;
  type: string;
}

export const ABI: AbiItem[] = [
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "ip",
        "type": "string"
      }
    ],
    "name": "addNode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllNode",
    "outputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "ip",
            "type": "string"
          }
        ],
        "internalType": "struct NodeContract.Node[]",
        "name": "",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      }
    ],
    "name": "removeNode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];
