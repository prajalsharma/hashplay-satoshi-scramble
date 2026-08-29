import { strict as assert } from "node:assert";
import { test } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { signChallengeBip322, verifyChallengeBip322 } from "../src/arch/bip322.ts";

test("BIP-322 sign→verify round trips; tamper fails", () => {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const pk = schnorr.getPublicKey(sk);
  const challenge = new TextEncoder().encode("a3".repeat(32)); // 64-hex-string style
  const sig = signChallengeBip322(sk, pk, challenge);
  assert.equal(sig.length, 64);
  assert.equal(verifyChallengeBip322(pk, challenge, sig), true, "valid sig verifies");

  const bad = new TextEncoder().encode("b4".repeat(32));
  assert.equal(verifyChallengeBip322(pk, bad, sig), false, "wrong message fails");

  const otherPk = schnorr.getPublicKey(crypto.getRandomValues(new Uint8Array(32)));
  assert.equal(verifyChallengeBip322(otherPk, challenge, sig), false, "wrong key fails");

  const flipped = Uint8Array.from(sig); flipped[0] ^= 0xff;
  assert.equal(verifyChallengeBip322(pk, challenge, flipped), false, "tampered sig fails");
});
