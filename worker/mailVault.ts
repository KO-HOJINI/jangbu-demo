/**
 * 메일 계정의 애플리케이션 비밀번호를 잠가서 DB 에 둔다.
 *
 * 계정을 화면에서 여러 개 등록하므로 비밀번호를 서버 비밀값(wrangler secret)으로 하나씩 넣을 수 없다.
 * 대신 서버 비밀값 하나를 열쇠로 삼아 AES-GCM 으로 잠근 글자만 DB 에 넣는다 —
 * DB 나 백업 파일만 봐서는 비밀번호를 알 수 없다.
 *
 * 열쇠: `MAIL_KEY` 가 있으면 그것, 없으면 이미 들어 있는 `VAPID_PRIVATE_JWK` 에서 뽑는다
 * (용도 이름을 섞어 뽑으므로 알림용 열쇠와 같은 값이 되지 않는다).
 * 열쇠가 바뀌면 잠근 글자를 풀 수 없으니, 계정마다 비밀번호를 다시 적어야 한다.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

export class VaultError extends Error {}

/** 잠그고 풀 때 쓸 서버 비밀값. 없으면 null — 계정을 등록할 수 없다 */
export function vaultSecret(env: Env): string | null {
  const e = env as unknown as Record<string, string | undefined>;
  return e.MAIL_KEY || e.VAPID_PRIVATE_JWK || null;
}

async function keyFrom(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('jangbu'), info: enc.encode('mail-accounts-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** `v1.<iv>.<잠근 글자>` (둘 다 base64) */
export async function lock(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(secret), enc.encode(plain));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

export async function unlock(secret: string, stored: string): Promise<string> {
  const [version, iv, sealed] = stored.split('.');
  try {
    if (version !== 'v1' || !iv || !sealed) throw new Error('모양이 다르다');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await keyFrom(secret), fromBase64(sealed));
    return dec.decode(plain);
  } catch {
    throw new VaultError('저장해 둔 메일 비밀번호를 읽을 수 없습니다. 설정 > 계정에서 그 메일 계정의 비밀번호를 다시 적어 주세요.');
  }
}
