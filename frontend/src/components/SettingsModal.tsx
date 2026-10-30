import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getActiveRpcUrl, getCustomRpcUrl, getDefaultRpcUrl, resetRpcToDefault, setCustomRpc } from '../lib/rpc'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState(getCustomRpcUrl() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await setCustomRpc(url)
      setSaved(true)
      await qc.invalidateQueries()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="px-2 text-slate-500 hover:text-slate-800" aria-label="Close">
            x
          </button>
        </div>
        <label className="mb-1 block text-sm font-medium" htmlFor="rpc">
          Custom RPC URL (Polygon Amoy, chainId 80002)
        </label>
        <input
          id="rpc"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={getDefaultRpcUrl()}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          spellCheck={false}
        />
        <p className="mt-2 break-all text-xs text-slate-500">
          Active: {getActiveRpcUrl()}
          <br />
          Default: {getDefaultRpcUrl()}
        </p>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="mt-2 text-sm text-green-700">Saved. The RPC was verified (chainId 80002).</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={async () => {
              resetRpcToDefault()
              setUrl('')
              setError(null)
              setSaved(false)
              await qc.invalidateQueries()
            }}
          >
            Reset to default
          </button>
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            disabled={busy || !url.trim()}
            onClick={save}
          >
            {busy ? 'Validating...' : 'Validate and save'}
          </button>
        </div>
      </div>
    </div>
  )
}
