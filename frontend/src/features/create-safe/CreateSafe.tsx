import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { getAddress, isAddress, type Address } from 'viem'
import { polygonAmoy } from 'viem/chains'
import { deployments } from '../../config/deployments'
import { safeProxyFactoryAbi } from '../../lib/abis'
import { addressUrl } from '../../lib/explorer'
import { useTxAction } from '../../hooks/useTxAction'
import { savedSafesStore } from '../home/savedSafes'
import { encodeSetupInitializer, parseProxyCreation, randomSaltNonce, validateSafeSetup } from './logic'

export function CreateSafe() {
  const navigate = useNavigate()
  const { address: account, isConnected, chainId } = useAccount()
  const [owners, setOwners] = useState<string[]>([''])
  const [threshold, setThreshold] = useState(1)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<Address | null>(null)
  const [noEvent, setNoEvent] = useState(false)
  const prefilled = useRef(false)

  // Default the first row to the connected wallet (once).
  useEffect(() => {
    if (account && !prefilled.current) {
      prefilled.current = true
      setOwners((o) => (o.length === 1 && o[0] === '' ? [account] : o))
    }
  }, [account])

  const tx = useTxAction({
    onConfirmed: (receipt) => {
      const proxy = parseProxyCreation(receipt, deployments.proxyFactory as Address)
      if (!proxy) {
        setNoEvent(true)
        return
      }
      savedSafesStore.add(proxy, name)
      setCreated(proxy)
    },
  })

  const v = useMemo(() => validateSafeSetup(owners, threshold), [owners, threshold])
  const wrongNetwork = isConnected && chainId !== polygonAmoy.id
  const canSubmit = v.valid && isConnected && !wrongNetwork && !tx.isBusy && !created

  // keep threshold within bounds as owners are removed
  useEffect(() => {
    if (threshold > owners.length) setThreshold(Math.max(1, owners.length))
  }, [owners.length, threshold])

  async function submit() {
    if (!canSubmit) return
    const list = owners.map((o) => getAddress(o.trim()))
    const initializer = encodeSetupInitializer(list, threshold, deployments.fallbackHandler as Address)
    setNoEvent(false)
    await tx.run({
      address: deployments.proxyFactory as Address,
      abi: safeProxyFactoryAbi,
      functionName: 'createProxyWithNonce',
      args: [deployments.safeSingleton, initializer, randomSaltNonce()],
    })
  }

  if (created) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-lg border border-emerald-200 bg-white p-4 shadow-sm sm:p-6">
        <h1 className="text-lg font-semibold text-emerald-800">Safe created</h1>
        <p className="break-all font-mono text-sm">{created}</p>
        <p className="text-sm text-slate-600">It was added to the saved Safes list in this browser.</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate(`/safe/${created}`)}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Open Safe
          </button>
          <a href={addressUrl(created)} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
            View on Polygonscan
          </a>
          {tx.explorerUrl && (
            <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
              Creation transaction
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Create new Safe</h1>
        <Link to="/" className="text-sm text-indigo-700 underline">
          Back
        </Link>
      </div>

      {!isConnected && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Connect a wallet (on Polygon Amoy) to create a Safe.</p>}
      {wrongNetwork && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Switch your wallet to Polygon Amoy (80002).</p>}

      <div>
        <label htmlFor="safe-name" className="block text-sm font-medium">
          Nickname (optional)
        </label>
        <input
          id="safe-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Owners</legend>
        {owners.map((o, i) => (
          <div key={i}>
            <div className="flex gap-2">
              <input
                value={o}
                onChange={(e) => setOwners((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`Owner #${i + 1} address (0x...)`}
                aria-label={`Owner ${i + 1} address`}
                spellCheck={false}
                className={`min-w-0 flex-1 rounded border px-3 py-2 font-mono text-xs sm:text-sm ${
                  v.rowErrors[i] && o ? 'border-red-400' : 'border-slate-300'
                }`}
              />
              <button
                type="button"
                disabled={owners.length === 1}
                onClick={() => setOwners((l) => l.filter((_, j) => j !== i))}
                className="rounded border border-slate-300 px-2 text-sm hover:bg-slate-100 disabled:opacity-40"
                aria-label={`Remove owner ${i + 1}`}
              >
                Remove
              </button>
            </div>
            {v.rowErrors[i] && o.trim() !== '' && <p className="mt-1 text-xs text-red-700">{v.rowErrors[i]}</p>}
            {account && isAddress(o.trim(), { strict: false }) && o.trim().toLowerCase() === account.toLowerCase() && (
              <p className="mt-1 text-xs text-slate-500">This is your connected wallet.</p>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOwners((l) => [...l, ''])}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
          >
            Add owner
          </button>
          {account && !owners.some((o) => o.trim().toLowerCase() === account.toLowerCase()) && (
            <button
              type="button"
              onClick={() => setOwners((l) => [...l, account])}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100"
            >
              Add my wallet
            </button>
          )}
        </div>
      </fieldset>

      <div>
        <label htmlFor="threshold" className="block text-sm font-medium">
          Threshold
        </label>
        <div className="mt-1 flex items-center gap-2 text-sm">
          <select
            id="threshold"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {owners.map((_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
          <span>of {owners.length} owner(s) must confirm each transaction</span>
        </div>
        {v.thresholdError && <p className="mt-1 text-xs text-red-700">{v.thresholdError}</p>}
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {tx.status === 'awaiting-wallet' ? 'Confirm in your wallet...' : tx.status === 'pending' ? 'Creating Safe...' : 'Create Safe'}
      </button>
      <p className="text-xs text-slate-500">You pay the gas for the deployment. Owners and threshold can be viewed later on the Owners tab.</p>

      {tx.error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{tx.error}</p>}
      {tx.hash && !tx.error && tx.status === 'pending' && (
        <p className="text-sm">
          Transaction sent:{' '}
          <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">
            view on Polygonscan
          </a>
        </p>
      )}
      {noEvent && (
        <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          The transaction confirmed but no ProxyCreation event was found.{' '}
          {tx.explorerUrl && (
            <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="underline">
              Check it on Polygonscan
            </a>
          )}{' '}
          and open the Safe by address from Home.
        </p>
      )}
    </div>
  )
}
