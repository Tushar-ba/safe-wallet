import { useCallback, useRef, useState } from 'react'
import { useWriteContract } from 'wagmi'
import type { Abi, Hex, TransactionReceipt } from 'viem'
import { polygonAmoy } from 'viem/chains'
import { getPublicClient } from '../lib/rpc'
import { txUrl } from '../lib/explorer'
import { friendlyError } from '../lib/safeErrors'

export type TxStatus = 'idle' | 'awaiting-wallet' | 'pending' | 'confirmed' | 'reverted' | 'error'

export interface TxRequest {
  address: `0x${string}`
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  /** native value in wei */
  value?: bigint
  gas?: bigint
}

export interface UseTxActionOptions {
  /** Called once the receipt shows success. Invalidate affected queries here. */
  onConfirmed?: (receipt: TransactionReceipt, hash: Hex) => void | Promise<void>
}

/**
 * writeContract -> wait for receipt (via the shared RPC client) -> status/hash/explorer link/error.
 *
 *   const tx = useTxAction({ onConfirmed: () => qc.invalidateQueries({ queryKey: safeKeys.all(safe) }) })
 *   await tx.run({ address: safe, abi: safeAbi, functionName: 'approveHash', args: [hash] })
 *   tx.status, tx.hash, tx.explorerUrl, tx.error, tx.isBusy, tx.reset()
 */
export function useTxAction(options: UseTxActionOptions = {}) {
  const { writeContractAsync } = useWriteContract()
  const [status, setStatus] = useState<TxStatus>('idle')
  const [hash, setHash] = useState<Hex | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [receipt, setReceipt] = useState<TransactionReceipt | undefined>()
  const onConfirmed = useRef(options.onConfirmed)
  onConfirmed.current = options.onConfirmed

  const reset = useCallback(() => {
    setStatus('idle')
    setHash(undefined)
    setError(undefined)
    setReceipt(undefined)
  }, [])

  const run = useCallback(
    async (req: TxRequest): Promise<Hex | undefined> => {
      setStatus('awaiting-wallet')
      setHash(undefined)
      setError(undefined)
      setReceipt(undefined)
      let h: Hex
      try {
        h = await writeContractAsync({ ...req, chainId: polygonAmoy.id } as never)
      } catch (e) {
        setError(friendlyError(e))
        setStatus('error')
        return undefined
      }
      setHash(h)
      setStatus('pending')
      try {
        const r = await getPublicClient().waitForTransactionReceipt({ hash: h, timeout: 120_000 })
        setReceipt(r)
        if (r.status === 'success') {
          setStatus('confirmed')
          await onConfirmed.current?.(r, h)
        } else {
          setStatus('reverted')
          setError('The transaction was mined but reverted.')
        }
      } catch (e) {
        setError(friendlyError(e))
        setStatus('error')
      }
      return h
    },
    [writeContractAsync],
  )

  return {
    run,
    reset,
    status,
    hash,
    receipt,
    error,
    explorerUrl: hash ? txUrl(hash) : undefined,
    isBusy: status === 'awaiting-wallet' || status === 'pending',
  }
}
