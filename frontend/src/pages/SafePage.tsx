import { isAddress, getAddress } from 'viem'
import { useParams, useSearchParams } from 'react-router-dom'
import { SafeHeader } from '../features/safe-header/SafeHeader'
import { QueueTab } from '../features/queue/QueueTab'
import { HistoryTab } from '../features/history/HistoryTab'
import { BuilderTab } from '../features/builder/BuilderTab'
import { OwnersTab } from '../features/owners/OwnersTab'
import { useSafeInfo } from '../hooks/useSafeInfo'

const TABS = [
  { id: 'queue', label: 'Queue', Component: QueueTab },
  { id: 'history', label: 'History', Component: HistoryTab },
  { id: 'new', label: 'New transaction', Component: BuilderTab },
  { id: 'owners', label: 'Owners', Component: OwnersTab },
] as const

/** /safe/:address?tab=queue|history|new|owners. Only the active tab is mounted (History stays lazy). */
export function SafePage() {
  const { address } = useParams()
  if (!address || !isAddress(address, { strict: false })) {
    return <p className="rounded bg-red-50 p-4 text-sm text-red-800">Invalid Safe address in the URL.</p>
  }
  return <SafeView safe={getAddress(address)} />
}

function SafeView({ safe }: { safe: ReturnType<typeof getAddress> }) {
  const [params, setParams] = useSearchParams()
  const info = useSafeInfo(safe)
  const active = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0]
  const Active = active.Component
  return (
    <div className="space-y-4">
      <SafeHeader safe={safe} />
      {info.isError ? null : <>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active.id}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
            className={`whitespace-nowrap px-4 py-2 text-sm ${
              t.id === active.id ? 'border-b-2 border-indigo-600 font-medium text-indigo-700' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <Active safe={safe} />
      </>}
    </div>
  )
}
