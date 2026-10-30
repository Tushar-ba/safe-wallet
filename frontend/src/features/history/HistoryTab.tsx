import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { useRpcClient } from '../../hooks/useRpcClient'
import { friendlyError } from '../../lib/safeErrors'
import { safeKeys } from '../../lib/queryKeys'
import { txUrl, addressUrl } from '../../lib/explorer'
import { shortAddress } from '../../lib/format'
import { getJSON, setJSON } from '../../lib/storage'
import type { SafeTabProps } from '../types'
import { buildHistory, summarizeAction, type HistoryItem } from './historyLogic'
import { loadHistory, loadMore, PAGE_SIZE, type HistoryData, type HistClient } from './historyScan'

/** History tab: nothing is fetched until this component mounts (SafePage only mounts the active tab). */
export function HistoryTab({ safe }: SafeTabProps) {
  const client = useRpcClient() as unknown as HistClient
  const qc = useQueryClient()
  const key = safeKeys.history(safe)
  const [shown, setShown] = useState(PAGE_SIZE)

  const query = useQuery<HistoryData>({
    queryKey: key,
    queryFn: () => loadHistory(client, safe, PAGE_SIZE),
    // once per session: global defaults already disable refetch on mount/focus; Refresh refetches explicitly
  })

  const more = useMutation({
    mutationFn: async (target: number) => {
      const prev = qc.getQueryData<HistoryData>(key)
      if (!prev) throw new Error('History not loaded yet')
      return loadMore(client, safe, prev, target)
    },
    onSuccess: (data) => qc.setQueryData(key, data),
  })

  const data = query.data
  const items = useMemo(() => (data ? buildHistory(data.execs, data.proposals, data.headNonce) : []), [data])
  const refreshing = query.isFetching && !!data

  const onLoadMore = () => {
    const next = shown + PAGE_SIZE
    setShown(next)
    if (data && items.length < next && !data.reachedFloor) more.mutate(next)
  }

  const onRefresh = () => {
    more.reset()
    void query.refetch()
  }

  const busy = query.isFetching || more.isPending
  const error = query.error ?? more.error

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Transaction history</h2>
        <button
          onClick={onRefresh}
          disabled={busy}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>Could not load history: {friendlyError(error)}</span>
          <button
            onClick={() => (query.error ? void query.refetch() : more.mutate(shown))}
            disabled={busy}
            className="rounded bg-red-700 px-3 py-1 text-white hover:bg-red-800 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {query.isPending && !error && <Skeletons />}

      {data && items.length === 0 && !busy && (
        <div className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No executed transactions found in the scanned range (blocks {data.oldestBlock.toString()} to {data.lastBlock.toString()}).
          {!data.reachedFloor && ' Use "Scan further back" to look at older blocks.'}
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.slice(0, shown).map((it) => (
            <HistoryRow key={`${it.exec.blockNumber}:${it.exec.logIndex}`} safe={safe} item={it} />
          ))}
        </ul>
      )}

      {more.isPending && <Skeletons count={2} />}

      {data && (
        <div className="flex flex-col items-center gap-1 pt-1">
          {(items.length > shown || !data.reachedFloor) && (
            <button
              onClick={onLoadMore}
              disabled={busy}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {items.length > shown ? 'Load more' : 'Scan further back'}
            </button>
          )}
          <p className="text-xs text-slate-400">
            Scanned blocks {data.oldestBlock.toString()} to {data.lastBlock.toString()}
            {data.reachedFloor ? ' (complete)' : ''}
          </p>
        </div>
      )}
    </section>
  )
}

function Skeletons({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading history">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="animate-pulse rounded border border-slate-200 bg-white p-4">
          <div className="mb-2 h-4 w-1/3 rounded bg-slate-200" />
          <div className="h-3 w-2/3 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  )
}

/** Executor (tx.from) fetched per visible row, memoised in react-query and localStorage. */
function useExecutor(txHash: Hex): { executor: Address | undefined; isLoading: boolean } {
  const client = useRpcClient()
  const q = useQuery({
    queryKey: ['history-tx', txHash],
    queryFn: async () => {
      const lsKey = `safeapp:histtx:v1:${txHash}`
      const cached = getJSON<{ from?: Address } | null>(lsKey, null)
      if (cached?.from) return cached.from
      const tx = await client.getTransaction({ hash: txHash })
      setJSON(lsKey, { from: tx.from })
      return tx.from
    },
  })
  return { executor: q.data, isLoading: q.isLoading }
}

function HistoryRow({ safe, item }: { safe: Address; item: HistoryItem }) {
  const { exec, proposal, nonce } = item
  const { executor, isLoading } = useExecutor(exec.transactionHash)
  const [open, setOpen] = useState(false)
  const ok = exec.status === 'success'
  const action = proposal ? summarizeAction(safe, proposal) : null

  return (
    <li className="rounded border border-slate-200 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
            >
              {ok ? 'Executed' : 'Failed'}
            </span>
            {nonce !== undefined && (
              <span className="text-xs text-slate-500" title={item.nonceSource === 'derived' ? 'Derived from the Safe nonce' : undefined}>
                Nonce {nonce.toString()}
                {item.nonceSource === 'derived' ? '*' : ''}
              </span>
            )}
            <span className="text-xs text-slate-400">block {exec.blockNumber.toString()}</span>
          </div>
          {action ? (
            <p className="mt-1 break-words text-sm font-medium text-slate-900">{action.title}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">Details unavailable, executed outside this app.</p>
          )}
          {action?.detail && <p className="break-all text-xs text-slate-500">{action.detail}</p>}
        </div>
        <a
          href={txUrl(exec.transactionHash)}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-sm text-indigo-600 hover:underline"
        >
          Polygonscan
        </a>
      </div>

      <div className="mt-2 text-xs text-slate-500">
        Executor:{' '}
        {executor ? (
          <a href={addressUrl(executor)} target="_blank" rel="noreferrer" className="font-mono text-indigo-600 hover:underline">
            {shortAddress(executor)}
          </a>
        ) : isLoading ? (
          <span className="inline-block h-3 w-20 animate-pulse rounded bg-slate-200 align-middle" />
        ) : (
          'unknown'
        )}
      </div>

      {proposal && (
        <>
          <button onClick={() => setOpen((o) => !o)} className="mt-2 text-xs text-slate-500 hover:text-slate-800">
            {open ? 'Hide details' : 'Show details'}
          </button>
          {open && (
            <dl className="mt-2 space-y-1 break-all rounded bg-slate-50 p-2 text-xs text-slate-600">
              <div>To: <span className="font-mono">{proposal.to}</span></div>
              <div>Value (wei): {proposal.value.toString()}</div>
              <div>Data: <span className="font-mono">{proposal.data}</span></div>
              <div>Proposer: <span className="font-mono">{proposal.proposer}</span></div>
              <div>Safe tx hash: <span className="font-mono">{proposal.safeTxHash}</span></div>
            </dl>
          )}
        </>
      )}
    </li>
  )
}
