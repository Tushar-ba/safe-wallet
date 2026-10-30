import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { deployments } from '../../config/deployments'
import { safeAbi, txProposalRegistryAbi } from '../../lib/abis'
import { addressUrl } from '../../lib/explorer'
import { shortAddress } from '../../lib/format'
import { safeKeys } from '../../lib/queryKeys'
import { friendlyError } from '../../lib/safeErrors'
import { safeTxMessage } from '../../lib/safeTx'
import { buildApprovedHashSignatures } from '../../lib/signatures'
import { useRpcClient } from '../../hooks/useRpcClient'
import { useTxAction } from '../../hooks/useTxAction'
import { countVotes, execReadiness, summarizeAction, type Proposal } from './queueLogic'

interface Props {
  proposal: Proposal
  owners: readonly Address[]
  threshold: number
  currentNonce: bigint
  /** lowercased owner -> approvedHashes value; undefined while loading */
  approvals?: Record<string, bigint>
  account?: Address
  isOwner: boolean
  conflicting: boolean
  /** a rejection (self-call) proposal already exists at this nonce */
  hasReject: boolean
}

export function ProposalCard({ proposal: p, owners, threshold, currentNonce, approvals, account, isOwner, conflicting, hasReject }: Props) {
  const qc = useQueryClient()
  const client = useRpcClient()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [simError, setSimError] = useState<string | undefined>()
  const [simulating, setSimulating] = useState(false)

  const tx = useTxAction({
    onConfirmed: async () => {
      // refetch only what this action can change
      if (label === 'Reject') {
        await qc.invalidateQueries({ queryKey: safeKeys.queue(p.safe) })
      } else if (label === 'Execute') {
        await qc.invalidateQueries({ queryKey: safeKeys.info(p.safe) })
        await qc.invalidateQueries({ queryKey: safeKeys.votes(p.safe) })
      } else {
        await qc.invalidateQueries({ queryKey: safeKeys.votes(p.safe) })
      }
    },
  })

  const summary = summarizeAction(p)
  const votes = approvals ? countVotes(owners, approvals) : null
  const myApproved = !!account && !!votes?.approvers.some((a) => a.toLowerCase() === account.toLowerCase())
  const ready = execReadiness({
    proposalNonce: p.nonce,
    currentNonce,
    threshold,
    approvers: votes?.approvers ?? [],
    executor: account,
    executorIsOwner: isOwner,
  })
  const pct = Math.min(100, ((votes?.count ?? 0) / threshold) * 100)
  const isRejectCard = summary.kind === 'reject'

  const confirm = async () => {
    setLabel('Confirm')
    setSimError(undefined)
    await tx.run({ address: p.safe, abi: safeAbi, functionName: 'approveHash', args: [p.safeTxHash] })
  }

  const execute = async () => {
    setLabel('Execute')
    setSimError(undefined)
    tx.reset()
    if (!account) return
    const m = safeTxMessage(p)
    const args = [
      m.to,
      m.value,
      m.data,
      m.operation,
      m.safeTxGas,
      m.baseGas,
      m.gasPrice,
      m.gasToken,
      m.refundReceiver,
      buildApprovedHashSignatures(ready.signers),
    ] as const
    setSimulating(true)
    let gas: bigint | undefined
    try {
      await client.simulateContract({ address: p.safe, abi: safeAbi, functionName: 'execTransaction', args, account })
      const est = await client.estimateContractGas({ address: p.safe, abi: safeAbi, functionName: 'execTransaction', args, account })
      gas = (est * 12n) / 10n
    } catch (e) {
      setSimError(friendlyError(e))
      setSimulating(false)
      return
    }
    setSimulating(false)
    await tx.run({ address: p.safe, abi: safeAbi, functionName: 'execTransaction', args, gas })
  }

  const reject = async () => {
    setLabel('Reject')
    setSimError(undefined)
    await tx.run({
      address: deployments.txProposalRegistry as Address,
      abi: txProposalRegistryAbi,
      functionName: 'propose',
      args: [p.safe, p.safe, 0n, '0x', p.nonce],
    })
  }

  const busy = tx.isBusy || simulating

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-medium text-slate-900">{summary.title}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            Proposed by{' '}
            <a className="font-mono underline" href={addressUrl(p.proposer)} target="_blank" rel="noreferrer">
              {shortAddress(p.proposer)}
            </a>
            {account && p.proposer.toLowerCase() === account.toLowerCase() ? ' (you)' : ''}
          </div>
        </div>
        <div className="flex gap-1 text-xs">
          {isRejectCard && <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">Rejection</span>}
          {conflicting && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">Conflicting</span>}
        </div>
      </div>

      {/* votes */}
      <div className="mt-3">
        {!votes ? (
          <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>
                {votes.count} of {threshold} required
              </span>
              {isOwner && !myApproved && <span className="font-medium text-amber-700">You haven't confirmed yet</span>}
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className={`h-full ${votes.count >= threshold ? 'bg-emerald-500' : 'bg-sky-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
              {votes.byOwner.map((o) => (
                <li key={o.owner} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                  <span className="font-mono">
                    {shortAddress(o.owner)}
                    {account && o.owner.toLowerCase() === account.toLowerCase() ? ' (you)' : ''}
                  </span>
                  <span className={o.confirmed ? 'text-emerald-700' : 'text-slate-500'}>
                    {o.confirmed ? 'Confirmed ✅' : 'Not yet ⏳'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* actions */}
      {isOwner && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={busy || !votes || myApproved}
            title={myApproved ? 'You already confirmed' : undefined}
            onClick={confirm}
          >
            {myApproved ? 'Confirmed' : 'Confirm'}
          </button>
          <button
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={busy || !votes || !ready.ready}
            title={ready.reason}
            onClick={execute}
          >
            {simulating ? 'Simulating...' : 'Execute'}
          </button>
          {!isRejectCard && !hasReject && (
            <button
              className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40"
              disabled={busy}
              title="Proposes an empty self-call at the same nonce; confirm it afterwards to cancel this transaction"
              onClick={reject}
            >
              Reject (propose cancel)
            </button>
          )}
        </div>
      )}
      {isOwner && votes && !ready.ready && ready.reason && (
        <div className="mt-1 text-xs text-slate-500">Execute: {ready.reason}</div>
      )}
      {isOwner && ready.ready && ready.includesExecutor && (
        <div className="mt-1 text-xs text-slate-500">Your own signature will be included when executing.</div>
      )}

      {/* tx feedback */}
      {simError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">Simulation failed: {simError}</div>}
      {tx.status !== 'idle' && label && (
        <div className="mt-2 text-xs">
          <span className="font-medium">{label}: </span>
          {tx.status === 'awaiting-wallet' && 'confirm in your wallet...'}
          {tx.status === 'pending' && 'waiting for confirmation...'}
          {tx.status === 'confirmed' &&
            (label === 'Reject'
              ? 'rejection proposed. It appears as a new card at this nonce; confirm it to cancel.'
              : 'confirmed.')}
          {tx.status === 'reverted' && 'reverted.'}
          {tx.error && <span className="text-red-700"> {tx.error}</span>}{' '}
          {tx.explorerUrl && (
            <a className="underline" href={tx.explorerUrl} target="_blank" rel="noreferrer">
              View on Polygonscan
            </a>
          )}
        </div>
      )}

      <button className="mt-3 text-xs text-slate-600 underline" onClick={() => setOpen(!open)}>
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <dl className="mt-2 space-y-1 break-all text-xs text-slate-700">
          <div><dt className="inline font-medium">safeTxHash: </dt><dd className="inline font-mono">{p.safeTxHash}</dd></div>
          <div><dt className="inline font-medium">To: </dt><dd className="inline font-mono">{p.to}</dd></div>
          <div><dt className="inline font-medium">Value: </dt><dd className="inline font-mono">{p.value.toString()} wei</dd></div>
          <div><dt className="inline font-medium">Nonce: </dt><dd className="inline font-mono">{p.nonce.toString()}</dd></div>
          {summary.detail && <div>{summary.detail}</div>}
          <div>
            <dt className="font-medium">Calldata:</dt>
            <dd className="mt-1 max-h-48 overflow-auto rounded bg-slate-50 p-2 font-mono">{p.data}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
