import Web3 from "web3"
// @ts-ignore
import ipInt from "ip-to-int"
import ABI from "./ABI"

const WEB3_GAS_LIMIT = Number(process.env.WEB3_GAS_LIMIT) || 30000000

const provider = new Web3.providers.HttpProvider(process.env.WEB3_PROVIDER!)
const web3 = new Web3(provider)

const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS, {
  gas: WEB3_GAS_LIMIT,
})

interface IAllNodeResponseItem {
  ip: string
  active: boolean
  key: string
}

export interface IFormattedNodeItem extends IAllNodeResponseItem {
  formattedIp: string
}

const formatNode = async (node: IAllNodeResponseItem): Promise<IFormattedNodeItem> => {
  const formattedIp = ipInt(node.ip).toIP()

  return {
    ...node,
    formattedIp,
  }
}

export const getAllNode = async (): Promise<IFormattedNodeItem[]> => {
  const tx = await contract.methods.getAllNode()
  const gas = await estimateGas(tx)
  const nodes = await tx.call({gas})

  return Promise.all(nodes.map(formatNode))
}

export const getNodeByAddress = async (address: string): Promise<IFormattedNodeItem> => {
  const tx = await contract.methods.nodeByAddress(address)
  const gas = await estimateGas(tx)
  const node = await tx.call({gas})

  return formatNode(node)
}

const estimateGas = async (tx: any) => (await tx.estimateGas()) + 500000
