/** Placeholder rows while tasks load, announced once to screen readers. */
export function LoadingRows() {
  return <><span className="sr-only" role="status">Loading tasks</span><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/><div className="skeleton-row" aria-hidden="true"/></>
}
