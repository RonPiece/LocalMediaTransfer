/** Delays queue-wait notices and holds them briefly to avoid flashing the UI. */
export class QueueNotice {
  private isWaiting = false;
  private shown = false;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly isActive: () => boolean,
    private readonly uploadStarted: () => boolean,
    private readonly setVisible: (visible: boolean) => void) {}
  get waiting(): boolean { return this.isWaiting; }

  update(waiting: boolean): void {
    if (!this.isActive()) return;
    this.isWaiting = waiting;
    if (waiting) {
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = null;
      if (!this.uploadStarted() || this.shown || this.showTimer) return;
      this.showTimer = setTimeout(() => {
        this.showTimer = null;
        if (!this.isActive() || !this.isWaiting || !this.uploadStarted()) return;
        this.shown = true;
        this.setVisible(true);
      }, 1000);
      return;
    }
    if (this.showTimer) clearTimeout(this.showTimer);
    this.showTimer = null;
    if (!this.shown || this.hideTimer) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.isActive() || this.isWaiting) return;
      this.shown = false;
      this.setVisible(false);
    }, 750);
  }

  dispose(): void {
    if (this.showTimer) clearTimeout(this.showTimer);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.showTimer = this.hideTimer = null;
  }
}
