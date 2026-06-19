// Types for the shared plain-JS e2ee module (co-located .d.ts, same pattern as
// commentScope / karabastShape). The extension consumes the raw .js; the web
// app gets these types. See lib/e2ee.js + docs/adr/0010 for the design.

// The opaque, server-stored encryption envelope. The server treats it as a
// string and never parses it; only this module reads the fields.
export interface E2eeEnvelope {
  v: 1;
  alg: 'A256GCM';
  /** Non-secret, deterministic id of the team key that wrapped this. */
  kid: string;
  /** The data key, AES-GCM-wrapped under the team key (base64url iv + ct). */
  wrap: { iv: string; ct: string };
  /** The content, AES-GCM-encrypted under the data key (base64url iv + ct). */
  data: { iv: string; ct: string };
}

/** Non-invertible, deterministic public id of a base64url team key. */
export function teamKeyId(teamKeyB64: string): Promise<string>;

/** Mint a fresh 256-bit team key (base64url) + its derived non-secret id. */
export function generateTeamKey(): Promise<{ key: string; teamKeyId: string }>;

/** Envelope-encrypt a UTF-8 string under the team key (fresh data key + nonce). */
export function encryptContent(teamKeyB64: string, plaintext: string): Promise<E2eeEnvelope>;

/** Decrypt an envelope. Throws on wrong/rotated key (kid mismatch) or tampering. */
export function decryptContent(teamKeyB64: string, envelope: E2eeEnvelope): Promise<string>;

/** Forward-only rotation: re-wrap the data key under a new team key; content ct untouched. */
export function rewrapKey(oldTeamKeyB64: string, newTeamKeyB64: string, envelope: E2eeEnvelope): Promise<E2eeEnvelope>;
