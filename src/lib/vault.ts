import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DEFAULT_SALT = Buffer.from('netguardia-small-it-vault-salt-v1', 'utf-8');
const VAULT_KEY_FILE = path.resolve(process.cwd(), '.vault_master.key');

interface FernetKeys {
  signingKey: Buffer;
  encryptionKey: Buffer;
}

let cachedKeys: FernetKeys | null = null;

function getFernetKeys(): FernetKeys {
  if (cachedKeys) return cachedKeys;

  const envSecret = process.env.NETGUARDIA_VAULT_SECRET;
  let raw32Key: Buffer;

  if (envSecret && envSecret.trim().length > 0) {
    raw32Key = crypto.pbkdf2Sync(
      envSecret.trim(),
      DEFAULT_SALT,
      200_000,
      32,
      'sha256'
    );
  } else if (fs.existsSync(VAULT_KEY_FILE)) {
    try {
      const b64 = fs.readFileSync(VAULT_KEY_FILE, 'utf-8').trim();
      raw32Key = Buffer.from(b64, 'base64');
      if (raw32Key.length !== 32) {
        raw32Key = crypto.randomBytes(32);
      }
    } catch {
      raw32Key = crypto.randomBytes(32);
    }
  } else {
    raw32Key = crypto.randomBytes(32);
    try {
      fs.writeFileSync(VAULT_KEY_FILE, raw32Key.toString('base64'), { encoding: 'utf-8' });
    } catch {
      // ignore
    }
  }

  // Fernet uses first 16 bytes for HMAC-SHA256 signing, last 16 bytes for AES-128-CBC encryption
  cachedKeys = {
    signingKey: raw32Key.subarray(0, 16),
    encryptionKey: raw32Key.subarray(16, 32),
  };
  return cachedKeys;
}

/**
 * Encrypt a plaintext secret using standard Fernet (AES-128-CBC + HMAC-SHA256)
 */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;

  const { signingKey, encryptionKey } = getFernetKeys();
  const iv = crypto.randomBytes(16);
  const version = Buffer.from([0x80]);

  // 8-byte big-endian timestamp in seconds
  const tsBuffer = Buffer.alloc(8);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  tsBuffer.writeBigUInt64BE(nowSec, 0);

  const cipher = crypto.createCipheriv('aes-128-cbc', encryptionKey, iv);
  const cipherText = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf-8')), cipher.final()]);

  const basicParts = Buffer.concat([version, tsBuffer, iv, cipherText]);
  const hmac = crypto.createHmac('sha256', signingKey);
  hmac.update(basicParts);
  const hmacDigest = hmac.digest();

  const token = Buffer.concat([basicParts, hmacDigest]);
  // URL-safe base64
  return token.toString('base64url');
}

/**
 * Decrypt a Fernet token back to plaintext
 */
export function decryptSecret(token: string | null | undefined): string | null {
  if (!token) return null;

  try {
    const { signingKey, encryptionKey } = getFernetKeys();
    const tokenBuffer = Buffer.from(token, 'base64url');

    if (tokenBuffer.length < 57) return null; // min length: 1 + 8 + 16 + 0 (padded to 16) + 32 = 73 usually
    if (tokenBuffer[0] !== 0x80) return null;

    const dataToSign = tokenBuffer.subarray(0, tokenBuffer.length - 32);
    const signature = tokenBuffer.subarray(tokenBuffer.length - 32);

    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(dataToSign);
    const expectedSig = hmac.digest();

    if (!crypto.timingSafeEqual(signature, expectedSig)) {
      return null;
    }

    const iv = tokenBuffer.subarray(9, 25);
    const cipherText = tokenBuffer.subarray(25, tokenBuffer.length - 32);

    const decipher = crypto.createDecipheriv('aes-128-cbc', encryptionKey, iv);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Return masked representation of a secret
 */
export function maskSecret(ciphertext: string | null | undefined): string {
  if (!ciphertext) return 'Not configured';
  const plain = decryptSecret(ciphertext);
  if (!plain) return '•••••••• (encrypted)';
  if (plain.length <= 4) return '••••••••';
  return `••••••••${plain.slice(-2)}`;
}
