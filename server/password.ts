import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.startsWith('scrypt:')) return false;
  const parts = stored.split(':');
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  if (!/^[a-f0-9]{32}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch {
    return false;
  }
}
