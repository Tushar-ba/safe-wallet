import { useAccount } from 'wagmi'
import { CopyButton } from '../../components/CopyButton'
import { useSafeInfo } from '../../hooks/useSafeInfo'
import { addressUrl } from '../../lib/explorer'
import type { SafeTabProps } from '../types'

export function OwnersTab({ safe }: SafeTabProps) {
  const { address: account } = useAccount()
  const q = useSafeInfo(safe)

  if (q.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded bg-slate-200" />
        ))}
      </div>
    )
  }
  if (q.isError || !q.data) {
    return <p className="rounded bg-red-50 p-3 text-sm text-red-800">Could not load owners.</p>
  }
  const { owners, threshold } = q.data
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        <span className="font-medium">{threshold} of {owners.length}</span> owners must confirm a transaction before it can be executed.
      </p>
      {owners.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No owners.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {owners.map((o, i) => {
            const you = !!account && account.toLowerCase() === o.toLowerCase()
            return (
              <li key={o} className={`flex flex-wrap items-center gap-2 p-3 ${you ? 'bg-emerald-50' : ''}`}>
                <span className="w-6 text-xs text-slate-400">{i + 1}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-xs sm:text-sm">{o}</span>
                {you && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">You</span>}
                <CopyButton text={o} />
                <a href={addressUrl(o)} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
                  Explorer
                </a>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-slate-500">Read-only. Changing owners or the threshold is not supported in this app.</p>
    </div>
  )
}
