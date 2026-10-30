import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, ZeroAddress } from "ethers";
import { SAFE_ABI, approvedHashSignatures, createSafe } from "./helpers";

/** Shared suite: registry behaviour + full 2-of-3 propose/approve/execute against given Safe contract addresses. */
export function registrySuite(getAddrs: () => Promise<{ singleton: string; factory: string; handler: string }>) {
  let registry: Contract;
  let safe: Contract;
  let owners: any[];
  let outsider: any;
  let recipient: string;

  before(async () => {
    const signers = await ethers.getSigners();
    owners = signers.slice(0, 3);
    outsider = signers[3];
    recipient = signers[4].address;
    const { singleton, factory, handler } = await getAddrs();
    registry = (await (await ethers.getContractFactory("TxProposalRegistry")).deploy()) as unknown as Contract;
    safe = await createSafe(factory, singleton, handler, owners.map((o) => o.address), 2, owners[0]);
    await owners[0].sendTransaction({ to: await safe.getAddress(), value: ethers.parseEther("1") });
  });

  it("owner can propose and emitted hash == Safe.getTransactionHash", async () => {
    const safeAddr = await safe.getAddress();
    const nonce = await safe.nonce();
    const expected = await safe.getTransactionHash(recipient, 5n, "0x", 0, 0, 0, 0, ZeroAddress, ZeroAddress, nonce);
    const tx = await registry.connect(owners[1]).getFunction("propose")(safeAddr, recipient, 5n, "0x", nonce);
    const receipt = await tx.wait();
    const ev = registry.interface.parseLog(receipt.logs[0])!;
    expect(ev.name).to.equal("Proposed");
    expect(ev.args.safe).to.equal(safeAddr);
    expect(ev.args.safeTxHash).to.equal(expected);
    expect(ev.args.proposer).to.equal(owners[1].address);
    expect(ev.args.to).to.equal(recipient);
    expect(ev.args.value).to.equal(5n);
    expect(ev.args.nonce).to.equal(nonce);
  });

  it("non-owner reverts", async () => {
    await expect(
      registry.connect(outsider).getFunction("propose")(await safe.getAddress(), recipient, 1n, "0x", 0n),
    ).to.be.revertedWithCustomError(registry, "NotSafeOwner");
  });

  it("e2e 2-of-3: propose, approveHash x2, execTransaction with approved-hash signatures", async () => {
    const safeAddr = await safe.getAddress();
    const nonce = await safe.nonce();
    const value = ethers.parseEther("0.1");
    const hash = await safe.getTransactionHash(recipient, value, "0x", 0, 0, 0, 0, ZeroAddress, ZeroAddress, nonce);
    await (await registry.connect(owners[0]).getFunction("propose")(safeAddr, recipient, value, "0x", nonce)).wait();

    await (await safe.connect(owners[0]).getFunction("approveHash")(hash)).wait();
    expect(await safe.approvedHashes(owners[0].address, hash)).to.equal(1n);

    // executing with only 1 approval must fail (GS020: signatures too short)
    await expect(
      safe.connect(outsider).getFunction("execTransaction")(
        recipient, value, "0x", 0, 0, 0, 0, ZeroAddress, ZeroAddress, approvedHashSignatures([owners[0].address]),
      ),
    ).to.be.revertedWith("GS020");

    await (await safe.connect(owners[2]).getFunction("approveHash")(hash)).wait();

    const before = await ethers.provider.getBalance(recipient);
    const sigs = approvedHashSignatures([owners[0].address, owners[2].address]);
    // executor is a non-owner: shows approvals alone are sufficient
    await expect(
      safe.connect(outsider).getFunction("execTransaction")(recipient, value, "0x", 0, 0, 0, 0, ZeroAddress, ZeroAddress, sigs),
    ).to.emit(safe, "ExecutionSuccess");
    expect((await ethers.provider.getBalance(recipient)) - before).to.equal(value);
    expect(await safe.nonce()).to.equal(nonce + 1n);
  });
}

export { SAFE_ABI };
