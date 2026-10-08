import { describe, expect, it } from 'vitest';
import { b64url, encryptPayload, vapidAuthorization } from '../worker/push';

const enc = new TextEncoder();

// RFC 8291 부록 A 의 예시 값 — 표준대로 암호화하는지 글자 하나까지 맞춰 본다
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** 받는 기기 쪽에서 푸는 과정 (시험용) */
async function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const senderPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const pub = b64url.decode(uaPublic);
  const priv = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: uaPrivate, x: b64url.encode(pub.slice(1, 33)), y: b64url.encode(pub.slice(33)), ext: true },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, priv, 256));
  const h = async (s: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, len: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s, info: typeof info === 'string' ? enc.encode(info) : info },
        await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
        len * 8
      )
    );
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...pub, ...senderPublic]);
  const ikm = await h(b64url.decode(auth), shared, info, 32);
  const cek = await h(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await h(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2); // 마지막 레코드 표시
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe('웹 푸시 내용 암호화 (RFC 8291)', () => {
  it('RFC 예시와 글자 하나까지 같은 본문을 만든다', async () => {
    const body = await encryptPayload(enc.encode(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, RFC);
    expect(b64url.encode(body)).toBe(RFC.body);
  });

  it('받는 기기는 자기 비밀키로 원래 내용을 푼다 (평소처럼 일회용 키로 보낼 때)', async () => {
    const message = JSON.stringify({ title: '발행일 알림', body: '나래(한강) 2건 · 240만 원', url: '/sites' });
    const body = await encryptPayload(enc.encode(message), { p256dh: RFC.uaPublic, auth: RFC.auth });
    expect(await decrypt(body, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe(message);
  });
});

describe('보내는 곳 증명 (VAPID, RFC 8292)', () => {
  it('우리 공개키로 확인되는 서명과, 푸시 서버 주소·만료 시각을 담는다', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = b64url.encode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    const now = Date.UTC(2026, 8, 29, 0, 0, 0);

    const auth = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123',
      { publicKey, privateJwk, subject: 'https://example.workers.dev' },
      now
    );
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(publicKey);

    const [h, c, s] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(b64url.decode(c)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://example.workers.dev',
    });
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      b64url.decode(s),
      enc.encode(`${h}.${c}`)
    );
    expect(ok).toBe(true);
  });
});
