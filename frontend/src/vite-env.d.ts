/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_REOWN_PROJECT_ID?: string
  readonly VITE_DEFAULT_RPC_URL?: string
  readonly VITE_EXPLORER_API_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
