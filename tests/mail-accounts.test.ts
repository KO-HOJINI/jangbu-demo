// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { lock, unlock, VaultError } from '../worker/mailVault';
import { accountAddress, contactLabel, parseAccountInput, PREVIOUS_RECIPIENTS_SQL, removeVoidSql } from '../worker/mailAccounts';

describe('메일 계정 비밀번호 잠그기', () => {
  it('잠근 글자에는 비밀번호가 보이지 않고, 같은 열쇠로 풀면 원래 글자다', async () => {
    const stored = await lock('서버 열쇠', 'ABCD1234EFGH');
    expect(stored).not.toContain('ABCD1234EFGH');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(await unlock('서버 열쇠', stored)).toBe('ABCD1234EFGH');
  });

  it('같은 비밀번호도 잠글 때마다 다른 글자가 된다', async () => {
    expect(await lock('k', 'same')).not.toBe(await lock('k', 'same'));
  });

  it('열쇠가 다르거나 글자가 망가졌으면 알아듣는 말로 알린다', async () => {
    const stored = await lock('열쇠 하나', 'pw');
    await expect(unlock('다른 열쇠', stored)).rejects.toBeInstanceOf(VaultError);
    await expect(unlock('열쇠 하나', 'v1.xx.yy')).rejects.toBeInstanceOf(VaultError);
    await expect(unlock('열쇠 하나', '그냥 글자')).rejects.toBeInstanceOf(VaultError);
  });
});

describe('메일 계정 적은 값 확인', () => {
  it('아이디는 앞뒤 빈칸을 떼고 소문자로, 이름은 비어도 된다', () => {
    expect(parseAccountInput({ username: '  HanGang01 ', password: ' ABCD1234EFGH ', label: ' 한강중기 ' }, true)).toEqual({
      ok: true,
      value: { username: 'hangang01', password: 'ABCD1234EFGH', label: '한강중기' },
    });
    // 네이버 주소 전체를 적어도 아이디만 남긴다 (같은 계정이 두 번 등록되지 않게)
    expect(parseAccountInput({ username: 'A@Naver.com', password: 'x' }, true)).toMatchObject({ ok: true, value: { username: 'a', label: null } });
    expect(parseAccountInput({ username: 'a@daum.net', password: 'x' }, true)).toMatchObject({ ok: true, value: { username: 'a@daum.net' } });
  });

  it('아이디가 없거나 모양이 이상하면 거절한다', () => {
    expect(parseAccountInput({ username: '', password: 'x' }, true)).toMatchObject({ ok: false });
    expect(parseAccountInput({ username: '한글 아이디', password: 'x' }, true)).toMatchObject({ ok: false });
    expect(parseAccountInput({ username: 'a@b', password: 'x' }, true)).toMatchObject({ ok: false });
  });

  it('새로 등록할 때는 비밀번호가 꼭 있어야 하고, 고칠 때는 비우면 그대로 둔다', () => {
    expect(parseAccountInput({ username: 'hangang' }, true)).toMatchObject({ ok: false });
    expect(parseAccountInput({ username: 'hangang', password: '  ' }, false)).toMatchObject({ ok: true, value: { password: null } });
  });

  it('보내는 주소는 아이디만 적었으면 @naver.com 을 붙인다', () => {
    expect(accountAddress('hangang01')).toBe('hangang01@naver.com');
    expect(accountAddress('hangang@naver.com')).toBe('hangang@naver.com');
  });
});

/** 실제 SQLite 에 마이그레이션을 그대로 올려서 확인한다 */
function db() {
  const d = new DatabaseSync(':memory:');
  for (const name of fs.readdirSync('migrations').sort()) {
    // 0002·0003 은 처음 자료(현장·계정)라 시험에는 필요 없다
    if (name.startsWith('0002') || name.startsWith('0003')) continue;
    d.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  }
  d.exec('PRAGMA foreign_keys = ON');
  d.exec(`INSERT INTO companies (id, name, biz_no) VALUES (1, '가나중기', '111-11-11111')`);
  d.exec(`INSERT INTO clients (id, name) VALUES (1, '다라건설'), (2, '마바건설')`);
  return d;
}

