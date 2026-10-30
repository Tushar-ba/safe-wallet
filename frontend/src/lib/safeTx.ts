import {
  concat,
  encodeAbiParameters,
  hashTypedData,
  keccak256,
  parseAbiParameters,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { deployments } from '../config/deployments'

export interface SafeTxInput {
  to: Address
  value: bigint
  data: Hex
  nonce: bigint
}

export const SAFE_TX_TYPE_STRING =
  'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)'
/** keccak256(SAFE_TX_TYPE_STRING); equals SAFE_TX_TYPEHASH in Safe v1.4.1. */
export const SAFE_TX_TYPEHASH = keccak256(toBytes(SAFE_TX_TYPE_STRING))
export const DOMAIN_TYPE_STRING = 'EIP712Domain(uint256 chainId,address verifyingContract)'
export const DOMAIN_SEPARATOR_TYPEHASH = keccak256(toBytes(DOMAIN_TYPE_STRING))

export const safeTxTypes = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

/** Fixed params used by this app: operation=CALL, all gas params zero, no refund. */
export function safeTxMessage(tx: SafeTxInput) {
  return {
    to: tx.to,
    value: tx.value,
    data: tx.data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: tx.nonce,
  }
}

/** Same value Safe.getTransactionHash(to,value,data,0,0,0,0,0x0,0x0,nonce) returns. */
export function computeSafeTxHash(safe: Address, tx: SafeTxInput, chainId: number = deployments.chainId): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: safeTxTypes,
    primaryType: 'SafeTx',
    message: safeTxMessage(tx),
  })
}

/**
 * Independent re-implementation of Safe.getTransactionHash semantics:
 * keccak256(0x19 0x01 || domainSeparator || keccak256(abi.encode(SAFE_TX_TYPEHASH, ...))).
 * Used to cross-check computeSafeTxHash.
 */
export function computeSafeTxHashManual(safe: Address, tx: SafeTxInput, chainId: number = deployments.chainId): Hex {
  const domainSeparator = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32, uint256, address'), [
      DOMAIN_SEPARATOR_TYPEHASH,
      BigInt(chainId),
      safe,
    ]),
  )
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address, uint256, bytes32, uint8, uint256, uint256, uint256, address, address, uint256'),
      [SAFE_TX_TYPEHASH, tx.to, tx.value, keccak256(tx.data), 0, 0n, 0n, 0n, zeroAddress, zeroAddress, tx.nonce],
    ),
  )
  return keccak256(concat(['0x19', '0x01', domainSeparator, structHash]))
}
