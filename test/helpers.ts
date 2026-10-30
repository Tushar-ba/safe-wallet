import { ethers } from "hardhat";
import { Contract, Signer, getAddress, zeroPadValue, ZeroAddress, ZeroHash, solidityPacked } from "ethers";

export const SAFE_ABI = [
  "function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function isOwner(address) view returns (bool)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function approvedHashes(address,bytes32) view returns (uint256)",
  "function approveHash(bytes32)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
  "event ExecutionSuccess(bytes32 txHash,uint256 payment)",
  "event ExecutionFailure(bytes32 txHash,uint256 payment)",
];

export const FACTORY_ABI = [
  "function createProxyWithNonce(address _singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy,address singleton)",
];

/** 65 bytes per approver: bytes32(owner) + bytes32(0) + 0x01, sorted by owner address ascending. */
export function approvedHashSignatures(owners: string[]): string {
  const sorted = [...owners].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  return (
    "0x" +
    sorted.map((o) => zeroPadValue(getAddress(o), 32).slice(2) + ZeroHash.slice(2) + "01").join("")
  );
}

export async function createSafe(
  factoryAddr: string,
  singletonAddr: string,
  handlerAddr: string,
  owners: string[],
  threshold: number,
  signer: Signer,
  saltNonce = BigInt(Date.now()),
) {
  const safeIface = new ethers.Interface(SAFE_ABI);
  const initializer = safeIface.encodeFunctionData("setup", [
    owners, threshold, ZeroAddress, "0x", handlerAddr, ZeroAddress, 0, ZeroAddress,
  ]);
  const factory = new Contract(factoryAddr, FACTORY_ABI, signer);
  const receipt = await (await factory.createProxyWithNonce(singletonAddr, initializer, saltNonce)).wait();
  const log = receipt.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "ProxyCreation");
  return new Contract(log.args.proxy, SAFE_ABI, signer);
}

export { solidityPacked };
