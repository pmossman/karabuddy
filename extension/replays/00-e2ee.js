// B170 / ADR 0010 — Private-team end-to-end encryption. THE trusted artifact.
//
// This is the ENTIRE crypto surface a team has to read+trust. Dependency-free
// plain JS over WebCrypto, so the EXACT same code runs in the web app (imports
// this) and the buildless extension (a byte-identical copy at
// extension/replays/00-e2ee.js, parity-tested — same pattern as commentScope.js
// / karabastShape.js). Keep it small, keep it auditable, change it deliberately.
//
// THREAT MODEL (full version in docs/adr/0010): the adversary is the karabuddy
// server operator. The team key NEVER reaches the server and is NEVER embedded
// in this module — callers hold it (extension: chrome.storage.local). The
// server only ever sees envelopes (opaque ciphertext) + the non-secret kid.
//
// CRYPTO:
//   - Team key (TK): 256 bits of CSPRNG randomness, shared out-of-band as a
//     base64url string. Two independent values are derived from it via HKDF-
//     SHA256 (domain-separated by `info`), so neither reveals the other:
//       * kid       = HKDF(TK, "kb-team-key-id", 8B)   — non-secret public id
//       * wrap key  = HKDF(TK, "kb-key-wrap",   32B)   — AES-256-GCM key
//   - Envelope encryption: a fresh random per-content data key (DK) AES-GCM-
//     encrypts the plaintext; the wrap key AES-GCM-encrypts (wraps) the raw DK.
//     Rotation re-wraps the DK under a new TK — the content ciphertext is never
//     touched (rewrapKey). Forward-only by design (ADR 0010, decision 8).
//
// Envelope wire shape (versioned; the server treats it as an opaque string and
// never parses it — additive contract):
//   { v:1, alg:"A256GCM", kid, wrap:{ iv, ct }, data:{ iv, ct } }
// all of kid/iv/ct are base64url (no padding). `wrap.ct` is the wrapped DK;
// `data.ct` is the content ciphertext (GCM tag appended by WebCrypto).

