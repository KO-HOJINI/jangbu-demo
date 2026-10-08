#!/usr/bin/env node
/**
 * 로그인 계정을 만든다. (웹에는 회원가입이 없다 — 계정은 여기서만 생성)
 *
 *   npm run user:add -- <아이디> <이름>            로컬 개발용 DB
 *   npm run user:add -- <아이디> <이름> --remote   실제 배포된 DB
 *
 * 비밀번호는 화면에 찍히지 않게 따로 물어본다.
 * 해시 형식은 worker/auth.ts 의 hashPassword 와 동일해야 한다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

// worker/auth.ts 와 같아야 한다. Cloudflare Workers 는 10만 회가 상한이다.
const PBKDF2_ITERATIONS = 100_000;
const DB_NAME = 'jangbu-db';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [username, name] = args.filter((a) => !a.startsWith('--'));

if (!username || !name) {
  console.error('사용법: npm run user:add -- <아이디> <이름> [--remote]');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // 프롬프트만 내보내고 입력한 글자는 화면에 찍지 않는다
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = await askHidden('비밀번호: ');
const confirm = await askHidden('비밀번호 확인: ');

if (!password) {
  console.error('비밀번호를 입력해 주세요.');
  process.exit(1);
}
if (password.length < 8) {
  console.warn('경고: 비밀번호가 8자 미만입니다. 인터넷에 열려 있는 주소라면 금방 뚫릴 수 있습니다.');
}
if (password !== confirm) {
  console.error('비밀번호가 서로 다릅니다.');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
const stored = `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`;

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (username, name, password_hash) VALUES (${q(username.trim().toLowerCase())}, ${q(name)}, ${q(stored)})
  ON CONFLICT(username) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash;`;

// 비밀번호 해시가 셸 히스토리에 남지 않도록 임시 파일로 전달한다
const tmp = path.join(os.tmpdir(), `jangbu-user-${Date.now()}.sql`);
fs.writeFileSync(tmp, sql, 'utf8');

try {
  const flags = ['d1', 'execute', DB_NAME, remote ? '--remote' : '--local', '--file', tmp];
  if (remote) flags.push('--yes');

  const result = spawnSync('npx', ['wrangler', ...flags], { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);

  console.log(`\n${remote ? '배포 DB' : '로컬 DB'}에 계정 ${username} (${name}) 을 등록했습니다.`);
} finally {
  fs.rmSync(tmp, { force: true });
}
