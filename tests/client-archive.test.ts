// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { archiveClientSites } from '../worker/clientArchive';

// node:sqlite 를 워커의 D1 처럼 쓰게 감싼다 (prepare → bind → run/first)
function fakeD1() {
  const d = new DatabaseSync(':memory:');
  d.exec(fs.readFileSync('migrations/0001_init.sql', 'utf8'));
  const db = {
    prepare(sql: string) {
      const stmt = d.prepare(sql);
      const bound = (args: unknown[]) => ({
        run: async () => stmt.run(...(args as never[])),
        first: async <T>() => (stmt.get(...(args as never[])) ?? null) as T | null,
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    },
  };
  return { d, db: db as unknown as D1Database };
}

function seed(d: DatabaseSync) {
  d.exec(`INSERT INTO clients (id, name) VALUES (1, '가나'), (2, '다라');
          INSERT INTO sites (id, client_id, name, label) VALUES
            (1, 1, '동쪽', '가나(동쪽)'), (2, 1, '서쪽', '가나(서쪽)'), (3, 2, '남쪽', '다라(남쪽)');`);
}

const archivedOf = (d: DatabaseSync) =>
  d.prepare('SELECT id, archived FROM sites ORDER BY id').all().map((r) => `${r.id}:${r.archived}`);

describe('거래처 보관 — 소속 현장도 함께', () => {
  it('보관하면 그 거래처의 현장만 보관된다', async () => {
    const { d, db } = fakeD1();
    seed(d);
    await archiveClientSites(db, 1, true);
    expect(archivedOf(d)).toEqual(['1:1', '2:1', '3:0']);
  });

  it('되살리면 그 거래처의 현장도 되살아난다', async () => {
    const { d, db } = fakeD1();
    seed(d);
    d.exec('UPDATE sites SET archived = 1');
    await archiveClientSites(db, 1, false);
    expect(archivedOf(d)).toEqual(['1:0', '2:0', '3:1']);
  });
});
