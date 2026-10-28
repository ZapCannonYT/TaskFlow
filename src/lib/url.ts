/** Removes handled query parameters from the address bar without adding a history entry. */
export function dropParams(params: URLSearchParams, ...keys: string[]) {
  for (const key of keys) params.delete(key)
  window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
}
