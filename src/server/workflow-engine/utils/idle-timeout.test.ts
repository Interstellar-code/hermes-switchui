import { describe, test, expect, vi } from 'vitest';
import { withIdleTimeout, STEP_IDLE_TIMEOUT_MS } from './idle-timeout';

/** Helper: create an async generator from an array of values with optional delays */
async function* fromValues<T>(values: T[], delayMs = 0): AsyncGenerator<T> {
  for (const value of values) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    yield value;
  }
}

/** Helper: create an async generator that hangs after yielding N values */
async function* hangAfter<T>(values: T[], _hangForever = true): AsyncGenerator<T> {
  for (const value of values) {
    yield value;
  }
  // Hang indefinitely — simulates a subprocess that completed work but won't exit
  await new Promise<void>(() => {});
}

describe('withIdleTimeout', () => {
  test('exports a default timeout constant', () => {
    expect(STEP_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });

  test('passes through all values from a normal generator', async () => {
    const values = [1, 2, 3, 4, 5];
    const result: number[] = [];

    for await (const v of withIdleTimeout(fromValues(values), 1000)) {
      result.push(v);
    }

    expect(result).toEqual(values);
  });

  test('handles empty generator', async () => {
    const result: number[] = [];

    for await (const v of withIdleTimeout(fromValues<number>([]), 1000)) {
      result.push(v);
    }

    expect(result).toEqual([]);
  });

  test('fires onTimeout and exits when generator hangs', async () => {
    const onTimeout = vi.fn();
    const result: string[] = [];

    for await (const v of withIdleTimeout(hangAfter(['a', 'b', 'c']), 50, onTimeout)) {
      result.push(v);
    }

    expect(result).toEqual(['a', 'b', 'c']);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('exits without onTimeout callback when generator hangs', async () => {
    const result: string[] = [];

    for await (const v of withIdleTimeout(hangAfter(['x', 'y']), 50)) {
      result.push(v);
    }

    expect(result).toEqual(['x', 'y']);
  });

  test('does not fire onTimeout for a slow but completing generator', async () => {
    const onTimeout = vi.fn();
    const result: number[] = [];

    for await (const v of withIdleTimeout(fromValues([1, 2, 3], 20), 200, onTimeout)) {
      result.push(v);
    }

    expect(result).toEqual([1, 2, 3]);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('resets timeout between values', async () => {
    const onTimeout = vi.fn();

    const result: number[] = [];
    for await (const v of withIdleTimeout(fromValues([1, 2, 3, 4], 30), 50, onTimeout)) {
      result.push(v);
    }

    expect(result).toEqual([1, 2, 3, 4]);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  test('works with generator that yields objects', async () => {
    type Msg = { type: string; content?: string };
    const messages: Msg[] = [
      { type: 'assistant', content: 'hello' },
      { type: 'tool', content: 'running' },
      { type: 'result' },
    ];
    const result: Msg[] = [];

    for await (const v of withIdleTimeout(fromValues(messages), 1000)) {
      result.push(v);
    }

    expect(result).toEqual(messages);
  });

  test('consumer breaking out cleans up normally', async () => {
    const result: number[] = [];

    for await (const v of withIdleTimeout(fromValues([1, 2, 3, 4, 5]), 1000)) {
      result.push(v);
      if (v === 2) break;
    }

    expect(result).toEqual([1, 2]);
  });

  test('shouldResetTimer predicate: does not reset timer on filtered events', async () => {
    type Msg = { type: string };
    const onTimeout = vi.fn();
    const result: Msg[] = [];

    async function* toolThenHang(): AsyncGenerator<Msg> {
      yield { type: 'assistant' };
      yield { type: 'tool' };
      await new Promise<void>(() => {});
    }

    for await (const v of withIdleTimeout(
      toolThenHang(),
      100,
      onTimeout,
      msg => msg.type !== 'tool'
    )) {
      result.push(v);
    }

    expect(result).toEqual([{ type: 'assistant' }, { type: 'tool' }]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('shouldResetTimer predicate: resets timer on non-filtered events', async () => {
    type Msg = { type: string };
    const onTimeout = vi.fn();
    const result: Msg[] = [];

    async function* toolThenRecover(): AsyncGenerator<Msg> {
      yield { type: 'assistant' };
      yield { type: 'tool' };
      await new Promise(r => setTimeout(r, 20));
      yield { type: 'assistant' };
      await new Promise<void>(() => {});
    }

    for await (const v of withIdleTimeout(
      toolThenRecover(),
      150,
      onTimeout,
      msg => msg.type !== 'tool'
    )) {
      result.push(v);
    }

    expect(result).toEqual([{ type: 'assistant' }, { type: 'tool' }, { type: 'assistant' }]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  test('without shouldResetTimer, tool events reset timer (original behavior)', async () => {
    type Msg = { type: string };
    const onTimeout = vi.fn();
    const result: Msg[] = [];

    async function* toolThenHang(): AsyncGenerator<Msg> {
      yield { type: 'assistant' };
      yield { type: 'tool' };
      await new Promise<void>(() => {});
    }

    for await (const v of withIdleTimeout(toolThenHang(), 100, onTimeout)) {
      result.push(v);
    }

    expect(result).toEqual([{ type: 'assistant' }, { type: 'tool' }]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
