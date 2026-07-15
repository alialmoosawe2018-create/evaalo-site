type Bucket = {
  count: number;
  windowStart: number;
};

export function createRateLimiter(maxPerMinute: number) {
  const buckets = new Map<string, Bucket>();
  const windowMs = 60_000;

  return (key: string) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (now - bucket.windowStart > windowMs) {
      bucket.windowStart = now;
      bucket.count = 1;
      return true;
    }

    if (bucket.count >= maxPerMinute) return false;
    bucket.count += 1;
    return true;
  };
}
