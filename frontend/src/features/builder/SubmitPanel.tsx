import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zeroAddress, type Address, type Hex } from 'viem'
import { deployments } from '../../config/deployments'
import { safeAbi, txProposalRegistryAbi } from '../../lib/abis'
import { formatNative } from '../../lib/format'
import { safeKeys } from '../../lib/queryKeys'
import { computeSafeTxHash } from '../../lib/safeTx'
import { useIsOwner } from '../../hooks/useIsOwner'
import { useSafeInfo } from '../../hooks/useSafeInfo'
import { useTxAction, type TxStatus } from '../../hooks/useTxAction'
import type { TxDraft } from './types'

const registry = deployments.txProposalRegistry as string
const registryDeployed = registry.toLowerCase() !== zeroAddress

function parseNonce(s: string, current: bigint): { nonce?: bigint; error?: string; warning?: string } {
  if (!/^\d+$/.test(s.trim())) return { error: 'Nonce must be a non-negative integer' }
  const n = BigInt(s.trim())
  if (n < current) return { error: `Nonce is lower than the Safe's current nonce (${current}); it could never execute` }
  if (n > current)
    return {
      nonce: n,
      warning: `Nonce gap: this transaction can only execute after ${n - current} earlier nonce(s) (${current}..${n - 1n}) are executed.`,
    }
  return { nonce: n }
}

