import { strict as assert } from "node:assert";
import { test } from "node:test";
import { encodeResult, resultHash } from "../src/shared/result.ts";
import { RULESET_VERSION } from "../src/shared/constants.ts";
import type { CanonicalResult } from "../src/shared/types.ts";

const base: CanonicalResult = {
  game: "satoshi-scramble",
  ruleset: RULESET_VERSION,
  matchId: 12345n,
  roomId: "ROOM-01",
  entry: 10_000n,
  players: [
    { id: "11".repeat(32), banked: 300n },
    { id: "22".repeat(32), banked: 150n },
  ],
  rankings: [0, 1],
  startTs: 1_700_000_000,
  endTs: 1_700_000_090,
};

test("canonical encoding is deterministic and fixed-length", () => {
  const a = encodeResult(base);
  const b = encodeResult({ ...base, players: [...base.players] });
  assert.deepEqual([...a], [...b]);
  // ruleset(11) + id(8) + entry(8) + n(1) + n*(32+8) + n(1 each rank) + 2*8
  assert.equal(a.length, 11 + 8 + 8 + 1 + 2 * 40 + 2 + 16);
});

test("hash changes when any field changes", () => {
  const h0 = resultHash(base);
  assert.notEqual(h0, resultHash({ ...base, matchId: 12346n }));
  assert.notEqual(h0, resultHash({ ...base, rankings: [1, 0] }));
  assert.notEqual(h0, resultHash({
    ...base, players: [{ id: "11".repeat(32), banked: 301n }, base.players[1]!],
  }));
  assert.equal(h0, resultHash({ ...base })); // stable
  assert.match(h0, /^[0-9a-f]{64}$/);
});

test("wrong ruleset is rejected", () => {
  assert.throws(() => encodeResult({ ...base, ruleset: "SCRAMBLE_V2" }));
});
