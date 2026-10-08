import { describe, expect, it } from 'vitest';
import { buildMessage, encodeHeaderWord, isEmail, smtpSend, SmtpError, type SmtpTransport } from '../worker/mail';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * 가짜 메일 서버. 받은 줄을 모두 적어 두고, 정해 둔 대로 답한다.
 * loginOk=false 면 비밀번호에서 535 로 거절한다 (네이버가 틀린 비밀번호에 주는 답).
 */
function fakeServer({ loginOk = true } = {}) {
  const received: string[] = [];
  let data = '';
  let inData = false;
  let step = 0;
  let push!: (text: string) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => controller.enqueue(enc.encode(text));
      push('220 smtp.naver.com ESMTP\r\n');
    },
  });
  let pending = '';
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      pending += dec.decode(chunk);
      let at: number;
      while ((at = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            push('250 2.0.0 OK queued\r\n');
          } else data += `${line}\r\n`;
          continue;
        }
        received.push(line);
        if (line.startsWith('EHLO')) push('250-smtp.naver.com\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n');
        else if (line === 'AUTH LOGIN') push('334 VXNlcm5hbWU6\r\n'), (step = 1);
        else if (step === 1) push('334 UGFzc3dvcmQ6\r\n'), (step = 2);
        else if (step === 2) push(loginOk ? '235 2.7.0 Accepted\r\n' : '535 5.7.1 Username and Password not accepted\r\n'), (step = 3);
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) push('250 OK\r\n');
        else if (line === 'DATA') push('354 go ahead\r\n'), (inData = true);
        else if (line === 'QUIT') push('221 bye\r\n');
      }
    },
  });
  return { transport: { readable, writable } as SmtpTransport, received, data: () => data };
}

const mail = {
  fromName: '한강중기(샘플중기)',
  fromAddress: 'hangang@naver.com',
  to: ['a@example.com', 'b@example.com'],
  subject: '26년 9월 다솜 거래명세표 — 한강중기(샘플중기)',
  text: '안녕하세요.\n9월 거래명세표를 보내 드립니다.\n.점으로 시작하는 줄',
  attachment: { filename: '26년 9월 다솜 거래명세표.pdf', contentType: 'application/pdf', bytes: enc.encode('%PDF-1.3 테스트') },
};

describe('메일 모양', () => {
  const msg = buildMessage(mail, { boundary: 'B', date: new Date(Date.UTC(2026, 8, 29, 0, 0)), messageId: 'x@jangbu.workers.dev' });

  it('한글 제목·이름은 =?UTF-8?B?…?= 로 싸고, 풀면 원래 글자다', () => {
    const subject = /^Subject: ([\s\S]*?)\r\nDate:/m.exec(msg)![1];
    const decoded = subject
      .split(/\r\n /)
      .map((w) => new TextDecoder().decode(Uint8Array.from(atob(/=\?UTF-8\?B\?(.*)\?=/.exec(w)![1]), (c) => c.charCodeAt(0))))
      .join('');
    expect(decoded).toBe(mail.subject);
    // 한 조각은 75자를 넘지 않는다 (RFC 2047)
    for (const w of subject.split(/\r\n /)) expect(w.length).toBeLessThanOrEqual(75);
  });

  it('PDF 를 첨부로 담고, 파일 이름은 옛·새 방식 둘 다 적는다', () => {
    expect(msg).toContain('Content-Type: multipart/mixed; boundary="B"');
    expect(msg).toContain('Content-Type: application/pdf;');
    expect(msg).toContain(`filename*=UTF-8''${encodeURIComponent(mail.attachment.filename)}`);
    const part = msg.split('--B')[2];
    const b64 = part.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe('%PDF-1.3 테스트');
  });

  it('줄바꿈은 모두 CRLF, base64 줄은 76자 이하', () => {
    expect(msg.replace(/\r\n/g, '')).not.toMatch(/\n/);
    for (const line of msg.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
  });

  it('영문만이면 그대로 둔다', () => {
    expect(encodeHeaderWord('Invoice')).toBe('Invoice');
  });

  it('받는 주소 모양 확인', () => {
    expect(isEmail('kim@daeryun.co.kr')).toBe(true);
    expect(isEmail('kim@daeryun')).toBe(false);
    expect(isEmail('a b@c.com')).toBe(false);
  });
});

describe('SMTP 대화', () => {
  it('인사 → 로그인 → 보내는 이 → 받는 이 둘 → 본문 → 끝', async () => {
    const server = fakeServer();
    const message = buildMessage(mail, { boundary: 'B', date: new Date(), messageId: 'x@y' });
    await smtpSend(server.transport, { user: 'hangang@naver.com', pass: 'app-pass' }, { from: mail.fromAddress, to: mail.to }, message);

    expect(server.received).toEqual([
      'EHLO jangbu.workers.dev',
      'AUTH LOGIN',
      btoa('hangang@naver.com'),
      btoa('app-pass'),
      'MAIL FROM:<hangang@naver.com>',
      'RCPT TO:<a@example.com>',
      'RCPT TO:<b@example.com>',
      'DATA',
      'QUIT',
    ]);
    // 서버가 받은 본문은 보낸 메일과 같다 (마침표로 시작하는 줄도 온전히)
    expect(server.data().replace(/\r\n\.\./g, '\r\n.')).toBe(message);
  });

  it('보낼 곳을 주지 않으면 로그인만 해 보고 끝낸다 (계정을 등록할 때 비밀번호 확인)', async () => {
    const server = fakeServer();
    await smtpSend(server.transport, { user: 'hangang', pass: 'app-pass' }, null, '');
    expect(server.received).toEqual(['EHLO jangbu.workers.dev', 'AUTH LOGIN', btoa('hangang'), btoa('app-pass'), 'QUIT']);
    expect(server.data()).toBe('');
  });

  it('비밀번호가 틀리면 알아듣는 말로 알린다', async () => {
    const server = fakeServer({ loginOk: false });
    const err = await smtpSend(server.transport, { user: 'x', pass: 'y' }, { from: 'x@naver.com', to: ['a@b.com'] }, 'X').catch((e) => e);
    expect(err).toBeInstanceOf(SmtpError);
    expect(err.code).toBe(535);
    expect(err.message).toContain('애플리케이션 비밀번호');
  });
});
