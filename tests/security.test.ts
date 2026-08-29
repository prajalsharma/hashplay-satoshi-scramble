import { strict as assert } from "node:assert";
import { test } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import { localSigner } from "../src/arch/signer.ts";
import { verifyChallengeBip322 } from "../src/arch/bip322.ts";
import { loginMessage } from "../src/shared/protocol.ts";

test("login signature is domain-separated from transaction signing", async () => {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  const signer = localSigner(sk, "t");
  const nonce = "a3".repeat(32);

  // A valid login: sign the readable message, server verifies it.
  const loginMsg = new TextEncoder().encode(loginMessage(nonce));
  const loginSig = await signer.signLogin(loginMessage(nonce));
  assert.equal(verifyChallengeBip322(signer.publicKey, loginMsg, loginSig), true);

  // The login message is NOT a bare 64-hex transaction challenge — so a login
  // signature can never be presented as a signature over a 32-byte tx hash.
  assert.ok(!/^[0-9a-f]{64}$/.test(loginMessage(nonce)), "login msg is not a raw hash");

  // Concretely: sign a transaction-shaped challenge (the 64-hex of some hash);
  // its signature differs from the login signature, and neither verifies for
  // the other's message. A malicious server holding a login sig cannot use it
  // as a tx signature.
  const txChallenge = new TextEncoder().encode(nonce); // 64-hex "hash"
  const txSig = await signer.sign(txChallenge);
  assert.notDeepEqual([...loginSig], [...txSig], "login and tx signatures differ");
  assert.equal(verifyChallengeBip322(signer.publicKey, txChallenge, loginSig), false, "login sig not valid for a tx challenge");
  assert.equal(verifyChallengeBip322(signer.publicKey, loginMsg, txSig), false, "tx sig not valid for the login message");
});

test("server nonce cannot smuggle a tx: any nonce becomes readable-wrapped", () => {
  // Even if a malicious server sends a real 32-byte tx hash as the nonce, the
  // client embeds it in the readable sentence — the signed bytes are the
  // sentence, never the bare hash.
  const evilNonce = "de".repeat(32);
  const signed = loginMessage(evilNonce);
  assert.ok(signed.startsWith("Satoshi Scramble"), "wrapped, not raw");
  assert.ok(signed.includes(evilNonce), "nonce present but embedded");
  assert.notEqual(signed, evilNonce, "signed content is not the bare nonce/hash");
});
