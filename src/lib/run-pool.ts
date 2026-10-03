/**
 * Run `fn` over `items` with at most `limit` in flight. Never rejects: each
 * result is a PromiseSettledResult in input order. `onProgress` fires after
 * every item settles with the number done so far.
 */
export async function runPool<TItem, TResult>(
  items: ReadonlyArray<TItem>,
  limit: number,
  fn: (item: TItem) => Promise<TResult>,
  onProgress?: (done: number) => void,
): Promise<Array<PromiseSettledResult<TResult>>> {
  const results: Array<PromiseSettledResult<TResult>> = new Array(items.length)
  let next = 0
  let done = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
      onProgress?.(++done)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}
