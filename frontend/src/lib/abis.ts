import { parseAbi } from 'viem'

/** Minimal Safe v1.4.1 ABI (reads, approveHash, execTransaction, setup, events). */
export const safeAbi = parseAbi([
  'function VERSION() view returns (string)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function approveHash(bytes32 hashToApprove)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)',
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'event ApproveHash(bytes32 indexed approvedHash, address indexed owner)',
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
  'event SafeSetup(address indexed initiator, address[] owners, uint256 threshold, address initializer, address fallbackHandler)',
])

export const safeProxyFactoryAbi = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
])

export const txProposalRegistryAbi = parseAbi([
  'event Proposed(address indexed safe, bytes32 indexed safeTxHash, address indexed proposer, address to, uint256 value, bytes data, uint256 nonce)',
  'function propose(address safe, address to, uint256 value, bytes data, uint256 nonce) returns (bytes32)',
  'error NotSafeOwner()',
])

// aggregate3 is payable on-chain; declared view here so it can be used with eth_call (readContract).
export const multicall3Abi = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
])