const addStatement = (d: DatabaseSync, id: number, status: string, clientId = 1) =>
  d
    .prepare(
      `INSERT INTO statements (id, company_id, client_id, issue_date, period_start, period_end, supplier_name, customer_name, status)
       VALUES (?, 1, ?, '2026-10-01', '2026-09-01', '2026-09-30', '가나중기', '다라건설', ?)`
    )
    .run(id, clientId, status);

const addQuote = (d: DatabaseSync, id: number, status: string, clientId = 1) =>
  d
    .prepare(
      `INSERT INTO quotes (id, company_id, client_id, issue_date, supplier_name, customer_name, status) VALUES (?, 1, ?, '2026-10-01', '가나중기', '다라건설', ?)`
    )
    .run(id, clientId, status);

describe('발행한 문서는 취소한 뒤에만 지운다', () => {
  it('발행 상태의 명세표는 지워지지 않고, 취소한 것만 지워진다 (줄·메일 기록도 함께)', () => {
    const d = db();
    addStatement(d, 1, 'issued');
    addStatement(d, 2, 'void');
    d.exec(`INSERT INTO statement_lines (statement_id, line_no, work_date, supply_amount, vat_amount) VALUES (2, 1, '2026-09-10', 100, 10)`);
    d.exec(`INSERT INTO statement_emails (statement_id, to_addrs, status) VALUES (2, 'a@b.com', 'sent')`);

    const remove = d.prepare(removeVoidSql('statements'));
    expect(remove.get(1)).toBeUndefined();
    expect(remove.get(2)).toEqual({ id: 2 });

    expect(d.prepare('SELECT id FROM statements ORDER BY id').all()).toEqual([{ id: 1 }]);
    expect(d.prepare('SELECT COUNT(*) AS n FROM statement_lines').get()).toEqual({ n: 0 });
    expect(d.prepare('SELECT COUNT(*) AS n FROM statement_emails').get()).toEqual({ n: 0 });
  });

  it('견적서도 같다', () => {
    const d = db();
    addQuote(d, 1, 'issued');
    addQuote(d, 2, 'void');
    d.exec(`INSERT INTO quote_lines (quote_id, line_no, supply_amount, vat_amount) VALUES (2, 1, 100, 10)`);
    d.exec(`INSERT INTO quote_emails (quote_id, to_addrs, status) VALUES (2, 'a@b.com', 'sent')`);

    const remove = d.prepare(removeVoidSql('quotes'));
    expect(remove.get(1)).toBeUndefined();
    expect(remove.get(2)).toEqual({ id: 2 });
    expect(d.prepare('SELECT COUNT(*) AS n FROM quote_lines').get()).toEqual({ n: 0 });
    expect(d.prepare('SELECT COUNT(*) AS n FROM quote_emails').get()).toEqual({ n: 0 });
  });
});

describe('전에 보낸 주소', () => {
  it('같은 거래처에 명세표·견적서로 보낸 주소를 최근 것부터 — 실패한 것과 다른 거래처는 뺀다', () => {
    const d = db();
    addStatement(d, 1, 'issued');
    addStatement(d, 2, 'issued', 2);
    addQuote(d, 1, 'issued');
    d.exec(`INSERT INTO statement_emails (statement_id, to_addrs, status, sent_at) VALUES
      (1, 'old@a.com', 'sent', '2026-09-01 00:00:00'),
      (1, 'fail@a.com', 'failed', '2026-09-05 00:00:00'),
      (2, 'other@b.com', 'sent', '2026-09-06 00:00:00')`);
    d.exec(`INSERT INTO quote_emails (quote_id, to_addrs, status, sent_at) VALUES (1, 'quote@a.com', 'sent', '2026-09-03 00:00:00')`);

    expect(d.prepare(PREVIOUS_RECIPIENTS_SQL).all(1).map((r) => r.to_addrs)).toEqual(['quote@a.com', 'old@a.com']);
  });
});

describe('받는 사람 추천에 붙는 담당자 설명', () => {
  it('거래처 전체 문서는 어느 현장 담당자인지 현장 이름을 같이 보인다', () => {
    expect(contactLabel('김철수', '다솜', true)).toBe('다솜 담당자 김철수');
  });
  it('현장을 고른 문서는 이름만 보인다', () => {
    expect(contactLabel('김철수', '다솜', false)).toBe('담당자 김철수');
  });
});
