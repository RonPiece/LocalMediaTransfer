export class BoundedAsyncQueue<T> {
  private items: T[] = [];
  private waitingConsumers: ((value: T | null) => void)[] = [];
  private waitingProducers: (() => void)[] = [];
  private closed = false;
  private observedMaxDepth = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Queue capacity must be a positive integer');
    }
  }

  get maxDepth(): number {
    return this.observedMaxDepth;
  }

  get depth(): number {
    return this.items.length;
  }

  async push(
    value: T,
    onCapacityWaitChange?: (waiting: boolean) => void,
  ): Promise<void> {
    let waiting = false;
    try {
      while (!this.closed && this.items.length >= this.capacity) {
        if (!waiting) {
          waiting = true;
          onCapacityWaitChange?.(true);
        }
        await new Promise<void>(resolve => this.waitingProducers.push(resolve));
      }
      if (this.closed) throw new Error('Queue is closed');
      const consumer = this.waitingConsumers.shift();
      if (consumer) {
        consumer(value);
        return;
      }
      this.items.push(value);
      this.observedMaxDepth = Math.max(this.observedMaxDepth, this.items.length);
    } finally {
      if (waiting) onCapacityWaitChange?.(false);
    }
  }

  async shift(): Promise<T | null> {
    const value = this.items.shift();
    if (value !== undefined) {
      this.waitingProducers.shift()?.();
      return value;
    }
    if (this.closed) return null;
    return new Promise<T | null>(resolve => this.waitingConsumers.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const resolve of this.waitingConsumers.splice(0)) resolve(null);
    for (const resolve of this.waitingProducers.splice(0)) resolve();
  }
}
