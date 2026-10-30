import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount, useSwitchChain } from 'wagmi'
import { polygonAmoy } from 'viem/chains'
import { missingEnv } from '../config/env'
import { clearRpcProblem, getRpcProblem, subscribeRpcProblem } from '../lib/rpc'

function Banner({ tone, children }: { tone: 'warn' | 'error' | 'info'; children: ReactNode }) {
  const c = {
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    error: 'bg-red-50 text-red-900 border-red-200',
    info: 'bg-blue-50 text-blue-900 border-blue-200',
  }[tone]
  return <div className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${c}`}>{children}</div>
}

export function ConfigMissingNotice() {
  if (missingEnv.length === 0) return null
  return (
    <Banner tone="info">
      <span>
        Configuration missing: <code>{missingEnv.join(', ')}</code>.{' '}
        {missingEnv.includes('VITE_REOWN_PROJECT_ID') && 'Wallet connection is disabled until a Reown project id is set. '}
        {missingEnv.includes('VITE_DEFAULT_RPC_URL') && 'Falling back to the public Amoy RPC. '}
        Copy <code>.env.example</code> to <code>.env</code>, fill it in and restart the dev server.
      </span>
    </Banner>
  )
}

export function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending, error } = useSwitchChain()
  if (!isConnected || chainId === polygonAmoy.id) return null
  return (
    <Banner tone="warn">
      <span>Your wallet is on the wrong network. This app only works on Polygon Amoy (80002).</span>
      <button
        className="rounded bg-amber-600 px-3 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
        disabled={isPending}
        onClick={() => switchChain({ chainId: polygonAmoy.id })}
      >
        {isPending ? 'Switching...' : 'Switch network'}
      </button>
      {error && <span className="text-red-700">{error.message.split('\n')[0]}</span>}
    </Banner>
  )
}

export function RpcProblemBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const problem = useSyncExternalStore(subscribeRpcProblem, getRpcProblem)
  const qc = useQueryClient()
  const [retrying, setRetrying] = useState(false)
  if (!problem.active) return null
  return (
    <Banner tone="error">
      <span>RPC problem: {problem.message} Requests are retried automatically with backoff. Retry now or switch RPC.</span>
      <button
        className="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-50"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true)
          clearRpcProblem()
          try {
            await qc.refetchQueries({ type: 'active', predicate: (q) => q.state.status === 'error' })
          } finally {
            setRetrying(false)
          }
        }}
      >
        {retrying ? 'Retrying...' : 'Retry'}
      </button>
      <button className="rounded border border-red-300 px-3 py-1 hover:bg-red-100" onClick={onOpenSettings}>
        Switch RPC
      </button>
    </Banner>
  )
}
