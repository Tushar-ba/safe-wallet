import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useIsOwner } from '../../hooks/useIsOwner'
import { safeKeys } from '../../lib/queryKeys'
import { friendlyError } from '../../lib/safeErrors'
import type { SafeTabProps } from '../types'
import { ProposalCard } from './ProposalCard'
import { registryDeployed, useQueueData } from './useQueue'

const AUTO_REFRESH_MS = 30_000

export function QueueTab({ safe }: SafeTabProps) {
  const qc = useQueryClient()
  const { isOwner, account } = useIsOwner(safe)
  const { info, logs, votes, groups, flagged } = useQueueData(safe)

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: safeKeys.info(safe) }),
      qc.invalidateQueries({ queryKey: safeKeys.queue(safe) }),
      qc.invalidateQueries({ queryKey: safeKeys.votes(safe) }),
    ])
  }, [qc, safe])

  // At most one slow refresh of the Queue, only while this tab is mounted and the page is visible.
  useEffect(() => {
    if (!registryDeployed) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (!registryDeployed) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        The transaction registry is not deployed yet, so there is no queue to show. Deploy TxProposalRegistry and update
        <span className="font-mono"> config/deployments.ts</span>.
      </div>
    )
  }

  const loading = info.isLoading || logs.isLoading
  const error = info.error ?? logs.error ?? votes.error
  const fetching = info.isFetching || logs.isFetching || votes.isFetching
  const nonce = info.data?.nonce ?? 0n

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Queue</h2>
        <button
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={fetching}
        >
          {fetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Could not load the queue: {friendlyError(error)}
        </div>
      )}

      {flagged.some((f) => f.reason === 'hash-mismatch') && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {flagged.filter((f) => f.reason === 'hash-mismatch').length} proposal event(s) were hidden because the hash in
          the event does not match the locally recomputed Safe transaction hash.
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-slate-200" />
          ))}
        </div>
      ) : groups.length === 0 && !error ? (
        <div className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No pending transactions. Create one from the "New transaction" tab.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.nonce.toString()} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">Nonce {g.nonce.toString()}</span>
              {g.nonce === nonce && <span className="text-xs text-emerald-700">next to execute</span>}
              {g.conflicting && (
                <span className="text-xs text-amber-800">
                  {g.proposals.length} conflicting proposals, only one can execute
                </span>
              )}
            </div>
            {g.proposals.map((p) => (
              <ProposalCard
                key={p.safeTxHash}
                proposal={p}
                owners={info.data?.owners ?? []}
                threshold={info.data?.threshold ?? 1}
                currentNonce={nonce}
                approvals={votes.data?.[p.safeTxHash.toLowerCase()]}
                account={account}
                isOwner={isOwner}
                conflicting={g.conflicting}
                hasReject={g.proposals.some((x) => x.to.toLowerCase() === safe.toLowerCase() && x.value === 0n && x.data === '0x')}
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}
