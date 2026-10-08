/**
 * 네이버 메일(SMTP)로 명세표를 보낸다.
 *
 * smtp.naver.com:465 (처음부터 암호화). 로그인은 네이버 아이디와 「애플리케이션 비밀번호」로 한다.
 * 계정은 설정 > 계정에서 여러 개 등록하고 보낼 때 고른다 (mailAccounts.ts, 비밀번호는 mailVault.ts 로 잠가 DB 에).
 * 예전처럼 `wrangler secret put NAVER_SMTP_USER`·`NAVER_SMTP_PASSWORD` 로 넣은 계정도 같이 쓸 수 있다.
 *
 * SMTP 대화(smtpSend)와 메일 모양(buildMessage)은 소켓과 떼어 두었다 —
 * tests/mail.test.ts 가 가짜 메일 서버로 대화 전체를 확인한다.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── 메일 모양 (MIME) ─────────────────────────────────────────────────────

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** base64 는 한 줄 76자로 끊는다 (RFC 2045) */
const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join('\r\n') ?? '';

/**
 * 한글 머리글(제목·보내는 이름)은 =?UTF-8?B?…?= 로 싼다.
 * 한 조각이 75자를 넘지 않게, 글자가 쪼개지지 않게 나눈다.
 */
export function encodeHeaderWord(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: string[] = [];
  let chunk = '';
  for (const ch of text) {
    if (enc.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${toBase64(enc.encode(w))}?=`).join('\r\n ');
}

export const isEmail = (v: string) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(v);

export interface MailInput {
  fromName: string;
  fromAddress: string;
  to: string[];
  subject: string;
  text: string;
  attachment?: { filename: string; contentType: string; bytes: Uint8Array };
}

/** 보낼 메일 전체 (머리글 + 본문 + 첨부), 줄바꿈은 CRLF */
export function buildMessage(mail: MailInput, opts: { boundary: string; date: Date; messageId: string }): string {
  const lines = [
    `From: ${encodeHeaderWord(mail.fromName)} <${mail.fromAddress}>`,
    `To: ${mail.to.join(', ')}`,
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    `Date: ${opts.date.toUTCString()}`,
    `Message-ID: <${opts.messageId}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${opts.boundary}"`,
    '',
    `--${opts.boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(toBase64(enc.encode(mail.text.replace(/\r?\n/g, '\r\n')))),
  ];

  if (mail.attachment) {
    const { filename, contentType, bytes } = mail.attachment;
    // 옛 메일 프로그램은 filename="=?UTF-8?B?…?=", 요즘 것은 filename*=UTF-8''… 을 읽는다. 둘 다 적는다.
    const b = `=?UTF-8?B?${toBase64(enc.encode(filename))}?=`;
    lines.push(
      `--${opts.boundary}`,
      `Content-Type: ${contentType}; name="${b}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${b}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      '',
      wrap76(toBase64(bytes))
    );
  }

  lines.push(`--${opts.boundary}--`, '');
  return lines.join('\r\n');
}

// ── SMTP 대화 ────────────────────────────────────────────────────────────

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number
  ) {
    super(message);
  }
}

/** 한 번의 SMTP 대화에 필요한 통로 — Workers 의 소켓이든 시험용 가짜든 */
export interface SmtpTransport {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export async function smtpSend(
  transport: SmtpTransport,
  auth: { user: string; pass: string },
  /** null 이면 로그인만 해 보고 끝낸다 (계정을 등록할 때 비밀번호가 맞는지 확인) */
  envelope: { from: string; to: string[] } | null,
  message: string,
  heloName = 'jangbu.workers.dev'
): Promise<void> {
  const reader = transport.readable.getReader();
  const writer = transport.writable.getWriter();
  let buffer = '';

  /** 응답 한 덩어리 (250-… 로 이어지는 여러 줄은 250 … 줄까지) */
  const reply = async (): Promise<{ code: number; text: string }> => {
    const lines: string[] = [];
    for (;;) {
      let at: number;
      while ((at = buffer.indexOf('\r\n')) < 0) {
        const { value, done } = await reader.read();
        if (done) throw new SmtpError('메일 서버가 연결을 끊었습니다.', 0);
        buffer += dec.decode(value, { stream: true });
      }
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        return { code: Number(line.slice(0, 3)), text: lines.map((l) => l.slice(4)).join(' ') };
      }
    }
  };

