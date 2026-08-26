import { ClientMetricsReporter } from './ClientMetricsReporter';

describe('ClientMetricsReporter', () => {
  afterEach(() => jest.useRealTimers());

  it('coalesces progress, serializes samples, and finishes with zero', async () => {
    jest.useFakeTimers();
    let now = 0;
    const sent: [string, number][] = [];
    const reporter = new ClientMetricsReporter(
      'ios-session-1',
      async (sessionId, bytesPerSecond) => { sent.push([sessionId, bytesPerSecond]); },
      { now: () => now, intervalMs: 1000 },
    );

    reporter.recordCurrentMediaRate(10);
    await Promise.resolve();
    expect(sent).toEqual([['ios-session-1', 10_000_000]]);

    now = 200;
    reporter.recordCurrentMediaRate(20);
    reporter.recordCurrentMediaRate(30);
    now = 1000;
    await jest.advanceTimersByTimeAsync(800);
    expect(sent).toEqual([
      ['ios-session-1', 10_000_000],
      ['ios-session-1', 30_000_000],
    ]);

    await reporter.finish();
    expect(sent.at(-1)).toEqual(['ios-session-1', 0]);
  });

  it('swallows telemetry transport failures', async () => {
    const reporter = new ClientMetricsReporter(
      'ios-session-2',
      async () => { throw new Error('metrics unavailable'); },
    );

    reporter.recordCurrentMediaRate(5);
    await expect(reporter.finish()).resolves.toBeUndefined();
  });
});
