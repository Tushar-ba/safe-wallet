Build a simple, backend-less multisig web app on Polygon Amoy (chainId 80002) on top of the Safe contracts in ./contracts/safe-smart-account (https://github.com/safe-fndn/safe-smart-account). The UX should feel like Safe{Wallet}'s multisig flow, trimmed down. Work in PHASES: stop after each, run the listed checks, show me the output, and wait for my go-ahead. Before using any third-party library (Reown AppKit, wagmi, viem, @safe-global/safe-deployments), check its CURRENT docs and versions instead of relying on memory.

## Scope: what we are NOT building
No backend, no database, no Safe Transaction Service, no relayer/gasless/paymaster, no ERC-4337/smart-account features, no Safe modules/guards, no spending limits, no off-chain signature sharing. Every user pays their own gas. Fixed assumptions for every Safe tx: operation=CALL (0) except for MultiSend not being used at all, safeTxGas=0, baseGas=0, gasPrice=0, gasToken=0, refundReceiver=0.

## Stack
React + TypeScript + Vite, Tailwind, wagmi + viem, TanStack Query, Reown AppKit (@reown/appkit + @reown/appkit-adapter-wagmi) for wallet connection with project id from VITE_REOWN_PROJECT_ID, network = polygonAmoy only. Never log or commit secrets; provide .env.example.

## RPC rules (important, keep RPC usage low)
- Default RPC = VITE_DEFAULT_RPC_URL. A Settings modal lets the user enter their own RPC: validate via eth_chainId (must be 80002), persist in localStorage, include "Reset to default".
- One shared viem public client built from the active RPC. Reads for a Safe (owners, threshold, nonce, balance, version) go in ONE multicall (Multicall3).
- LAZY LOADING: the Queue tab loads only pending items. History loads ONLY when the user clicks the History tab, and only once per session unless they hit "Refresh".
- No continuous polling. Fetch on page open, on manual Refresh, and after the user's own tx confirms (then invalidate the relevant queries). If a tab is open and visible, at most one slow refresh (~30s) of the Queue only.
- getLogs: always filter by indexed topics (safe address), chunk block ranges (public RPCs cap ranges), start from the registry's deployment block, and cache results plus last-scanned block per Safe in localStorage so we only scan new blocks.
- Retry with backoff on rate limits; show an "RPC problem, switch RPC" banner.

## PHASE 0: Recon (no code)
1. Read Safe.sol, SafeProxyFactory, CompatibilityFallbackHandler and the functions approveHash, approvedHashes, execTransaction, checkNSignatures, getTransactionHash, nonce, getOwners, getThreshold, isOwner, and the events ApproveHash, ExecutionSuccess, ExecutionFailure.
2. Check whether the official Safe singleton, proxy factory and fallback handler already exist on Amoy, using @safe-global/safe-deployments and eth_getCode. Report what exists and what's missing.
3. Write a short plan: folder layout, contracts to deploy, data flow. Wait for my approval.

## PHASE 1: Contracts and deployment
1. If canonical Safe contracts are missing on Amoy, write a deploy script for the Safe singleton, SafeProxyFactory and CompatibilityFallbackHandler. If they exist, reuse them and don't redeploy.
2. New minimal contract contracts/TxProposalRegistry.sol, events only, no storage:
   - propose(address safe, address to, uint256 value, bytes data, uint256 nonce): require ISafe(safe).isOwner(msg.sender); compute safeTxHash = ISafe(safe).getTransactionHash(to, value, data, 0, 0, 0, 0, address(0), address(0), nonce); emit Proposed(address indexed safe, bytes32 indexed safeTxHash, address indexed proposer, address to, uint256 value, bytes data, uint256 nonce).
   - Document the fixed gas parameters and that the UI dedupes by safeTxHash.
3. Tests: owner can propose; non-owner reverts; emitted hash == Safe.getTransactionHash; end-to-end 2-of-3 Safe created via the factory, proposed, approveHash by two owners, then execTransaction with approved-hash signatures succeeds.
4. Deploy script for Amoy reading DEPLOYER_PRIVATE_KEY and AMOY_RPC_URL; verify on Polygonscan. Write addresses and the registry deploy block to deployments/amoy.json and generate frontend/src/config/deployments.ts from it.
CHECKS: tests pass; dry-run on a fork. DO NOT broadcast to Amoy; I will do that.

## PHASE 2: Scaffold, wallet, RPC settings
1. frontend/ with the stack above. Connect/disconnect button via Reown AppKit, wrong-network banner with switch button, short address + copy.
2. Settings modal for custom RPC (rules above).
3. Routes: / (home), /safe/:address (dashboard with tabs Queue | History | New transaction | Owners).
CHECKS: tsc and vite build pass; list manual test steps for me.

## PHASE 3: Home and loading a Safe (no backend "my Safes")
1. Home has one main input: "Open a Safe: paste address". Validate checksum, verify it is a Safe (call VERSION() and getOwners() in one multicall) and reject non-Safes with a clear message.
2. Opened Safes are saved to a localStorage list (with an optional nickname) and shown as cards on Home, with a remove button. Because this is localStorage, show a small note that the list is per-browser.
3. If the connected wallet is an owner of the Safe, show an "Owner" badge; otherwise the Safe opens in read-only view mode (no action buttons).
4. Optional (only if simple): a "Create new Safe" form (owners + threshold) calling SafeProxyFactory.createProxyWithNonce with a Safe.setup initializer and the fallback handler, then saving the new address.
5. Safe header shows: address, nickname, native balance, "x of y" threshold, version, current nonce.

## PHASE 4: New transaction builder (any contract)
1. Input: target contract address, with an ABI source. Try the Etherscan v2 API (chainid=80002) using VITE_EXPLORER_API_KEY if set, and detect EIP-1967 proxies to offer the implementation ABI. Fallback: paste ABI JSON (validated).
2. Show all write functions as generated forms (address, uintN, bool, bytes, string, arrays, tuples). Payable functions get a value field. Read functions go in a separate "Read" tab, called live via the RPC.
3. Also supported: "Send native token" and raw calldata.
4. Show decoded preview (function + args) and the encoded calldata before submit.
5. "Create transaction" calls TxProposalRegistry.propose(...) with the Safe's current nonce by default (the user may choose a higher nonce, with a gap warning). Offer a clearly labeled follow-up step "Also confirm (approve) as proposer", which calls Safe.approveHash(safeTxHash) from the same wallet.

## PHASE 5: Queue (pending) with votes and signing
1. The Queue tab loads Proposed logs for this Safe (indexed filter, cached) and keeps only nonce >= current Safe nonce. Dedupe by safeTxHash; recompute the hash locally with viem and compare with the event's hash.
2. Safe{Wallet}-style list: grouped by nonce, each card shows the action summary (decoded function or "Send X POL to 0x..."), nonce, proposer, and an expandable detail with full calldata and decoded args. If several proposals share a nonce, show them as "conflicting, only one can execute".
3. Votes: for each pending proposal read approvedHashes(owner, safeTxHash) for every owner in ONE multicall. Show every owner with Confirmed ✅ or Not yet ⏳, a progress bar "2 of 3 required", and highlight "You haven't confirmed yet" for the connected owner.
4. Buttons (owners only, disabled/hidden otherwise):
   - Confirm → Safe.approveHash(safeTxHash). Disabled if this owner already approved.
   - Execute → enabled when approvals >= threshold AND nonce == current nonce. Build signatures as 65 bytes per approver: bytes32(owner padded) + bytes32(0) + 0x01, sorted by owner address ascending numerically. If the executor is an owner who has not approved, they may include their own entry. Run a simulation (simulateContract/estimateGas) first and show decoded GS0xx revert reasons in plain text.
   - Reject → propose a 0-value self-call (to = safe, data = 0x) at the same nonce, then confirm it. Label it clearly.
5. After every wallet action: wait for receipt, show Polygonscan link, then refetch only the affected queries.
6. The user can disconnect, connect a different owner wallet (or come back days later), and the same votes are shown because all state is on-chain.

## PHASE 6: History (strictly on-demand)
1. Nothing is fetched until the user clicks the History tab. Then fetch Safe's ExecutionSuccess / ExecutionFailure logs (indexed by txHash, filtered to this Safe address) plus matching Proposed logs, in chunks, using cached ranges.
2. Show executed/failed items newest first with status, nonce, decoded action, executor, and a Polygonscan link. Paginate client-side ("Load more" scans further back). Provide a "Refresh" button.
3. Executed transactions that were not proposed through our registry should still appear (with "details unavailable, executed outside this app" and the tx link).

## PHASE 7: Polish and docs
- Loading skeletons, empty states, mobile responsive, clear errors.
- Unit tests (vitest) for signature sorting/encoding, tx hash recomputation, ABI form encoding.
- README with setup, env vars, deploy steps, how voting works, and security notes (each vote costs gas, only app-proposed transactions appear in the queue, the explorer API key is public in the bundle).
- Write CLAUDE.md summarising architecture and commands.

## Acceptance criteria
- Paste a Safe address; the app shows owners, threshold, nonce and the pending queue only (no history calls yet).
- 2-of-3
