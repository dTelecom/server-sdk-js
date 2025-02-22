import axios from 'axios';

export interface IFormattedNodeItem {
  name: string;
  ip: string;
}

export async function getAllNode(): Promise<IFormattedNodeItem[]> {
  // This is a placeholder implementation. In a real application, you would:
  // 1. Either use a different blockchain API
  // 2. Or implement your own node discovery mechanism
  // 3. Or use a centralized service
  // For now, we'll return a hardcoded list of nodes
  return [
    {
      name: "node1",
      ip: "node1.dtel.network"
    },
    {
      name: "node2",
      ip: "node2.dtel.network"
    }
  ];
}
