import { Link } from 'react-router-dom'
import { useAccount, useDisconnect } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { appKitEnabled } from '../config/wagmi'
import { shortAddress } from '../lib/format'
import { CopyButton } from './CopyButton'

function ConnectButtons() {
  const { open } = useAppKit()
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  if (!isConnected || !address) {
    return (
      <button className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700" onClick={() => open()}>
        Connect wallet
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm" title={address}>
        {shortAddress(address)}
      </span>
      <CopyButton text={address} />
      <button className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  )
}

export function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <Link to="/" className="font-semibold">
        Safe Multisig <span className="text-xs font-normal text-slate-500">Polygon Amoy</span>
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        {appKitEnabled ? (
          <ConnectButtons />
        ) : (
          <span className="text-sm text-slate-500">Wallet disabled (no Reown project id)</span>
        )}
        <button className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </header>
  )
}
