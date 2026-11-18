/** Bounded, deduplicated media requests. Cancelled off-screen work never reaches IPC. */
export class MediaCache<K> {
  private values = new Map<K, { value: string; bytes: number }>();
  private pending = new Map<K, { signals: Set<AbortSignal>; promise: Promise<string | null> }>();
  private queue: (() => void)[] = [];
  private active = 0;
  private bytes = 0;
  private epoch=0;
  generation(){return this.epoch;}
  clear(){this.epoch++;this.values.clear();this.bytes=0;this.revisions.clear();this.pending.clear();}
  private revisions = new Map<K,number>();
  invalidate(key:K) { const value=this.values.get(key); if(value){this.bytes-=value.bytes;this.values.delete(key);} this.revisions.set(key,(this.revisions.get(key)??0)+1); }
  constructor(private load: (key: K) => Promise<string | null>, private maxBytes = 8 * 1024 * 1024, private maxEntries = 64, private concurrency = 2) {}

  revision(key:K):number { return this.revisions.get(key)??0; }
  peek(key: K): string | null {
    return this.values.get(key)?.value ?? null;
  }

  touch(key: K): string | null {
    const cached = this.values.get(key);
    if (!cached) return null;
    this.values.delete(key);
    this.values.set(key, cached);
    return cached.value;
  }

  get(key: K, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return Promise.resolve(null);
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      this.values.set(key, cached);
      return Promise.resolve(cached.value);
    }
    const previous = this.pending.get(key);
    if (previous) { previous.signals.add(signal); return previous.promise; }
    const signals = new Set([signal]);
    let resolve!: (value: string | null) => void;
    const promise = new Promise<string | null>(done => { resolve = done; });
    const generation=this.epoch;
    const revision=this.revisions.get(key)??0;
    this.pending.set(key, { signals, promise });
    this.queue.push(() => {
      if (generation!==this.epoch||[...signals].every(signal => signal.aborted)) {
        if(this.pending.get(key)?.promise===promise)this.pending.delete(key);
        resolve(null);
        return;
      }
      this.active += 1;
      void Promise.resolve().then(() => this.load(key)).catch(() => null).then(value => {
        // Strings are budgeted conservatively at two bytes per UTF-16 code unit.
        if (generation!==this.epoch||(this.revisions.get(key)??0)!==revision) value=null;
        if (value && value.length * 2 <= this.maxBytes) {
          const bytes = value.length * 2;
          this.values.set(key, { value, bytes });
          this.bytes += bytes;
          while (this.bytes > this.maxBytes || this.values.size > this.maxEntries) {
            const oldest = this.values.keys().next().value as K;
            this.bytes -= this.values.get(oldest)!.bytes;
            this.values.delete(oldest);
          }
        }
        if(this.pending.get(key)?.promise===promise)this.pending.delete(key);
        resolve(value);
        this.active -= 1;
        this.pump();
      });
    });
    this.pump();
    return promise;
  }
  private pump() {
    while (this.active < this.concurrency && this.queue.length) this.queue.shift()!();
  }
}
