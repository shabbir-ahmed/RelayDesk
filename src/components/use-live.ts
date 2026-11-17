'use client'

import { useEffect, useState } from 'react'
import { errorMessage } from './client-http'

export function useLive<T>(key: string, load: (signal: AbortSignal) => Promise<T>, initial?: T, revision = 0) {
  const [snapshot, setSnapshot] = useState<{ key: string; data?: T; error?: string }>({ key, data: initial })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    const stop = () => {
      controller?.abort()
      clearTimeout(timer)
    }

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      controller = new AbortController()
      const { signal } = controller
      try {
        const data = await load(signal)
        if (!signal.aborted) setSnapshot({ key, data })
      } catch (error) {
        if (!signal.aborted) {
          setSnapshot((current) => ({ key, data: current.key === key ? current.data : undefined, error: errorMessage(error) }))
        }
      } finally {
        if (!signal.aborted) timer = setTimeout(refresh, 3_000)
      }
    }

    const visibility = () => {
      stop()
      void refresh()
    }
    document.addEventListener('visibilitychange', visibility)
    void refresh()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [key, load, revision])

  return snapshot.key === key ? snapshot : { data: undefined, error: undefined }
}
