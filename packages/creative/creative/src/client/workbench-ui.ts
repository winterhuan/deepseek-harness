import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Roving-focus keyboard contract shared by every workbench tablist.
 * @param event - the key event on a tab button.
 * @param values - the tablist's values in render order.
 * @param current - the currently selected value.
 * @param select - the selection callback invoked with the next value.
 */
export function handleTabKey<T extends string>(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  let index: number | undefined
  if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = values.length - 1
  else if (event.key === 'ArrowRight') index = (values.indexOf(current) + 1) % values.length
  else if (event.key === 'ArrowLeft') index = (values.indexOf(current) - 1 + values.length) % values.length
  if (index === undefined) return
  event.preventDefault()
  const value = values[index]
  if (value === undefined) return
  select(value)
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']")[index]?.focus()
}

/**
 * Build the absolute URL for one workspace-route call.
 * @param path - route path below `/creative`, e.g. `file` or `media`.
 * @param sessionId - the DSH session the call addresses.
 * @param file - optional workspace-relative path parameter.
 * @returns the URL string all client fetches use.
 */
export function endpoint(path: string, sessionId: string, file?: string): string {
  const url = new URL(`/creative/${path}`, globalThis.location.origin)
  url.searchParams.set('sessionId', sessionId)
  if (file !== undefined) url.searchParams.set('path', file)
  return url.toString()
}
