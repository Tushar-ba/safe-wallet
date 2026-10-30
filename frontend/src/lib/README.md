# src/lib reference

All code is typed; `Address`/`Hex`/`PublicClient` are from `viem`. Tests live next to the files (`*.test.ts`).

## abis.ts
`safeAbi`, `safeProxyFactoryAbi`, `txProposalRegistryAbi`, `multicall3Abi` (parseAbi, const-typed).
- Safe: VERSION, getOwners, getThreshold, nonce, isOwner, approvedHashes(owner,hash), domainSeparator, getTransactionHash, approveHash, execTransaction, setup; events ApproveHash, ExecutionSuccess, ExecutionFailure, SafeSetup.
- Factory: `createProxyWithNonce(_singleton, initializer, saltNonce)`, event ProxyCreation(proxy, singleton).
- Registry: event `Proposed(safe, safeTxHash, proposer, to, value, data, nonce)` (safe/safeTxHash/proposer indexed), `propose(safe,to,value,data,nonce) returns (bytes32)`, error `NotSafeOwner()`.
- Multicall3: `aggregate3(Call3[])` (declared `view` so `readContract` works), `getEthBalance(addr)`.

## config/deployments.ts
`deployments = { chainId, safeSingleton, proxyFactory, fallbackHandler, multicall3, txProposalRegistry, registryDeployBlock }`.
`txProposalRegistry` is the zero address until deployed; check before using. (Overwritten by the deploy script.)

## safeTx.ts
- `computeSafeTxHash(safe: Address, tx: {to, value: bigint, data: Hex, nonce: bigint}, chainId = 80002): Hex` - EIP-712 SafeTx hash, operation=0, all gas params 0, zero gasToken/refundReceiver. Equals `Safe.getTransactionHash(...)`.
- `computeSafeTxHashManual(safe, tx, chainId?)` - independent keccak(0x1901 || domainSep || structHash) implementation (used in tests to cross-check).
- `safeTxMessage(tx)` - the full 10-field message for `execTransaction` args: `to,value,data,operation(0),safeTxGas,baseGas,gasPrice,gasToken,refundReceiver` (+ nonce, not an execTransaction arg).
- `SAFE_TX_TYPEHASH`, `DOMAIN_SEPARATOR_TYPEHASH`, `safeTxTypes`.

## signatures.ts
`buildApprovedHashSignatures(owners: readonly Address[]): Hex` - 65 bytes per owner (`bytes32 owner | bytes32 0 | 0x01`), sorted by address ascending numerically, lowercase hex. Throws on duplicates (case-insensitive) or invalid addresses. `[]` returns `0x`. Pass exactly the owners who approved (plus the executor if they are an owner who has not approved - note: an executor who is msg.sender only counts as approved if their entry is included and `msg.sender == owner`, which Safe accepts as v=1 with owner==msg.sender).

## safeReads.ts
- `readSafeInfo(client, safe): Promise<SafeInfo>` - ONE Multicall3.aggregate3 (allowFailure) for getOwners, getThreshold, nonce, VERSION and native balance. Throws `Error('This address is not a Safe.')` for non-Safes.
- `readSafeInfoOrNull(client, safe): Promise<SafeInfo | null>`
- `isSafe(client, address): Promise<boolean>`
- `SafeInfo = { address, owners: Address[], threshold: number, nonce: bigint, balance: bigint, version: string }`

## rpc.ts
- `getPublicClient(): PublicClient` - THE shared client for the active RPC (use this outside React). In React use `useRpcClient()`.
- `getActiveRpcUrl()`, `getDefaultRpcUrl()` (VITE_DEFAULT_RPC_URL or viem public default), `getCustomRpcUrl()`.
- `validateRpcUrl(url): Promise<{ok:true}|{ok:false,error}>` - eth_chainId must be 80002.
- `setCustomRpc(url)` (validates, persists, rebuilds client; throws Error on invalid), `resetRpcToDefault()`.
- `reportRpcError(err)` / `reportRpcOk()` / `getRpcProblem()` / `subscribeRpcProblem()` - drive the RPC-problem banner. The QueryClient already reports every query error, so features normally need not call these.
- wagmi reads use this same client (custom transport that looks it up per request).

## backoff.ts
`withBackoff(fn, {retries=4, baseMs=500, maxMs=8000, shouldRetry, sleep, onRetry})`, `isRateLimitError(err)`, `isRangeError(err)` (getLogs range limits), `isTransientRpcError(err)`, `isRetryableRpcError(err)`.

## logCache.ts
localStorage key prefix `safeapp:logs:v1:`; bigint-safe JSON.
- `getLogsChunked({client, address, event, args?, fromBlock, toBlock, maxRange=10_000n, backoff?, onProgress?}): Promise<AnyLog[]>` - chunked `getLogs` (indexed `args` filter, strict decode), backoff on rate limits, halves the chunk on range errors.
- `scanLogsCached({client, address, event, args?, cacheKey, startBlock, toBlock?, maxRange?, force?}): Promise<{lastBlock: bigint, logs: AnyLog[]}>` - loads cache, scans only `(lastBlock, latest]` (or from `startBlock`), merges (dedupe by block:logIndex, ascending), saves. Use a cache key that includes the safe address and event, e.g. `` `${safe.toLowerCase()}:proposed` ``.
- `loadLogCache(key)`, `saveLogCache(key, {lastBlock, logs})`, `clearLogCache(key)`, `mergeLogs(a, b)`.
- For History "load more" (scan further back), call `getLogsChunked` over an older window and cache that yourself (separate key).
- `AnyLog = Log & { args?: Record<string, unknown> }`.

## safeErrors.ts
`SAFE_ERRORS` (GS0xx/GS1xx/GS2xx map), `describeSafeCode('GS026')`, `extractSafeCode(err): string | null` (walks `cause` chain), `friendlyError(err): string` (GS code text, wallet rejection, NotSafeOwner, insufficient funds, or first message).

## storage.ts
Never-throwing localStorage: `getItem, setItem (returns boolean), removeItem, getJSON(key, fallback), setJSON(key, value)`.

## explorer.ts
`txUrl(hash)`, `addressUrl(address)`, `EXPLORER_BASE` = `https://amoy.polygonscan.com`.

## queryKeys.ts
`safeKeys.all(safe) | info | queue | votes | history` - invalidate `safeKeys.all(safe)` after your own tx confirms.

## format.ts
`shortAddress(addr, head=6, tail=4)`, `formatNative(wei, maxDecimals=4)`.

## Hooks (src/hooks)
- `useSafeInfo(address)` - TanStack Query over `readSafeInfo`; no polling (staleTime Infinity, no refetch on focus/mount). `refetch()` for manual refresh.
- `useIsOwner(safe)` -> `{ isOwner, isConnected, account, isLoading }` (derived from useSafeInfo, no extra RPC).
- `useRpcClient()` -> shared PublicClient (re-renders when RPC changes).
- `useTxAction({ onConfirmed? })` -> `{ run(req), reset, status, hash, receipt, error, explorerUrl, isBusy }`; `run({address, abi, functionName, args, value?, gas?})` does writeContract (chain 80002) -> waits for receipt via the shared client. `status`: `idle | awaiting-wallet | pending | confirmed | reverted | error`. `error` is already plain text via `friendlyError`. Do your invalidation in `onConfirmed`.

## Feature slots
Each feature owns a folder under `src/features/<name>/`; tab components receive `{ safe: Address }` (`SafeTabProps` in `features/types.ts`). Routes: `/` (Home), `/create` (CreateSafe), `/safe/:address?tab=queue|history|new|owners` (only the active tab is mounted, so History stays lazy).
