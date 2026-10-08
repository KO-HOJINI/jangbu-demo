// @vitest-environment node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { autoLearnRate, isHalfDay, parseTimeToMinutes } from '../worker/learnRate';

function fakeD1() {
  const d = new DatabaseSync(':memory:');
  d.exec(fs.readFileSync('migrations/0001_init.sql', 'utf8'));
  // seed clients and sites for foreign key constraints
  d.exec(`
    INSERT INTO clients (id, name) VALUES (1, '테스트거래처');
    INSERT INTO sites (id, client_id, name, label) VALUES (1, 1, '테스트현장1', '테스트현장1');
    INSERT INTO sites (id, client_id, name, label) VALUES (2, 1, '테스트현장2', '테스트현장2');
  `);
  const db = {
    prepare(sql: string) {
      const stmt = d.prepare(sql);
      const bound = (args: unknown[]) => ({
        run: async () => stmt.run(...(args as never[])),
        first: async <T>() => (stmt.get(...(args as never[])) ?? null) as T | null,
        all: async <T>() => ({ results: stmt.all(...(args as never[])) as T[] }),
      });
      return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
    },
  };
  return { d, db: db as unknown as D1Database };
}

describe('시간 파싱 및 반나절 판별 (isHalfDay)', () => {
  it('parseTimeToMinutes: 시:분 형식을 정확한 분으로 환산한다', () => {
    expect(parseTimeToMinutes('07:00')).toBe(420);
    expect(parseTimeToMinutes('7:30')).toBe(450);
    expect(parseTimeToMinutes('7')).toBe(420);
    expect(parseTimeToMinutes('12:00')).toBe(720);
    expect(parseTimeToMinutes('17:30')).toBe(1050);
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes(null)).toBeNull();
    expect(parseTimeToMinutes(undefined)).toBeNull();
    expect(parseTimeToMinutes('25:00')).toBeNull();
    expect(parseTimeToMinutes('07:60')).toBeNull();
  });

  it('5.5시간(330분) 이하 작업은 반나절(true)로 판별한다', () => {
    // 07:00 ~ 12:00 = 5시간
    expect(isHalfDay('07:00', '12:00')).toBe(true);
    // 07:00 ~ 12:30 = 5.5시간
    expect(isHalfDay('07:00', '12:30')).toBe(true);
    // 오후 반나절: 13:00 ~ 17:30 = 4.5시간
    expect(isHalfDay('13:00', '17:30')).toBe(true);
  });

  it('5.5시간 초과 작업은 하루(false)로 판별한다', () => {
    // 07:00 ~ 13:00 = 6시간
    expect(isHalfDay('07:00', '13:00')).toBe(false);
    // 07:00 ~ 17:00 = 10시간
    expect(isHalfDay('07:00', '17:00')).toBe(false);
  });

  it('시간이 없거나 잘못된 경우 기본값인 하루(false)로 판별한다', () => {
    expect(isHalfDay(null, null)).toBe(false);
    expect(isHalfDay('07:00', null)).toBe(false);
    expect(isHalfDay(null, '17:00')).toBe(false);
    // 시작시간이 종료시간보다 늦는 경우
    expect(isHalfDay('17:00', '07:00')).toBe(false);
  });
});

