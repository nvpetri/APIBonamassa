import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadCache } from "../src/read-cache";

test("coalesces concurrent reads, isolates keys and expires results", async () => {
  let now = 0,
    calls = 0;
  const cache = new ReadCache<number>(15, 100, () => now);
  const read = async () => ++calls;
  assert.deepEqual(
    await Promise.all([cache.get("a:today", read), cache.get("a:today", read)]),
    [1, 1],
  );
  assert.equal(await cache.get("b:today", read), 2);
  assert.equal(await cache.get("a:yesterday", read), 3);
  now = 15;
  assert.equal(await cache.get("a:today", read), 4);
});
test("invalidation during an in-flight read cannot repopulate stale data", async () => {
  const cache = new ReadCache<number>();
  let resolve!: (value: number) => void;
  const pending = cache.get(
    "a:today",
    () =>
      new Promise<number>((done) => {
        resolve = done;
      }),
  );
  await Promise.resolve();
  cache.invalidate("a:");
  assert.equal(await cache.get("a:today", async () => 2), 2);
  resolve(1);
  await pending;
  assert.equal(await cache.get("a:today", async () => 3), 2);
});
test("failed reads are retried and capacity is bounded", async () => {
  const cache = new ReadCache<number>(1000, 1);
  await assert.rejects(
    cache.get("a", async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(await cache.get("a", async () => 1), 1);
  assert.equal(await cache.get("b", async () => 2), 2);
  assert.equal(await cache.get("a", async () => 3), 3);
});
