export const WINDOW_IDLE_MS = 5000;

/** Retain the window and caches; coalesce hidden UI work into one refresh. */
export class WindowActivity {
  private enabled = true;
  private visible = true;
  private dormant = false;
  private dirty = false;
  private hiddenAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private refresh: () => void, private changed: (dormant: boolean) => void = () => {}, private idleMs = WINDOW_IDLE_MS) {}
  private cancel() { clearTimeout(this.timer); this.timer = undefined; }
  private resume() {
    this.cancel();
    if (this.dormant) { this.dormant = false; this.changed(false); }
    if (this.dirty) { this.dirty = false; this.refresh(); }
  }
  private schedule() {
    this.cancel();
    if (!this.enabled || this.visible || this.dormant) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.enabled && !this.visible) { this.dormant = true; this.changed(true); }
    }, Math.max(0, this.idleMs - (Date.now() - this.hiddenAt)));
  }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (enabled) this.schedule(); else this.resume(); }
  hide() { if (this.visible) { this.visible = false; this.hiddenAt = Date.now(); } this.schedule(); }
  show() { this.visible = true; this.resume(); }
  isDormant() { return this.dormant; }
  deferWork() { if (!this.dormant) return false; this.dirty = true; return true; }
  dispose() { this.cancel(); }
}
