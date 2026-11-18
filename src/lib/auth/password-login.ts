// Username + password sign-in for people without Unisys SSO (CSU build).
//
// There is no server of ours behind this static site, so the check runs in the
// browser: the password is hashed with PBKDF2-SHA256 (WebCrypto) and compared
// with the salted hash in config.js (ADMIN_PASSWORD_HASH). The repo and the
// site are public, so ONLY the hash is ever stored; the password itself lives
// outside the repo. Like the SSO path, this is a front door for the demo, not a
// security boundary.
//
// Hash format: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>

import { config } from '@/lib/runtime-config';

const SESSION_KEY = 'csu.passwordSession';

export interface PasswordSession {
  username: string;
  at: number;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** True when config.js enables the password form and carries a hash. */
export function passwordLoginEnabled(): boolean {
  return config.passwordLoginEnabled() && !!config.adminPasswordHash() && !!config.adminUsername();
}

async function verify(password: string, record: string): Promise<boolean> {
  const [algo, iterStr, saltB64, hashB64] = record.split('$');
  const iterations = Number(iterStr);
  if (algo !== 'pbkdf2-sha256' || !Number.isFinite(iterations) || !saltB64 || !hashB64) return false;
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot check the password here (needs HTTPS).');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(saltB64) as BufferSource, iterations },
    key,
    256,
  );
  return timingSafeEqual(new Uint8Array(bits), b64ToBytes(hashB64));
}

/** Checks the credentials; on success records the session for this tab. */
export async function signInWithPassword(username: string, password: string): Promise<PasswordSession> {
  if (!passwordLoginEnabled()) throw new Error('Username and password sign-in is not enabled.');
  const userOk = username.trim().toLowerCase() === config.adminUsername().trim().toLowerCase();
  // Always run the hash, so a wrong username takes as long as a wrong password.
  const passOk = await verify(password, config.adminPasswordHash());
  if (!userOk || !passOk) throw new Error('Invalid username or password.');
  const session: PasswordSession = { username: config.adminUsername().trim(), at: Date.now() };
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage blocked: the sign-in lasts until reload */
  }
  return session;
}

/** The password session for this tab, if any. */
export function readPasswordSession(): PasswordSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PasswordSession;
    return s && typeof s.username === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function endPasswordSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}
