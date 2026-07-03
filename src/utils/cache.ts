type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function createCacheKey(...parts: unknown[]) {
  return parts.map(stableSerialize).join('|');
}

export class TtlCache<TValue> {
  private readonly entries = new Map<string, CacheEntry<TValue>>();
  private readonly pending = new Map<string, Promise<TValue>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  async getOrSet(key: string, loader: () => Promise<TValue>): Promise<TValue> {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      return loader();
    }

    const cachedValue = this.get(key);

    if (cachedValue !== undefined) {
      return cachedValue;
    }

    const pendingValue = this.pending.get(key);

    if (pendingValue) {
      return pendingValue;
    }

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  get(key: string): TValue | undefined {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: TValue): void {
    this.entries.set(key, {
      expiresAt: Date.now() + this.ttlMs,
      value
    });
    this.prune();
  }

  private prune(): void {
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;

      if (!oldestKey) {
        return;
      }

      this.entries.delete(oldestKey);
    }
  }
}
