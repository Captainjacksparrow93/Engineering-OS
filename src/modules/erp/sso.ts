import crypto from 'node:crypto';

export const ERP_ROLES_DIRECTOR = [
  'System Manager',
  'Sales Manager',
  'Sales User',
  'Purchase Manager',
  'Stock Manager',
  'Accounts Manager',
  'Item Manager',
] as const;

export const ERP_ROLES_SALES_HEAD = [
  'Sales Manager',
  'Sales User',
] as const;

export interface PassPayload {
  v: 1;
  act: 'login' | 'disable';
  email: string;
  name: string;
  roles: string[];
  iat: number;
  exp: number;
  nonce: string;
}

export interface SsoUser {
  email: string;
  name?: string;
  roles?: string[];
}

/**
 * Maps Engineering OS role keys to ERPNext roles.
 * Director / Super Admin get all operational modules.
 * Sales Head gets Sales Manager + Sales User.
 * Everyone else gets none.
 */
export function rolesFor(roleKeys: string[]): string[] {
  if (roleKeys.includes('DIRECTOR') || roleKeys.includes('SUPER_ADMIN')) {
    return [...ERP_ROLES_DIRECTOR];
  }
  if (roleKeys.includes('SALES_HEAD')) {
    return [...ERP_ROLES_SALES_HEAD];
  }
  return [];
}

/**
 * Builds a signed, single-use SSO pass for ERPNext.
 * pass = base64url(payloadJSON) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJSON)))
 */
export function buildPass(
  user: SsoUser,
  act: 'login' | 'disable' = 'login',
  secret?: string,
  nowSeconds?: number,
  nonceHex?: string,
): string {
  const ssoSecret = secret ?? process.env.ERP_SSO_SECRET;
  if (!ssoSecret) {
    throw new Error('ERP_SSO_SECRET is not configured');
  }

  const iat = nowSeconds ?? Math.floor(Date.now() / 1000);
  const exp = iat + 30;
  const nonce = nonceHex ?? crypto.randomBytes(16).toString('hex');

  const payload: PassPayload = {
    v: 1,
    act,
    email: user.email,
    name: user.name ?? '',
    roles: user.roles ?? [],
    iat,
    exp,
    nonce,
  };

  const payloadJSON = JSON.stringify(payload);
  const b64Payload = Buffer.from(payloadJSON, 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', ssoSecret)
    .update(b64Payload)
    .digest('base64url');

  return `${b64Payload}.${signature}`;
}

/**
 * Decodes and verifies an SSO pass constant-time.
 */
export function verifyPass(
  pass: string,
  secret: string,
  nowSeconds?: number,
  skewSeconds: number = 5,
): PassPayload {
  if (!pass || typeof pass !== 'string') {
    throw new Error('Invalid pass: empty or not a string');
  }

  const parts = pass.split('.');
  if (parts.length !== 2) {
    throw new Error('Invalid pass: malformed format');
  }

  const [b64Payload, b64Sig] = parts;
  if (!b64Payload || !b64Sig) {
    throw new Error('Invalid pass: missing components');
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(b64Payload)
    .digest('base64url');

  const sigBuf = Buffer.from(b64Sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid pass: signature verification failed');
  }

  let payload: PassPayload;
  try {
    const rawJSON = Buffer.from(b64Payload, 'base64url').toString('utf8');
    payload = JSON.parse(rawJSON);
  } catch {
    throw new Error('Invalid pass: malformed payload');
  }

  if (payload.v !== 1) {
    throw new Error(`Invalid pass version: ${payload.v}`);
  }

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);

  if (payload.exp + skewSeconds < now) {
    throw new Error('Invalid pass: pass expired');
  }

  if (payload.iat - skewSeconds > now) {
    throw new Error('Invalid pass: pass issued in the future');
  }

  return payload;
}
