export const EXPLORER_BASE = 'https://amoy.polygonscan.com'

export const txUrl = (hash: string): string => `${EXPLORER_BASE}/tx/${hash}`
export const addressUrl = (address: string): string => `${EXPLORER_BASE}/address/${address}`
