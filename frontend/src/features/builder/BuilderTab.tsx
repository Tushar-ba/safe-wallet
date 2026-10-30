import { useMemo, useState } from 'react'

import { parseAddressInput, parseNativeAmount, parseRawCalldata } from '../../lib/abi/abiForm'
import { formatNative, shortAddress } from '../../lib/format'
import type { SafeTabProps } from '../types'
import { ContractMode } from './ContractMode'
import { SubmitPanel } from './SubmitPanel'
import type { TxDraft } from './types'

type Mode = 'contract' | 'native' | 'raw'
const MODES: { id: Mode; label: string }[] = [
  { id: 'contract', label: 'Contract interaction' },
  { id: 'native', label: 'Send native token' },
  { id: 'raw', label: 'Raw calldata' },
]

const inputCls = 'w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm'

/** Phase 4: new transaction builder. */
export function BuilderTab({ safe }: SafeTabProps) {
  const [mode, setMode] = useState<Mode>('contract')
  const [draft, setDraft] = useState<TxDraft | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id)
              setDraft(null)
            }}
            className={`rounded-full border px-3 py-1 text-sm ${
              mode === m.id ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="rounded border border-slate-200 bg-white p-4">
        {mode === 'contract' && <ContractMode onDraft={setDraft} />}
        {mode === 'native' && <NativeMode onDraft={setDraft} />}
        {mode === 'raw' && <RawMode onDraft={setDraft} />}
      </div>

      <SubmitPanel safe={safe} draft={draft} />
    </div>
  )
}

function NativeMode({ onDraft }: { onDraft: (d: TxDraft | null) => void }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [touched, setTouched] = useState(false)

  const state = useMemo(() => {
    const a = parseAddressInput(to)
    const v = parseNativeAmount(amount)
    if (!a.ok) return { error: to ? a.error : undefined, draft: null }
    if (!v.ok) return { error: v.error, draft: null }
    if (v.wei === 0n) return { error: amount ? 'Amount must be greater than 0' : undefined, draft: null }
    const draft: TxDraft = {
      to: a.address,
      value: v.wei,
      data: '0x',
      summary: `Send ${formatNative(v.wei, 18)} POL to ${shortAddress(a.address)}`,
    }
    return { error: undefined, draft }
  }, [to, amount])

  // Emit during render-safe handler: propagate via change handlers below.
  const emit = (nextTo: string, nextAmount: string) => {
    const a = parseAddressInput(nextTo)
    const v = parseNativeAmount(nextAmount)
    if (a.ok && v.ok && v.wei > 0n) {
      onDraft({
        to: a.address,
        value: v.wei,
        data: '0x',
        summary: `Send ${formatNative(v.wei, 18)} POL to ${shortAddress(a.address)}`,
      })
    } else onDraft(null)
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Recipient</span>
        <input
          className={inputCls}
          placeholder="0x..."
          value={to}
          spellCheck={false}
          onChange={(e) => {
            setTo(e.target.value)
            setTouched(true)
            emit(e.target.value, amount)
          }}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Amount (POL)</span>
        <input
          className={inputCls}
          placeholder="0.0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setTouched(true)
            emit(to, e.target.value)
          }}
        />
      </label>
      {touched && state.error && <p className="text-xs text-red-600">{state.error}</p>}
    </div>
  )
}

function RawMode({ onDraft }: { onDraft: (d: TxDraft | null) => void }) {
  const [to, setTo] = useState('')
  const [valueStr, setValueStr] = useState('')
  const [data, setData] = useState('')

  const check = (t: string, v: string, d: string) => {
    const a = parseAddressInput(t)
    const val = parseNativeAmount(v)
    const raw = parseRawCalldata(d)
    if (!a.ok) return { error: t ? a.error : undefined, draft: null }
    if (!val.ok) return { error: `Value: ${val.error}`, draft: null }
    if (!raw.ok) return { error: raw.error, draft: null }
    const draft: TxDraft = {
      to: a.address,
      value: val.wei,
      data: raw.data,
      summary: `Raw call to ${shortAddress(a.address)}`,
    }
    return { error: undefined, draft }
  }
  const current = check(to, valueStr, data)
  const update = (t: string, v: string, d: string) => {
    setTo(t)
    setValueStr(v)
    setData(d)
    onDraft(check(t, v, d).draft)
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">To</span>
        <input className={inputCls} placeholder="0x..." value={to} spellCheck={false} onChange={(e) => update(e.target.value, valueStr, data)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Value (POL, optional)</span>
        <input className={inputCls} placeholder="0" value={valueStr} onChange={(e) => update(to, e.target.value, data)} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Calldata (hex)</span>
        <textarea
          className={`${inputCls} h-24 text-xs`}
          placeholder="0xa9059cbb..."
          value={data}
          spellCheck={false}
          onChange={(e) => update(to, valueStr, e.target.value)}
        />
      </label>
      {current.error && <p className="text-xs text-red-600">{current.error}</p>}
      <p className="text-xs text-slate-500">Raw mode sends the bytes exactly as entered; no decoding is attempted.</p>
    </div>
  )
}

