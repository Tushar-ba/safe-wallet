export const env = {
  reownProjectId: (import.meta.env.VITE_REOWN_PROJECT_ID ?? '').trim(),
  defaultRpcUrl: (import.meta.env.VITE_DEFAULT_RPC_URL ?? '').trim(),
  explorerApiKey: (import.meta.env.VITE_EXPLORER_API_KEY ?? '').trim(),
}

export const missingEnv: string[] = [
  ...(env.reownProjectId ? [] : ['VITE_REOWN_PROJECT_ID']),
  ...(env.defaultRpcUrl ? [] : ['VITE_DEFAULT_RPC_URL']),
]
