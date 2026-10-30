import { useState } from 'react'
import type { Abi, AbiFunction, Address } from 'viem'
import { emptyValue, formatValue, functionSignature, parseInputs, type FormValue } from '../../lib/abi/abiForm'
import { getPublicClient } from '../../lib/rpc'
import { friendlyError } from '../../lib/safeErrors'
import { ParamField } from './ParamField'

/** One live read (view/pure) function card; calls only when the button is pressed. */
export function ReadForm({ target, fn }: { target: Address; fn: AbiFunction }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<FormValue[]>(() => fn.inputs.map(emptyValue))
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<{ ok: boolean; text: string } | null>(null)

  async function call() {
    setBusy(true)
    setOut(null)
    try {
      const args = parseInputs(fn.inputs, values)
      const res = await getPublicClient().readContract({
        address: target,
        abi: [fn] as Abi,
        functionName: fn.name,
        args,
      } as never)
      setOut({ ok: true, text: formatResult(fn, res) })
    } catch (e) {
      setOut({ ok: false, text: friendlyError(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{fn.name}</span>
        <span className="font-mono text-xs text-slate-400">{open ? '-' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-3">
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
          <button
            type="button"
            disabled={busy}
            onClick={call}
            className="rounded bg-slate-800 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {busy ? 'Reading...' : 'Query'}
          </button>
          {out && (
            <pre
              className={`overflow-x-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-xs ${
                out.ok ? 'bg-slate-50 text-slate-800' : 'bg-red-50 text-red-700'
              }`}
            >
              {out.text}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function formatResult(fn: AbiFunction, res: unknown): string {
  if (fn.outputs.length === 0) return '(no return value)'
  if (fn.outputs.length === 1) return `${fn.outputs[0].name || 'result'} (${fn.outputs[0].type}): ${formatValue(res)}`
  const arr = Array.isArray(res) ? res : []
  return fn.outputs.map((o, i) => `${o.name || `[${i}]`} (${o.type}): ${formatValue(arr[i])}`).join('\n')
}