  const send = (line: string) => writer.write(enc.encode(`${line}\r\n`));
  const expect = async (want: number, what: string) => {
    const r = await reply();
    if (r.code !== want) throw new SmtpError(`${what}: ${r.code} ${r.text}`, r.code);
    return r;
  };

  try {
    await expect(220, '메일 서버 인사');
    await send(`EHLO ${heloName}`);
    await expect(250, 'EHLO');

    await send('AUTH LOGIN');
    await expect(334, '로그인 시작');
    await send(toBase64(enc.encode(auth.user)));
    await expect(334, '아이디');
    await send(toBase64(enc.encode(auth.pass)));
    const login = await reply();
    if (login.code !== 235) {
      throw new SmtpError(
        '네이버 로그인에 실패했습니다. 아이디·애플리케이션 비밀번호와, 네이버 메일 설정의 「POP3/SMTP 사용」 을 확인해 주세요.',
        login.code
      );
    }

    if (!envelope) {
      await send('QUIT');
      await reply().catch(() => undefined);
      return;
    }

    await send(`MAIL FROM:<${envelope.from}>`);
    await expect(250, '보내는 사람');
    for (const to of envelope.to) {
      await send(`RCPT TO:<${to}>`);
      const r = await reply();
      if (r.code !== 250 && r.code !== 251) throw new SmtpError(`받는 주소를 받지 않습니다 (${to}): ${r.text}`, r.code);
    }

    await send('DATA');
    await expect(354, '본문 시작');
    // 줄 맨 앞의 마침표는 두 번 적는다 (본문 끝 표시와 헷갈리지 않게, RFC 5321 §4.5.2)
    const body = message.replace(/\r\n\./g, '\r\n..');
    await writer.write(enc.encode(`${body.endsWith('\r\n') ? body : `${body}\r\n`}.\r\n`));
    await expect(250, '보내기');

    await send('QUIT');
    await reply().catch(() => undefined);
  } finally {
    await writer.close().catch(() => undefined);
    reader.releaseLock();
  }
}

// ── 워커에서 실제로 보내기 ───────────────────────────────────────────────

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

/** 설정이 다 있으면 보낼 수 있다. 없으면 null — 화면에 「메일 설정이 아직 없습니다」 */
export function mailConfig(env: Env): MailConfig | null {
  const e = env as unknown as Record<string, string | undefined>;
  if (!e.NAVER_SMTP_USER || !e.NAVER_SMTP_PASSWORD) return null;
  return {
    host: e.SMTP_HOST || 'smtp.naver.com',
    port: Number(e.SMTP_PORT || 465),
    secure: (e.SMTP_SECURE || 'on') !== 'off',
    // 네이버는 아이디만 적어도 되지만, 보내는 주소는 꼭 @naver.com 까지
    user: e.NAVER_SMTP_USER,
    pass: e.NAVER_SMTP_PASSWORD,
  };
}

export const senderAddress = (cfg: MailConfig) => (cfg.user.includes('@') ? cfg.user : `${cfg.user}@naver.com`);

/** 메일 기록을 남기는 표 — 거래명세표와 견적서가 같은 모양이다 */
export const EMAIL_LOGS = {
  statements: { emails: 'statement_emails', fk: 'statement_id', name: '거래명세표' },
  quotes: { emails: 'quote_emails', fk: 'quote_id', name: '견적서' },
} as const;
export type DocKind = keyof typeof EMAIL_LOGS;

/** 네이버 메일 창·기본 메일 앱으로 보냈을 때 남기는 기록 (실제로 갔는지는 알 수 없다) */
export async function insertEmailLog(
  db: D1Database,
  id: number,
  to: string[],
  subject?: string,
  kind: DocKind = 'statements'
): Promise<boolean> {
  const toStr = to.map((s) => String(s).trim()).filter(Boolean).join(', ');
  if (!toStr) return false;
  const doc = EMAIL_LOGS[kind];
  await db
    .prepare(`INSERT INTO ${doc.emails} (${doc.fk}, to_addrs, subject, status) VALUES (?, ?, ?, 'sent')`)
    .bind(id, toStr, subject ?? '네이버 메일 작성')
    .run();
  return true;
}
