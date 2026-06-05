import * as crypto from 'crypto';

/**
 * Verifies a GitHub webhook signature using timing-safe HMAC-SHA256 comparison.
 */
export function verifySignature(signature: string, rawBody: Buffer, secret: string): boolean {
  try {
    // Strip "sha256=" prefix if present
    const expected = signature.startsWith('sha256=') ? signature.substring(7) : signature;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const actual = hmac.digest('hex');

    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

/**
 * Encrypts a string using AES-256-GCM.
 * Output format: iv_hex:tag_hex:encrypted_hex
 */
export function encrypt(text: string, secretKey: string): string {
  // Key must be 32 bytes
  const key = crypto.scryptSync(secretKey, 'salt-paas', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

/**
 * Decrypts a string encrypted using AES-256-GCM.
 * Input format: iv_hex:tag_hex:encrypted_hex
 */
export function decrypt(encryptedText: string, secretKey: string): string {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const key = crypto.scryptSync(secretKey, 'salt-paas', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt data');
  }
}
