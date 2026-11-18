'use client'

import { environmentHeader } from '@/shared/delivery'

export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  const environment = document.documentElement.dataset.environment
  if (environment) headers.set(environmentHeader, environment)
  const response = await fetch(path, { cache: 'no-store', ...options, headers })
  const result = await response.json().catch(() => null)
  if (!response.ok || result === null) {
    throw new Error(result?.error?.message || 'The application could not complete the request.')
  }
  return result
}

export function post<T>(path: string, body?: object) {
  return requestJson<T>(path, {
    method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
}

export function errorMessage(error: unknown) {
  if (error instanceof TypeError) return 'Could not reach RelayDesk. Check your connection and try again.'
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}
