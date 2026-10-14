import { ThermalPolicy, ThermalState } from './types';

export class ThermalController {
  private state: ThermalState = 'nominal';
  private cancelled = false;
  private waiters = new Set<() => void>();

  constructor(private readonly policy: ThermalPolicy = 'adaptive') {}

  get currentState(): ThermalState {
    return this.state;
  }

  get controlMode(): 'normal' | 'reduced' | 'paused' {
    if (this.policy === 'monitor-only') return 'normal';
    if (this.state === 'serious' || this.state === 'critical') return 'reduced';
    return 'normal';
  }

  update(state: ThermalState): void {
    if (state === this.state) return;
    this.state = state;
    this.wake();
  }

  async waitForPreparation(): Promise<boolean> {
    return !this.cancelled;
  }

  async waitForUpload(workerIndex: number): Promise<boolean> {
    if (this.policy === 'monitor-only') return !this.cancelled;
    while (
      !this.cancelled &&
      (this.state === 'serious' || this.state === 'critical') &&
      workerIndex > 0
    ) {
      await this.wait();
    }
    return !this.cancelled;
  }

  cancel(): void {
    this.cancelled = true;
    this.wake();
  }

  private wait(): Promise<void> {
    return new Promise(resolve => this.waiters.add(resolve));
  }

  private wake(): void {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
