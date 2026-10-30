import { useEffect, useMemo, useState } from 'react'
import type { AbiFunction, Address } from 'viem'
import {
  decodeCall,
  emptyValue,
  encodeCall,
  functionSignature,
  parseNativeAmount,
  type FormValue,
} from '../../lib/abi/abiForm'
import { shortAddress } from '../../lib/format'
import { ParamField } from './ParamField'
import type { TxDraft } from './types'

interface Props {
  target: Address
  fn: AbiFunction
  onDraft: (d: TxDraft | null) => void
}

/** Generated form for one write function. Emits a validated TxDraft (or null while invalid). */
export function WriteForm({ target, fn, onDraft }: Props) {
  const [values, setValues] = useState<FormValue[]>(() => fn.inputs.map(emptyValue))
  const [valueStr, setValueStr] = useState('')
  const payable = fn.stateMutability === 'payable'

  const result = useMemo(() => {
    const enc = encodeCall(fn, values)
    if (!enc.ok) return { error: enc.error } as const
    const amount = payable ? parseNativeAmount(valueStr) : ({ ok: true, wei: 0n } as const)
    if (!amount.ok) return { error: `value: ${amount.error}` } as const
    const draft: TxDraft = {
      to: target,
      value: amount.wei,
      data: enc.data,
      summary: `${fn.name} on ${shortAddress(target)}`,
      decoded: decodeCall(fn, enc.data),
    }
    return { draft } as const
  }, [fn, values, valueStr, payable, target])

  useEffect(() => {
    onDraft('draft' in result ? (result.draft ?? null) : null)
  }, [result, onDraft])
  useEffect(() => () => onDraft(null), [onDraft])

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-slate-500">{functionSignature(fn)}</p>
      {fn.inputs.map((p, i) => (
        <ParamField
          key={i}
          param={p}
          label={p.name || `arg${i}`}
          value={values[i]}
          onChange={(v) => setValues((cur) => cur.map((x, j) => (j === i ? v : x)))}
        />
      ))}
      {fn.inputs.length === 0 && <p className="text-xs text-slate-500">This function takes no arguments.</p>}
      {payable && (
        <label className="block">
          <span className="mb-0.5 block text-xs font-medium text-slate-600">Value to send (POL, optional)</span>
          <input
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs"
            value={valueStr}
            placeholder="0"
            inputMode="decimal"
            onChange={(e) => setValueStr(e.target.value)}
          />
        </label>
      )}
      {'error' in result && <p className="text-xs text-red-600">{result.error}</p>}
    </div>
  )
}
