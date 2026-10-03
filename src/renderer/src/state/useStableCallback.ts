import { useCallback, useLayoutEffect, useRef } from 'react'

/** A callback whose identity never changes but always runs the latest render's
 * implementation, so memoized children are not invalidated by inline handlers. */
export function useStableCallback<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const latest = useRef(callback)
  useLayoutEffect(() => { latest.current = callback })
  return useCallback((...args: A) => latest.current(...args), [])
}
