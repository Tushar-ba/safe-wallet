import { useCallback, useMemo, useState } from 'react'
import type { Abi, Address } from 'viem'
import { env } from '../../config/env'
import { functionSignature, parseAddressInput } from '../../lib/abi/abiForm'
import {
  abiFunctions,
  detectEip1967Implementation,
  fetchEtherscanAbi,
  isReadFunction,
  parseAbiJson,
} from '../../lib/abi/abiSource'
import { shortAddress } from '../../lib/format'
import { getPublicClient } from '../../lib/rpc'
import { ReadForm } from './ReadForm'
import type { TxDraft } from './types'
import { WriteForm } from './WriteForm'

type AbiChoice = 'target' | 'implementation' | 'pasted'

interface Loaded {
  target: Address
  targetAbi?: Abi
  implAddress?: Address
  implAbi?: Abi
  pastedAbi?: Abi
  choice: AbiChoice
}

export function ContractMode({ onDraft }: { onDraft: (d: TxDraft | null) => void }) {
  const [addrInput, setAddrInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState<string>()
  const [sub, setSub] = useState<'write' | 'read'>('write')
  const [selected, setSelected] = useState<string>('')

  const resetAll = useCallback(() => {
    onDraft(null)
    setLoaded(null)
    setNotes([])
    setError(undefined)
    setSelected('')
  }, [onDraft])

  async function load() {
    resetAll()
    const a = parseAddressInput(addrInput)
    if (!a.ok) {
      setError(a.error)
      return
    }
    setLoading(true)
    const nextNotes: string[] = []
    try {
      const [proxyImpl, own] = await Promise.all([
        detectEip1967Implementation(getPublicClient(), a.address),
        fetchEtherscanAbi(a.address, env.explorerApiKey),
      ])
      const next: Loaded = { target: a.address, choice: 'target' }
      if (own.ok) next.targetAbi = own.abi
      else nextNotes.push(own.error)

      if (proxyImpl) {
        next.implAddress = proxyImpl
        nextNotes.push(`EIP-1967 proxy detected. Implementation: ${proxyImpl}`)
        const impl = await fetchEtherscanAbi(proxyImpl, env.explorerApiKey)
        if (impl.ok) {
          next.implAbi = impl.abi
          next.choice = 'implementation'
        } else nextNotes.push(`Implementation ABI: ${impl.error}`)
      }
      if (!next.targetAbi && !next.implAbi) {
        setPasteOpen(true)
        nextNotes.push('No ABI could be fetched automatically. Paste the ABI JSON below.')
      }
      setLoaded(next)
      setSelected('')
    } finally {
      setNotes(nextNotes)
      setLoading(false)
    }
  }

  function applyPaste() {
    setPasteError(undefined)
    try {
      const abi = parseAbiJson(pasteText)
      const a = parseAddressInput(addrInput)
      if (!a.ok) throw new Error(a.error)
      setLoaded((cur) => ({ ...(cur ?? { target: a.address, choice: 'pasted' }), target: a.address, pastedAbi: abi, choice: 'pasted' }))
      setSelected('')
      onDraft(null)
    } catch (e) {
      setPasteError(e instanceof Error ? e.message : String(e))
    }
  }

  const abi: Abi | undefined = loaded
    ? loaded.choice === 'pasted'
      ? loaded.pastedAbi
      : loaded.choice === 'implementation'
        ? loaded.implAbi
        : loaded.targetAbi
    : undefined
  const fns = useMemo(() => (abi ? abiFunctions(abi) : []), [abi])
  const writeFns = fns.filter((f) => !isReadFunction(f))
  const readFns = fns.filter(isReadFunction)
  const selectedFn = writeFns.find((f) => functionSignature(f) === selected)

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Target contract address</label>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm"
            placeholder="0x..."
            value={addrInput}
            spellCheck={false}
            onChange={(e) => setAddrInput(e.target.value)}
          />
          <button
            type="button"
            onClick={load}
            disabled={loading || !addrInput.trim()}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load ABI'}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      {notes.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {notes.map((n, i) => (
            <li key={i} className="break-words">{n}</li>
          ))}
        </ul>
      )}

      {loaded && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">ABI source:</span>
            {loaded.targetAbi && <Chip active={loaded.choice === 'target'} onClick={() => setLoaded({ ...loaded, choice: 'target' })}>Contract</Chip>}
            {loaded.implAbi && (
              <Chip active={loaded.choice === 'implementation'} onClick={() => setLoaded({ ...loaded, choice: 'implementation' })}>
                Implementation {loaded.implAddress && shortAddress(loaded.implAddress)}
              </Chip>
            )}
            {loaded.pastedAbi && <Chip active={loaded.choice === 'pasted'} onClick={() => setLoaded({ ...loaded, choice: 'pasted' })}>Pasted</Chip>}
            <button type="button" className="text-indigo-600 hover:underline" onClick={() => setPasteOpen((o) => !o)}>
              {pasteOpen ? 'Hide paste box' : 'Paste ABI instead'}
            </button>
          </div>
        </div>
      )}

      {(pasteOpen || (loaded && !abi)) && (
        <div className="space-y-2">
          <textarea
            className="h-32 w-full rounded border border-slate-300 p-2 font-mono text-xs"
            placeholder='[{"type":"function","name":"...","inputs":[],...}]'
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            disabled={!pasteText.trim()}
            onClick={applyPaste}
          >
            Use pasted ABI
          </button>
          {pasteError && <p className="text-xs text-red-600">{pasteError}</p>}
        </div>
      )}

      {loaded && abi && (
        <div className="space-y-3">
          <div className="flex gap-1 border-b border-slate-200">
            {(['write', 'read'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setSub(t)
                  if (t === 'read') onDraft(null)
                }}
                className={`px-3 py-1.5 text-sm ${sub === t ? 'border-b-2 border-indigo-600 font-medium text-indigo-700' : 'text-slate-500'}`}
              >
                {t === 'write' ? `Write (${writeFns.length})` : `Read (${readFns.length})`}
              </button>
            ))}
          </div>

          {sub === 'write' && (
            <div className="space-y-3">
              {writeFns.length === 0 && <p className="text-sm text-slate-500">This ABI has no state-changing functions.</p>}
              {writeFns.length > 0 && (
                <select
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value)
                    onDraft(null)
                  }}
                >
                  <option value="">Select a function...</option>
                  {writeFns.map((f) => {
                    const sig = functionSignature(f)
                    return (
                      <option key={sig} value={sig}>
                        {sig}
                        {f.stateMutability === 'payable' ? ' (payable)' : ''}
                      </option>
                    )
                  })}
                </select>
              )}
              {selectedFn && (
                <div className="rounded border border-slate-200 bg-white p-3">
                  <WriteForm key={`${loaded.target}:${loaded.choice}:${selected}`} target={loaded.target} fn={selectedFn} onDraft={onDraft} />
                </div>
              )}
            </div>
          )}

          {sub === 'read' && (
            <div className="space-y-2">
              {readFns.length === 0 && <p className="text-sm text-slate-500">This ABI has no view/pure functions.</p>}
              {readFns.map((f) => (
                <ReadForm key={`${loaded.choice}:${functionSignature(f)}`} target={loaded.target} fn={f} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 ${active ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 text-slate-600'}`}
    >
      {children}
    </button>
  )
}
