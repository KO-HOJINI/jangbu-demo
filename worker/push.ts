/**
 * 웹 푸시 — 휴대폰·PC 에 알림을 보낸다.
 *
 * 브라우저 회사(구글·애플·모질라)의 푸시 서버에 암호화한 내용을 맡기면, 그 서버가 기기로 전해 준다.
 *   - 내용 암호화: RFC 8291 (aes128gcm). 받는 기기의 공개키로만 풀린다 — 푸시 서버도 내용을 못 본다.
 *   - 보내는 곳 증명: RFC 8292 (VAPID). 우리 비밀키로 서명한 표를 붙인다.
 * 라이브러리 없이 Workers 에 있는 WebCrypto 만 쓴다 (tests/push.test.ts 가 RFC 예시 값으로 확인한다).
 */

const enc = new TextEncoder();

export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string): Uint8Array {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  },
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/** 압축 안 한 P-256 공개키(0x04‖x‖y, 65바이트) → JWK 의 x, y */
function pointToXY(raw: Uint8Array) {
  return { x: b64url.encode(raw.slice(1, 33)), y: b64url.encode(raw.slice(33, 65)) };
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** 받는 기기의 공개키 (base64url, 65바이트) */
  p256dh: string;
  /** 받는 기기의 인증 비밀 (base64url, 16바이트) */
  auth: string;
}

/**
 * RFC 8291 로 내용을 암호화해 요청 본문을 만든다.
 * 시험할 때만 senderKey·salt 를 넘겨 RFC 예시와 같은 값이 나오는지 본다. 평소에는 매번 새로 만든다.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  sub: { p256dh: string; auth: string },
  fixed?: { senderPrivate: string; senderPublic: string; salt: string }
): Promise<Uint8Array> {
  const uaPublic = b64url.decode(sub.p256dh);
  const authSecret = b64url.decode(sub.auth);

  // 보내는 쪽 일회용 키 쌍
  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array;
  if (fixed) {
    senderPublic = b64url.decode(fixed.senderPublic);
    senderPrivate = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: fixed.senderPrivate, ...pointToXY(senderPublic), ext: true },
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, senderPrivate, 256)
  );

  // RFC 8291 §3.3–3.4
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, senderPublic), 32);
  const salt = fixed ? b64url.decode(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 한 덩어리(레코드)만 보낸다. 끝에 「마지막 레코드」 표시 0x02 를 붙인다.
  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aesKey, concat(plaintext, new Uint8Array([2])) as BufferSource)
  );

  // 머리: salt(16) ‖ 레코드 크기(4) ‖ 키 길이(1) ‖ 보내는 쪽 공개키(65)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([senderPublic.length]), senderPublic, cipher);
}

/** RFC 8292: 푸시 서버에 「이 알림은 우리가 보낸 것」 임을 보이는 서명 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: { publicKey: string; privateJwk: string; subject: string },
  now = Date.now()
): Promise<string> {
  const header = b64url.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url.encode(
    enc.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })
    )
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(vapid.privateJwk) as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  // WebCrypto 의 ECDSA 서명은 이미 JWT 가 쓰는 r‖s 64바이트 꼴이다
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`))
  );
  return `vapid t=${header}.${claims}.${b64url.encode(signature)}, k=${vapid.publicKey}`;
}

export interface PushMessage {
  title: string;
  body: string;
  /** 알림을 누르면 열 화면 */
  url: string;
  /** 같은 tag 의 알림은 겹쳐 쌓이지 않고 바뀐다 */
  tag?: string;
}

/**
 * 한 기기에 보낸다. 돌려주는 값: 'ok' | 'gone'(기기가 알림을 끊었거나 오래돼 버려야 함) | 'error'
 */
export async function sendPush(
  sub: PushSubscriptionKeys,
  message: PushMessage,
  vapid: { publicKey: string; privateJwk: string; subject: string }
): Promise<'ok' | 'gone' | 'error'> {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // 기기가 꺼져 있으면 하루 동안 기다렸다 전한다
      TTL: '86400',
      Urgency: 'normal',
    },
    body: body as BodyInit,
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) {
    console.error('푸시 실패', res.status, await res.text().catch(() => ''));
    return 'error';
  }
  return 'ok';
}
