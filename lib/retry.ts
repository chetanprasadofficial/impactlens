export async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 4,
  baseMs = 2000
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      const temporary = /503|429|overloaded|high demand|UNAVAILABLE/i.test(msg);
      if (!temporary || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i)); // waits 2s, 4s, 8s
    }
  }
  throw lastErr;
}