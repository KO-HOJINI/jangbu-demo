import { connect } from 'cloudflare:sockets';
import { buildMessage, smtpSend, type MailConfig, type MailInput } from './mail';

/**
 * 워커의 TCP 소켓으로 메일 서버에 붙어 보낸다.
 * (소켓은 Workers 에만 있어서, 시험(tests/mail.test.ts)이 부르는 mail.ts 와 떼어 두었다)
 */
/** 메일을 보내지 않고 로그인만 해 본다. 틀리면 SmtpError */
export async function checkLogin(cfg: MailConfig): Promise<void> {
  const socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: cfg.secure ? 'on' : 'off', allowHalfOpen: false }
  );
  try {
    await smtpSend(socket, { user: cfg.user, pass: cfg.pass }, null, '');
  } finally {
    await socket.close().catch(() => undefined);
  }
}

export async function sendMail(cfg: MailConfig, mail: MailInput): Promise<void> {
  const socket = connect(
    { hostname: cfg.host, port: cfg.port },
    { secureTransport: cfg.secure ? 'on' : 'off', allowHalfOpen: false }
  );
  const id = crypto.randomUUID();
  const message = buildMessage(mail, {
    boundary: `jangbu-${id}`,
    date: new Date(),
    messageId: `${id}@jangbu.workers.dev`,
  });
  try {
    await smtpSend(socket, { user: cfg.user, pass: cfg.pass }, { from: mail.fromAddress, to: mail.to }, message);
  } finally {
    await socket.close().catch(() => undefined);
  }
}
