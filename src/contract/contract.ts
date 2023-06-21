import Web3 from "web3"
// @ts-ignore
import ipInt from "ip-to-int"
import geoIp from "fast-geoip"
import ABI from "./ABI"

const WEB3_GAS_LIMIT = Number(process.env.WEB3_GAS_LIMIT) || 3000000
const WEB3_GAS_PRICE = process.env.WEB3_GAS_PRICE || "4000000000"

const provider = new Web3.providers.HttpProvider(process.env.WEB3_PROVIDER!)
const web3 = new Web3(provider)

const contract = new web3.eth.Contract(ABI, process.env.CONTRACT_ADDRESS, {
  gas: WEB3_GAS_LIMIT,
  gasPrice: WEB3_GAS_PRICE,
})

interface IAllNodeResponseItem {
  ip: string
  active: boolean
}

export interface IFormattedNodeItem extends IAllNodeResponseItem {
  formattedIp: string
  lat?: number
  long?: number
}

const formatNode = async (node: IAllNodeResponseItem): Promise<IFormattedNodeItem> => {
  const formattedIp = ipInt(node.ip).toIP()
  const location = await geoIp.lookup(formattedIp)

  return {
    ...location,
    ...node,
    formattedIp,
    lat: location?.ll[0],
    long: location?.ll[1]
  }
}

export const getAllNode = async (): Promise<IFormattedNodeItem[]> => Promise.all(contract.methods
      .getAllNode()
      .call()
      .then((result: IAllNodeResponseItem[]) => result.map(formatNode)))
