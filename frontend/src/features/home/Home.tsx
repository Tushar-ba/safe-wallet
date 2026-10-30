import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useRpcClient } from '../../hooks/useRpcClient'
import { shortAddress, formatNative } from '../../lib/format'
import { readSafeInfoOrNull } from '../../lib/safeReads'
import { safeKeys } from '../../lib/queryKeys'
import { useSavedSafes, savedSafesStore, type SavedSafe } from './savedSafes'
import { verifySafeInput } from './validate'

function SavedCard({ item }: { item: SavedSafe }) {
  const { address: account } = useAccount()
  const client = useRpcClient()
  // One multicall per saved Safe, cached for the session (no polling). Shares the info key with the header.
  const q = useQuery({
    queryKey: safeKeys.info(item.address),
    queryFn: async () => {
      const i = await readSafeInfoOrNull(client, item.address)
      if (!i) throw new Error('This address is not a Safe.')
      return i
    },
    staleTime: Infinity,
    retry: false,
  })
  const info = q.data
  const isOwner = !!account && !!info?.owners.some((o) => o.toLowerCase() === account.toLowerCase())
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{item.name ?? 'Unnamed Safe'}</div>
          <div className="font-mono text-xs text-slate-500" title={item.address}>
            {shortAddress(item.address, 8, 6)}
          </div>
        </div>
        {isOwner && (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Owner</span>
        )}
      </div>
      <div className="text-xs text-slate-600">
        {q.isLoading ? (
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
        ) : info ? (
          <>
            {info.threshold} of {info.owners.length} threshold · {formatNative(info.balance)} POL
          </>
        ) : (
          <span className="text-red-700">Could not load this Safe.</span>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between pt-1">
        <Link to={`/safe/${item.address}`} className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700">
          Open
        </Link>
        <button
          type="button"
          onClick={() => savedSafesStore.remove(item.address)}
          className="text-xs text-slate-500 hover:text-red-700"
          aria-label={`Remove ${item.name ?? item.address} from the list`}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

export function Home() {
  const navigate = useNavigate()
  const client = useRpcClient()
  const saved = useSavedSafes()
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    setBusy(true)
    const r = await verifySafeInput(client, input)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    savedSafesStore.add(r.address, name)
    navigate(`/safe/${r.address}`)
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h1 className="text-lg font-semibold">Open a Safe</h1>
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <label className="block text-sm text-slate-600" htmlFor="safe-address">
            Open a Safe: paste address
          </label>
          <input
            id="safe-address"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setError(undefined)
            }}
            placeholder="0x..."
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="Nickname (optional)"
              aria-label="Nickname (optional)"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none sm:max-w-xs"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Checking...' : 'Open Safe'}
            </button>
          </div>
          {error && (
            <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </form>
        <p className="mt-4 text-sm text-slate-600">
          No Safe yet?{' '}
          <Link to="/create" className="font-medium text-indigo-700 underline">
            Create new Safe
          </Link>
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold">Saved Safes</h2>
        <p className="mb-3 text-xs text-slate-500">
          This list is stored only in this browser (localStorage). It is not synced between devices.
        </p>
        {saved.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            No saved Safes yet. Open or create one and it will appear here.
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((s) => (
              <SavedCard key={s.address} item={s} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
