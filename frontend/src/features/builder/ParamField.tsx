import type { AbiParameter } from 'viem'
import { emptyValue, isTupleParam, splitArrayType, type FormValue } from '../../lib/abi/abiForm'

interface Props {
  param: AbiParameter
  value: FormValue
  onChange: (v: FormValue) => void
  label: string
  depth?: number
  /** Error message for this exact field (scalars only) */
  error?: string
}

const inputCls =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs focus:border-indigo-500 focus:outline-none'

/** Recursive generated input for any ABI parameter (scalars, arrays, tuples, nested). */
export function ParamField({ param, value, onChange, label, depth = 0, error }: Props) {
  const arr = splitArrayType(param)

  if (arr) {
    const list = Array.isArray(value) ? value : []
    const fixed = arr.length !== undefined
    return (
      <fieldset className="rounded border border-slate-200 p-2" style={{ marginLeft: depth ? 4 : 0 }}>
        <legend className="px-1 text-xs font-medium text-slate-600">
          {label} <span className="font-mono text-slate-400">{param.type}</span>
        </legend>
        <div className="space-y-2">
          {list.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <ParamField
                  param={arr.element}
                  value={item}
                  label={`[${i}]`}
                  depth={depth + 1}
                  onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))}
                />
              </div>
              {!fixed && (
                <button
                  type="button"
                  className="mt-5 text-xs text-red-600 hover:underline"
                  onClick={() => onChange(list.filter((_, j) => j !== i))}
                >
                  remove
                </button>
              )}
            </div>
          ))}
          {!fixed && (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
              onClick={() => onChange([...list, emptyValue(arr.element)])}
            >
              + Add item
            </button>
          )}
          {!fixed && list.length === 0 && <p className="text-xs text-slate-400">Empty list</p>}
        </div>
      </fieldset>
    )
  }

  if (isTupleParam(param)) {
    const list = Array.isArray(value) ? value : []
    return (
      <fieldset className="rounded border border-slate-200 p-2">
        <legend className="px-1 text-xs font-medium text-slate-600">
          {label} <span className="font-mono text-slate-400">tuple</span>
        </legend>
        <div className="space-y-2">
          {param.components.map((c, i) => (
            <ParamField
              key={i}
              param={c}
              value={list[i] ?? emptyValue(c)}
              label={c.name || `field${i}`}
              depth={depth + 1}
              onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))}
            />
          ))}
        </div>
      </fieldset>
    )
  }

  const str = typeof value === 'string' ? value : ''
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs font-medium text-slate-600">
        {label} <span className="font-mono text-slate-400">{param.type}</span>
      </span>
      {param.type === 'bool' ? (
        <select className={inputCls} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : (
        <input
          className={inputCls}
          value={str}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholderFor(param.type)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && <span className="mt-0.5 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

function placeholderFor(type: string): string {
  if (type === 'address') return '0x...'
  if (type.startsWith('bytes')) return '0x...'
  if (type.startsWith('uint')) return '0'
  if (type.startsWith('int')) return '0'
  return ''
}
