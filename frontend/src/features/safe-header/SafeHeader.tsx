import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CopyButton } from '../../components/CopyButton'
import { useIsOwner } from '../../hooks/useIsOwner'
import { useSafeInfo } from '../../hooks/useSafeInfo'
import { addressUrl } from '../../lib/explorer'
import { formatNative } from '../../lib/format'
import { safeKeys } from '../../lib/queryKeys'
import { savedSafesStore, useSavedSafes } from '../home/savedSafes'
import type { SafeTabProps } from '../types'

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[7rem]">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  )
}

function Nickname({ safe }: SafeTabProps) {
  const saved = useSavedSafes().find((s) => s.address.toLowerCase() === safe.toLowerCase())
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(saved?.name ?? '')
  useEffect(() => setDraft(saved?.name ?? ''), [saved?.name])

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (saved) savedSafesStore.rename(safe, draft)
          else savedSafesStore.add(safe, draft)
          setEditing(false)
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Nickname"
          className="w-40 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button className="rounded bg-indigo-600 px-2 py-1 text-xs text-white">Save</button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">
          Cancel
        </button>
      </form>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <h1 className="text-lg font-semibold">{saved?.name ?? 'Unnamed Safe'}</h1>
      <button onClick={() => setEditing(true)} className="text-xs text-indigo-700 underline">
        {saved?.name ? 'Edit' : 'Name it'}
      </button>
      {!saved && (
        <button onClick={() => savedSafesStore.add(safe)} className="text-xs text-indigo-700 underline">
          Save to my list
        </button>
      )}
    </div>
  )
}

export function SafeHeader({ safe }: SafeTabProps) {
  const qc = useQueryClient()
  const q = useSafeInfo(safe)
  const { isOwner, isConnected } = useIsOwner(safe)

  if (q.isLoading) {
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" aria-busy="true">
        <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="flex gap-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
      </div>
    )
  }

  if (q.isError || !q.data) {
    const msg = q.error instanceof Error ? q.error.message : 'Could not load this Safe.'
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Could not open this Safe</p>
        <p>{msg}</p>
        <p className="break-all font-mono text-xs">{safe}</p>
        <div className="flex gap-3">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: safeKeys.info(safe) })}
            className="rounded border border-red-300 px-2 py-1 text-xs hover:bg-red-100"
          >
            Retry
          </button>
          <Link to="/" className="text-xs underline">
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  const info = q.data
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Nickname safe={safe} />
          {isOwner ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Owner</span>
          ) : (
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
              title={isConnected ? 'Your connected wallet is not an owner of this Safe' : 'Connect an owner wallet to take actions'}
            >
              View-only mode
            </span>
          )}
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: safeKeys.info(safe) })}
          disabled={q.isFetching}
          className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
        >
          {q.isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs sm:text-sm">{safe}</span>
        <CopyButton text={safe} />
        <a href={addressUrl(safe)} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
          Explorer
        </a>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Balance">{formatNative(info.balance)} POL</Stat>
        <Stat label="Threshold">
          {info.threshold} of {info.owners.length}
        </Stat>
        <Stat label="Version">{info.version}</Stat>
        <Stat label="Nonce">{info.nonce.toString()}</Stat>
      </div>
    </div>
  )
}
