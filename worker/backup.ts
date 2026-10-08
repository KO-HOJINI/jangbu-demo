import type { BackupEntry } from '../shared/types';

/**
 * 자동 백업.
 *
 * D1 의 모든 표를 INSERT 문으로 뽑아 KV 에 넣어 둔다. D1 과 다른 저장소에 두어야
 * 의미가 있고, KV 는 무료 한도 안에서 카드 등록 없이 쓸 수 있다.
 * 하루 한 번 cron 으로 돌고, 설정 화면에서 직접 받을 수도 있다.
 */

/** 백업에 담을 표. 넣는 순서 = 외래키가 걸린 순서 */
const TABLES = [
  'users',
  'companies',
  'company_stamps',
  'clients',
  'sites',
  'site_rates',
  'site_contacts',
  'operators',
  'operator_salaries',
  'operator_pay',
  'operator_ot',
  'work_logs',
  'statements',
  'statement_lines',
  'statement_emails',
  'quotes',
  'quote_lines',
  'quote_emails',
] as const;
// 메일 계정(mail_accounts)은 일부러 뺐다 — 잠근 비밀번호라도 내려받은 백업 파일에 섞여 돌아다니지 않게.
// 되돌려도 등록해 둔 계정은 그대로 남는다.
// 임시저장(drafts·draft_history)과 로그인(sessions)은 일부러 뺐다.
// 작업 중인 화면 값과 접속 기록일 뿐이라, 되살릴 필요도 없고 되살리면 오히려 헷갈린다.

/** 값이 계산되는 열은 되돌릴 때 넣으면 안 된다 */
const GENERATED_COLUMNS: Record<string, string[]> = {
  work_logs: ['ot_amount', 'supply_amount'],
};

const KEY_PREFIX = 'backup:';
const KEEP_DAYS = 60;

const quote = (v: unknown) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

/*
 * D1 은 SQL 한 문장이 100KB 를 넘으면 실행하지 않는다 (SQLITE_TOOBIG).
 * 예전에는 표 하나를 INSERT 한 문장에 몰아 써서, 도장 그림(금강 도장만 174KB)이 들어간 뒤로
 * 백업을 되살릴 수 없었다. 장부도 500줄쯤 쌓이면 같은 일이 난다.
 *  - INSERT 는 한 문장이 90KB 를 넘지 않게 여러 개로 나눈다.
 *  - 긴 글자 값은 앞부분만 INSERT 에 넣고, 나머지는 UPDATE ... SET 열 = 열 || '다음 조각' 으로 이어 붙인다.
 */
