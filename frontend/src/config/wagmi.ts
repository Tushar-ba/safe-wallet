import { createConfig, custom, type Config } from 'wagmi'
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { polygonAmoy } from '@reown/appkit/networks'
import { env } from './env'
import { getPublicClient } from '../lib/rpc'

/** true when VITE_REOWN_PROJECT_ID is set; otherwise the wallet UI shows a config notice. */
export const appKitEnabled = env.reownProjectId.length > 0

/**
 * wagmi reads go through the SAME shared viem client as the rest of the app
 * (looked up per request, so changing the RPC in Settings takes effect immediately).
 */
const sharedTransport = custom({
  request: ({ method, params }: { method: string; params?: unknown }) =>
    getPublicClient().request({ method, params } as never) as Promise<never>,
})
const transports = { [polygonAmoy.id]: sharedTransport }

function build(): Config {
  if (!appKitEnabled) {
    return createConfig({ chains: [polygonAmoy], transports, connectors: [] })
  }
  const adapter = new WagmiAdapter({
    projectId: env.reownProjectId,
    networks: [polygonAmoy],
    transports,
    ssr: false,
  })
  createAppKit({
    adapters: [adapter],
    projectId: env.reownProjectId,
    networks: [polygonAmoy],
    defaultNetwork: polygonAmoy,
    metadata: {
      name: 'Safe Multisig (Amoy)',
      description: 'Backend-less Safe multisig on Polygon Amoy',
      url: window.location.origin,
      icons: [],
    },
    features: { analytics: false, email: false, socials: false },
  })
  return adapter.wagmiConfig as Config
}

export const wagmiConfig: Config = build()
