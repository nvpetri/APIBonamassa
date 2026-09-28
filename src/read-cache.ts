// Process-local, bounded cache. Failed reads and invalidated in-flight reads
// never become reusable entries. Different stores/periods use different keys.
export class ReadCache<T> {
  private readonly entries = new Map<
    string,
    { expires: number; value: Promise<T> }
  >();
  constructor(
    private readonly ttl = 15_000,
    private readonly limit = 100,
    private readonly now = Date.now,
  ) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) return existing.value;
    this.entries.delete(key);
    for (const [id, entry] of this.entries)
      if (entry.expires <= this.now()) this.entries.delete(id);
    while (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value!);
    const entry = {
      expires: this.now() + this.ttl,
      value: Promise.resolve().then(load),
    };
    this.entries.set(key, entry);
    void entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return entry.value;
  }
  invalidate(prefix: string) {
    for (const key of this.entries.keys())
      if (key.startsWith(prefix)) this.entries.delete(key);
  }
}