const MAX_STATEMENT_BYTES = 90_000;
/** 이보다 긴 글자 값은 조각내어 넣는다 */
const INLINE_CHARS = 2_000;
/** 이어 붙이는 한 조각 (한글이 3바이트여도 한 문장 90KB 안) */
const CHUNK_CHARS = 25_000;
/** UPDATE 로 이어 붙일 때 행을 가리키는 열 (나머지 표는 id) */
const PRIMARY_KEYS: Record<string, string> = { company_stamps: 'company_id' };

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** 되살릴 때 차례대로 실행할 문장들 (주석 포함) */
export async function dumpStatements(db: D1Database): Promise<string[]> {
  const out = [
    `-- 장부 백업 (${new Date().toISOString()})`,
    `-- 되돌리기: npx wrangler d1 execute jangbu-db --remote --file <이 파일>`,
    `-- 표 구조는 migrations 로 먼저 만들어야 한다.`,
    'PRAGMA defer_foreign_keys = ON;',
  ];

  // 지우기는 자식 표부터, 넣기는 부모 표부터
  for (const table of [...TABLES].reverse()) out.push(`DELETE FROM ${table};`);

  for (const table of TABLES) {
    const { results } = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
    if (!results.length) {
      out.push(`-- ${table}: 없음`);
      continue;
    }
    const skip = new Set(GENERATED_COLUMNS[table] ?? []);
    const columns = Object.keys(results[0]).filter((c) => !skip.has(c));
    const pk = PRIMARY_KEYS[table] ?? 'id';
    const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n`;
    out.push(`-- ${table}: ${results.length}행`);

    let batch: string[] = [];
    let batchBytes = byteLength(head);
    const flush = () => {
      if (batch.length) out.push(head + batch.join(',\n') + ';');
      batch = [];
      batchBytes = byteLength(head);
    };
    // 이어 붙이기는 그 표의 INSERT 가 모두 끝난 뒤에
    const appends: string[] = [];

    for (const row of results) {
      const values = columns.map((c) => {
        const v = row[c];
        if (typeof v !== 'string' || v.length <= INLINE_CHARS) return quote(v);
        for (let i = INLINE_CHARS; i < v.length; i += CHUNK_CHARS) {
          appends.push(
            `UPDATE ${table} SET ${c} = ${c} || ${quote(v.slice(i, i + CHUNK_CHARS))} WHERE ${pk} = ${quote(row[pk])};`
          );
        }
        return quote(v.slice(0, INLINE_CHARS));
      });
      const tuple = `  (${values.join(', ')})`;
      const size = byteLength(tuple) + 2;
      if (batch.length && batchBytes + size > MAX_STATEMENT_BYTES) flush();
      batch.push(tuple);
      batchBytes += size;
    }
    flush();
    out.push(...appends);
  }

  return out;
}

/** 전체 데이터를 되살릴 수 있는 SQL 파일 내용 */
export async function dumpDatabase(db: D1Database): Promise<string> {
  return (await dumpStatements(db)).join('\n') + '\n';
}

/**
 * 백업 파일 글을 실행할 문장으로 다시 나눈다 (끝의 ; 는 뗀다).
 * 값 안에 ; · 줄바꿈 · -- 가 들어 있을 수 있어 따옴표 안팎을 따져 가며 자른다.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inQuote) {
      // '' 는 따옴표 글자지만, 닫았다 바로 여는 것으로 봐도 결과가 같다
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
    } else if (ch === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) out.push(statement);
      start = i + 1;
    } else if (ch === '-' && sql[i + 1] === '-' && !sql.slice(start, i).trim()) {
      // 문장 사이의 주석 줄
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      start = i + 1;
    }
  }
  return out;
}

/** 우리 백업이 쓰는 문장 꼴만 받는다 — 다른 것이 섞여 있으면 실행하지 않는다 */
const KNOWN = new RegExp(`^(DELETE FROM|INSERT INTO|UPDATE) (${TABLES.join('|')})\\b`);
const PRAGMA = 'PRAGMA defer_foreign_keys = ON';

/**
 * 화면에서 되돌릴 때 실행할 문장들.
 * 로그인 계정(users)은 뺀다 — 되돌린 뒤 비밀번호가 옛것으로 돌아가 로그인이 막히면 안 된다.
 * 백업 파일이 아닌 글이면 빈 목록을 돌려준다.
 */
export function restoreStatements(sql: string): string[] {
  const all = splitStatements(sql);
  if (!all.length || all.some((s) => s !== PRAGMA && !KNOWN.test(s))) return [];
  return all.filter((s) => !/^(DELETE FROM|INSERT INTO|UPDATE) users\b/.test(s));
}

/**
 * 백업 하나로 장부를 되돌린다.
 * 먼저 지금 상태를 따로 떠 두고(되돌리기를 되돌릴 수 있게), 문장을 한 묶음으로 실행한다.
 * 묶음은 하나라도 실패하면 전부 없던 일이 되므로 중간에 멈춰 반쯤 지워진 장부가 남지 않는다.
 */
export async function restoreBackup(env: Env, key: string): Promise<{ safety: BackupEntry } | { error: string }> {
  const sql = await readBackup(env, key);
  if (!sql) return { error: '백업을 찾을 수 없습니다.' };
  const statements = restoreStatements(sql);
  if (!statements.length) return { error: '이 백업은 되돌릴 수 없는 모양입니다.' };

  const safety = await runBackup(env, '되돌리기 직전');
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  return { safety };
}

/** 백업을 만들어 KV 에 넣고, 오래된 것은 지운다. note 가 있으면 그날 백업을 덮지 않게 따로 둔다 */
export async function runBackup(env: Env, note?: string): Promise<BackupEntry> {
  const sql = await dumpDatabase(env.DB);

  const counted = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM work_logs) + (SELECT COUNT(*) FROM statement_lines) AS n`
  ).first<{ n: number }>();

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const entry: BackupEntry = {
    // 따로 두는 것은 시각까지 붙인다 (2026-10-03-before-restore-0912)
    key: note ? `${KEY_PREFIX}${date}-before-restore-${now.toISOString().slice(11, 16).replace(':', '')}` : `${KEY_PREFIX}${date}`,
    date,
    createdAt: now.toISOString(),
    bytes: new TextEncoder().encode(sql).length,
    rows: counted?.n ?? 0,
    ...(note ? { note } : {}),
  };

  // 같은 날 두 번 돌면 덮어쓴다 (하루 한 벌만 남긴다)
  await env.BACKUPS.put(entry.key, sql, {
    metadata: entry,
    expirationTtl: KEEP_DAYS * 86_400,
  });

  return entry;
}

export async function listBackups(env: Env): Promise<BackupEntry[]> {
  const { keys } = await env.BACKUPS.list<BackupEntry>({ prefix: KEY_PREFIX });
  return keys
    .map((k) => k.metadata ?? { key: k.name, date: k.name.slice(KEY_PREFIX.length), createdAt: '', bytes: 0, rows: 0 })
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export const readBackup = (env: Env, key: string) => env.BACKUPS.get(key, 'text');