export function SubmitPanel({ safe, draft }: { safe: Address; draft: TxDraft | null }) {
  const qc = useQueryClient()
  const info = useSafeInfo(safe)
  const { isOwner, isConnected } = useIsOwner(safe)
  const [nonceStr, setNonceStr] = useState<string | null>(null)
  const [proposed, setProposed] = useState<{ hash: Hex; nonce: bigint } | null>(null)

  const currentNonce = info.data?.nonce
  const nonceText = nonceStr ?? currentNonce?.toString() ?? ''
  const nonceParsed = currentNonce === undefined ? { error: 'Loading Safe nonce...' } : parseNonce(nonceText, currentNonce)

  const safeTxHash = useMemo(() => {
    if (!draft || nonceParsed.nonce === undefined) return null
    return computeSafeTxHash(safe, { to: draft.to, value: draft.value, data: draft.data, nonce: nonceParsed.nonce })
  }, [draft, safe, nonceParsed.nonce])

  const invalidateQueue = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: safeKeys.queue(safe) }),
      qc.invalidateQueries({ queryKey: safeKeys.votes(safe) }),
    ])
  }

  const proposeTx = useTxAction({
    onConfirmed: async () => {
      if (safeTxHash && nonceParsed.nonce !== undefined) setProposed({ hash: safeTxHash, nonce: nonceParsed.nonce })
      await invalidateQueue()
    },
  })
  const approveTx = useTxAction({ onConfirmed: invalidateQueue })

  if (!isConnected || !isOwner) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        {isConnected
          ? 'You are not an owner of this Safe. The builder is read-only: only owners can create transactions.'
          : 'Connect an owner wallet to create transactions.'}
      </div>
    )
  }

  if (proposed) {
    return (
      <div className="space-y-3 rounded border border-green-200 bg-green-50 p-3 text-sm">
        <p className="font-medium text-green-800">Transaction proposed (nonce {proposed.nonce.toString()}).</p>
        {proposeTx.explorerUrl && (
          <a className="text-xs text-indigo-600 underline" href={proposeTx.explorerUrl} target="_blank" rel="noreferrer">
            View proposal on Polygonscan
          </a>
        )}
        <p className="break-all font-mono text-xs text-slate-600">safeTxHash: {proposed.hash}</p>
        <div className="rounded border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs text-slate-600">
            Optional second step: your vote is not counted until you approve. This is a separate on-chain transaction (Safe.approveHash) and costs gas.
          </p>
          <button
            type="button"
            disabled={approveTx.isBusy || approveTx.status === 'confirmed'}
            onClick={() => approveTx.run({ address: safe, abi: safeAbi, functionName: 'approveHash', args: [proposed.hash] })}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {approveTx.status === 'confirmed' ? 'Confirmed as proposer' : 'Also confirm (approve) as proposer'}
          </button>
          <TxStatusLine status={approveTx.status} url={approveTx.explorerUrl} error={approveTx.error} />
        </div>
        <button
          type="button"
          className="text-xs text-indigo-600 underline"
          onClick={() => {
            setProposed(null)
            setNonceStr(null)
            proposeTx.reset()
            approveTx.reset()
          }}
        >
          Create another transaction
        </button>
      </div>
    )
  }

  const blocked = !registryDeployed
    ? 'The proposal registry is not deployed yet (TxProposalRegistry address is not configured). Submitting is disabled.'
    : !draft
      ? 'Complete the form above to enable submission.'
      : nonceParsed.error
        ? nonceParsed.error
        : null

  return (
    <div className="space-y-3 rounded border border-slate-200 bg-white p-3">
      <h3 className="text-sm font-semibold">Review and create</h3>

      {draft ? (
        <div className="space-y-2 text-xs">
          <Row k="To" v={draft.to} mono />
          <Row k="Value" v={`${formatNative(draft.value, 18)} POL`} />
          {draft.decoded && (
            <div>
              <div className="text-slate-500">Decoded call</div>
              <div className="rounded bg-slate-50 p-2 font-mono">
                <div className="break-all font-medium">{draft.decoded.signature}</div>
                {draft.decoded.args.map((a, i) => (
                  <div key={i} className="break-all">
                    {a.name} <span className="text-slate-400">({a.type})</span> = {a.value}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-slate-500">Encoded calldata</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 font-mono">{draft.data}</pre>
          </div>
          {safeTxHash && <Row k="safeTxHash" v={safeTxHash} mono />}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Nothing to submit yet.</p>
      )}

      <label className="block">
        <span className="mb-0.5 block text-xs font-medium text-slate-600">
          Nonce (Safe's current nonce: {currentNonce?.toString() ?? '...'})
        </span>
        <input
          className="w-40 rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
          value={nonceText}
          inputMode="numeric"
          onChange={(e) => setNonceStr(e.target.value)}
        />
      </label>
      {nonceParsed.warning && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{nonceParsed.warning}</p>}

      {blocked && <p className="text-xs text-red-600">{blocked}</p>}

      <button
        type="button"
        disabled={!!blocked || proposeTx.isBusy || !draft || nonceParsed.nonce === undefined}
        onClick={() => {
          if (!draft || nonceParsed.nonce === undefined) return
          approveTx.reset()
          void proposeTx.run({
            address: registry as Address,
            abi: txProposalRegistryAbi,
            functionName: 'propose',
            args: [safe, draft.to, draft.value, draft.data, nonceParsed.nonce],
          })
        }}
        className="rounded bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        Create transaction
      </button>
      <TxStatusLine status={proposeTx.status} url={proposeTx.explorerUrl} error={proposeTx.error} />
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-slate-500">{k}: </span>
      <span className={`break-all ${mono ? 'font-mono' : ''}`}>{v}</span>
    </div>
  )
}

function TxStatusLine({ status, url, error }: { status: TxStatus; url?: string; error?: string }) {
  if (status === 'idle') return null
  const text =
    status === 'awaiting-wallet'
      ? 'Confirm in your wallet...'
      : status === 'pending'
        ? 'Waiting for confirmation...'
        : status === 'confirmed'
          ? 'Confirmed.'
          : status === 'reverted'
            ? 'Reverted.'
            : 'Failed.'
  return (
    <div className="mt-2 text-xs">
      <span className={status === 'error' || status === 'reverted' ? 'text-red-600' : 'text-slate-600'}>{text}</span>{' '}
      {url && (
        <a className="text-indigo-600 underline" href={url} target="_blank" rel="noreferrer">
          Polygonscan
        </a>
      )}
      {error && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  )
}