(function (root) {
  'use strict';

  // WebCrypto handle — globalThis.crypto in browsers, extension workers, and
  // Node 18+ (where the unit suite runs). No polyfill, no fallback.
  var webcrypto = (typeof globalThis !== 'undefined' && globalThis.crypto) || (typeof self !== 'undefined' && self.crypto);
  var subtle = webcrypto && webcrypto.subtle;

  var KEY_BYTES = 32;   // 256-bit team key + data key
  var IV_BYTES = 12;    // 96-bit GCM nonce (random per encryption)
  var KID_BYTES = 8;    // public key id length
  var HKDF_INFO_KID = 'kb-team-key-id';
  var HKDF_INFO_WRAP = 'kb-key-wrap';

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  // ----- base64url (no padding) <-> bytes. btoa/atob exist in Node 18+, the
  // browser, and extension workers; we bridge them through binary strings. -----
  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    webcrypto.getRandomValues(b);
    return b;
  }

  // Derive `lengthBytes` of key material from the team key via HKDF-SHA256,
  // domain-separated by `info`. Empty salt is fine for a full-entropy key.
  async function hkdf(tkBytes, info, lengthBytes) {
    var ikm = await subtle.importKey('raw', tkBytes, 'HKDF', false, ['deriveBits']);
    var bits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
      ikm,
      lengthBytes * 8
    );
    return new Uint8Array(bits);
  }

  // Import the team key (base64url) → the AES-256-GCM wrapping key.
  async function importWrapKey(teamKeyB64) {
    var tk = b64urlToBytes(teamKeyB64);
    var wrapRaw = await hkdf(tk, HKDF_INFO_WRAP, KEY_BYTES);
    return subtle.importKey('raw', wrapRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function aesGcmEncrypt(key, plaintextBytes) {
    var iv = randomBytes(IV_BYTES);
    var ct = await subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintextBytes);
    return { iv: bytesToB64url(iv), ct: bytesToB64url(new Uint8Array(ct)) };
  }
  async function aesGcmDecrypt(key, part) {
    var pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(part.iv) }, key, b64urlToBytes(part.ct));
    return new Uint8Array(pt);
  }

  // ----- Public API -----

  // The non-secret, deterministic id of a team key. Members who paste the same
  // key converge on the same id with no coordination; HKDF makes it
  // non-invertible (can't recover the key from the id).
  async function teamKeyId(teamKeyB64) {
    var idBytes = await hkdf(b64urlToBytes(teamKeyB64), HKDF_INFO_KID, KID_BYTES);
    return bytesToB64url(idBytes);
  }

  // Mint a fresh team key. Returns the base64url key string (for out-of-band
  // sharing) + its derived id (for the server's non-secret team_key_id).
  async function generateTeamKey() {
    var key = bytesToB64url(randomBytes(KEY_BYTES));
    return { key: key, teamKeyId: await teamKeyId(key) };
  }

  // Envelope-encrypt a UTF-8 string under the team key. Fresh random data key +
  // nonces every call → non-deterministic ciphertext.
  async function encryptContent(teamKeyB64, plaintext) {
    var wrapKey = await importWrapKey(teamKeyB64);
    // Fresh per-content data key; exported raw so the wrap key can encrypt it.
    var dk = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    var dkRaw = new Uint8Array(await subtle.exportKey('raw', dk));
    var data = await aesGcmEncrypt(dk, enc.encode(String(plaintext)));
    var wrap = await aesGcmEncrypt(wrapKey, dkRaw);
    return { v: 1, alg: 'A256GCM', kid: await teamKeyId(teamKeyB64), wrap: wrap, data: data };
  }

  // Unwrap the data key with the team key, then decrypt the content. Throws if
  // the key is wrong (kid mismatch — cheap fail-fast) or anything was tampered
  // (GCM auth tag). Fails closed.
  async function decryptContent(teamKeyB64, envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('e2ee: malformed envelope');
    var expectedKid = await teamKeyId(teamKeyB64);
    if (envelope.kid !== expectedKid) throw new Error('e2ee: key id mismatch (wrong or rotated key)');
    var wrapKey = await importWrapKey(teamKeyB64);
    var dkRaw = await aesGcmDecrypt(wrapKey, envelope.wrap);
    var dk = await subtle.importKey('raw', dkRaw, { name: 'AES-GCM' }, false, ['decrypt']);
    var ptBytes = await aesGcmDecrypt(dk, envelope.data);
    return dec.decode(ptBytes);
  }

  // Forward-only rotation: unwrap the data key with the old team key and re-wrap
  // it under the new one. The content ciphertext (data.iv/data.ct) is untouched,
  // so rotation never re-encrypts blobs — only the wrap + kid change.
  async function rewrapKey(oldTeamKeyB64, newTeamKeyB64, envelope) {
    var oldWrap = await importWrapKey(oldTeamKeyB64);
    var expectedKid = await teamKeyId(oldTeamKeyB64);
    if (envelope.kid !== expectedKid) throw new Error('e2ee: key id mismatch (envelope not wrapped by the old key)');
    var dkRaw = await aesGcmDecrypt(oldWrap, envelope.wrap);
    var newWrap = await importWrapKey(newTeamKeyB64);
    var rewrapped = await aesGcmEncrypt(newWrap, dkRaw);
    return { v: 1, alg: 'A256GCM', kid: await teamKeyId(newTeamKeyB64), wrap: rewrapped, data: envelope.data };
  }

  var api = {
    teamKeyId: teamKeyId,
    generateTeamKey: generateTeamKey,
    encryptContent: encryptContent,
    decryptContent: decryptContent,
    rewrapKey: rewrapKey,
  };

  // Dual-mode export: CommonJS for the web app (Vitest/Next import this .js);
  // the extension content script loads the byte-identical copy as a classic
  // script where `module` is undefined and the functions live on the window NS.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    ((root.__KaraBuddy || (root.__KaraBuddy = {})).replays || (root.__KaraBuddy.replays = {})).e2ee = api;
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