describe('M별 단가 자동 학습 및 등록 (autoLearnRate)', () => {
  it('유효하지 않은 입력(0원, 음수, null)은 학습하지 않는다', async () => {
    const { db } = fakeD1();
    const res1 = await autoLearnRate(db, { site_id: 1, boom_size: 42, base_amount: 0 });
    expect(res1.learned).toBe(false);

    const res2 = await autoLearnRate(db, { site_id: 1, boom_size: null, base_amount: 1000000 });
    expect(res2.learned).toBe(false);

    const res3 = await autoLearnRate(db, { site_id: null, boom_size: 42, base_amount: 1000000 });
    expect(res3.learned).toBe(false);
  });

  it('DB에 없는 신규 규격(M)은 하루 단가로 최초 1회 등록된다', async () => {
    const { d, db } = fakeD1();
    const res = await autoLearnRate(db, {
      site_id: 1,
      boom_size: 60,
      base_amount: 1700000,
      start_time: '07:00',
      end_time: '17:00',
    });

    expect(res.learned).toBe(true);
    if (res.learned) {
      expect(res.action).toBe('inserted');
      expect(res.slot).toBe('full_day');
      expect(res.amount).toBe(1700000);
    }

    const row = d.prepare('SELECT * FROM site_rates WHERE site_id = ? AND boom_size = ?').get(1, 60) as any;
    expect(row).toBeDefined();
    expect(row.boom_size).toBe(60);
    expect(row.half_day_amount).toBeNull();
    expect(row.full_day_amount).toBe(1700000);
  });

  it('신규 규격이 반나절 작업인 경우 half_day_amount로 등록된다', async () => {
    const { d, db } = fakeD1();
    const res = await autoLearnRate(db, {
      site_id: 1,
      boom_size: 52,
      base_amount: 1100000,
      start_time: '07:00',
      end_time: '12:00',
    });

    expect(res.learned).toBe(true);
    if (res.learned) {
      expect(res.action).toBe('inserted');
      expect(res.slot).toBe('half_day');
    }

    const row = d.prepare('SELECT * FROM site_rates WHERE site_id = ? AND boom_size = ?').get(1, 52) as any;
    expect(row.half_day_amount).toBe(1100000);
    expect(row.full_day_amount).toBeNull();
  });

  it('기존 행에 빈 슬롯(NULL)이 있는 경우 보충 업데이트한다', async () => {
    const { d, db } = fakeD1();
    // 기존에 하루 단가만 있던 42M (half_day_amount = NULL)
    d.exec(`INSERT INTO site_rates (site_id, boom_size, half_day_amount, full_day_amount) VALUES (1, 42, NULL, 1400000)`);

    // 반나절 작업 등록
    const res = await autoLearnRate(db, {
      site_id: 1,
      boom_size: 42,
      base_amount: 900000,
      start_time: '07:00',
      end_time: '12:00',
    });

    expect(res.learned).toBe(true);
    if (res.learned) {
      expect(res.action).toBe('updated');
      expect(res.slot).toBe('half_day');
    }

    const row = d.prepare('SELECT * FROM site_rates WHERE site_id = ? AND boom_size = ?').get(1, 42) as any;
    expect(row.half_day_amount).toBe(900000);
    expect(row.full_day_amount).toBe(1400000); // 기존 하루 단가는 안전하게 유지
  });

  it('기존에 이미 단가가 등록되어 있는 경우 절대로 덮어쓰지 않고 보호한다', async () => {
    const { d, db } = fakeD1();
    // 32M: 반나절 70만, 하루 100만 기등록
    d.exec(`INSERT INTO site_rates (site_id, boom_size, half_day_amount, full_day_amount) VALUES (1, 32, 700000, 1000000)`);

    // 단발성 할인으로 90만원에 하루 작업 등록
    const res = await autoLearnRate(db, {
      site_id: 1,
      boom_size: 32,
      base_amount: 900000,
      start_time: '07:00',
      end_time: '17:00',
    });

    expect(res.learned).toBe(false);
    if (!res.learned) {
      expect(res.reason).toBe('already_exists');
    }

    const row = d.prepare('SELECT * FROM site_rates WHERE site_id = ? AND boom_size = ?').get(1, 32) as any;
    expect(row.full_day_amount).toBe(1000000); // 덮어써지지 않고 100만 원 그대로 보존!
    expect(row.half_day_amount).toBe(700000);
  });
});

describe('반나절·하루를 사용자가 골라 준 경우 (slot)', () => {
  it('시간이 없어도 고른 칸에 등록한다', async () => {
    const { d, db } = fakeD1();
    const res = await autoLearnRate(db, { site_id: 1, boom_size: 42, base_amount: 700000, slot: 'half_day' });
    expect(res).toMatchObject({ learned: true, slot: 'half_day', amount: 700000 });
    expect(d.prepare('SELECT half_day_amount, full_day_amount FROM site_rates WHERE site_id = 1 AND boom_size = 42').get()).toEqual({
      half_day_amount: 700000,
      full_day_amount: null,
    });
  });

  it('고른 것이 시간으로 짐작한 것보다 앞선다', async () => {
    const { db } = fakeD1();
    const res = await autoLearnRate(db, { site_id: 1, boom_size: 42, base_amount: 1400000, start_time: '07:00', end_time: '12:00', slot: 'full_day' });
    expect(res).toMatchObject({ learned: true, slot: 'full_day' });
  });
});
