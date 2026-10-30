import { ethers } from "hardhat";
import { registrySuite } from "./flow";

// Local run: deploys Safe sources from contracts/safe-smart-account (v1.5.0).
describe("TxProposalRegistry (local, Safe v1.5.0 from source)", () => {
  registrySuite(async () => {
    const singleton = await (await ethers.deployContract("Safe")).getAddress();
    const factory = await (await ethers.deployContract("SafeProxyFactory")).getAddress();
    const handler = await (await ethers.deployContract("CompatibilityFallbackHandler")).getAddress();
    return { singleton, factory, handler };
  });
});
