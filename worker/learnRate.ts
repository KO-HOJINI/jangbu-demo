/**
 * M(규격)별 단가 자동 학습 및 등록 유틸리티 (방식 1)
 */

/** "07:00", "7:30", "7" 등을 분 단위(0~1440)로 변환. 실패 시 null */
export function parseTimeToMinutes(t: string | null | undefined): number | null {
  if (!t || typeof t !== 'string') return null;
  const trimmed = t.trim();
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const h = Number(match[1]);
  const m = match[2] ? Number(match[2]) : 0;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * 시작·종료 시간으로 반나절 여부를 판별한다.
 * - 두 시간이 모두 있고, 종료시간 - 시작시간이 5.5시간(330분) 이하인 경우 반나절(true)로 판별.
 * - 5.5시간 초과이거나 시작/종료 시간이 없거나 형식이 올바르지 않으면 하루(false)로 판별.
 */
export function isHalfDay(startTime?: string | null, endTime?: string | null): boolean {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return false;
  const diffMinutes = end - start;
  // 시작보다 종료가 빠르면(야간이거나 형식 오류) 안전하게 false (하루 기본값)
  if (diffMinutes <= 0) return false;
  return diffMinutes <= 330;
}

export interface LearnRateInput {
  site_id?: number | null;
  boom_size?: number | null;
  base_amount?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  /** 사용자가 골라 준 칸 — 있으면 시간으로 짐작하지 않는다 */
  slot?: 'half_day' | 'full_day' | null;
}

export type LearnRateResult =
  | { learned: false; reason: 'invalid_input' | 'already_exists' }
  | { learned: true; action: 'inserted' | 'updated'; slot: 'half_day' | 'full_day'; amount: number };

/**
 * 작업일보 등록 시 단가표(site_rates)에 없는 M(규격)별 금액을 자동 학습하여 등록한다.
 *
 * 규칙 (방식 1):
 * 1. site_id, boom_size, base_amount(>0)가 유효할 때만 동작.
 * 2. 작업 시간이 5.5시간 이하(예: 07:00~12:00)면 반나절(half_day_amount), 그 외이거나 시간 미입력 시 하루(full_day_amount)로 판별.
 * 3. [보호] 이미 등록되어 있는 단가 컬럼은 절대 덮어쓰지 않는다 (단발성 할인/특수 단가 보호).
 * 4. 해당 규격 행이 없으면 새로 추가(INSERT), 규격 행은 있지만 해당 슬롯이 NULL이면 보충(UPDATE).
 */
export async function autoLearnRate(db: D1Database, input: LearnRateInput): Promise<LearnRateResult> {
  const { site_id, boom_size, base_amount, start_time, end_time, slot: chosen } = input;

  if (
    typeof site_id !== 'number' ||
    site_id <= 0 ||
    typeof boom_size !== 'number' ||
    boom_size <= 0 ||
    typeof base_amount !== 'number' ||
    base_amount <= 0
  ) {
    return { learned: false, reason: 'invalid_input' };
  }

  const half = chosen ? chosen === 'half_day' : isHalfDay(start_time, end_time);
  const slot = half ? 'half_day' : 'full_day';

  const existing = await db
    .prepare('SELECT id, half_day_amount, full_day_amount FROM site_rates WHERE site_id = ? AND boom_size = ?')
    .bind(site_id, boom_size)
    .first<{ id: number; half_day_amount: number | null; full_day_amount: number | null }>();

  if (!existing) {
    // 해당 현장에 이 규격(M) 행이 아예 없는 경우: 새로 추가
    const halfAmount = half ? base_amount : null;
    const fullAmount = half ? null : base_amount;
    await db
      .prepare('INSERT INTO site_rates (site_id, boom_size, half_day_amount, full_day_amount) VALUES (?, ?, ?, ?)')
      .bind(site_id, boom_size, halfAmount, fullAmount)
      .run();
    return { learned: true, action: 'inserted', slot, amount: base_amount };
  }

  // 기존 행이 있는 경우: 해당 슬롯이 비어 있을 때만 채우고, 이미 등록된 단가는 절대 덮어쓰지 않고 보존
  if (half && existing.half_day_amount == null) {
    await db
      .prepare('UPDATE site_rates SET half_day_amount = ? WHERE id = ?')
      .bind(base_amount, existing.id)
      .run();
    return { learned: true, action: 'updated', slot: 'half_day', amount: base_amount };
  }

  if (!half && existing.full_day_amount == null) {
    await db
      .prepare('UPDATE site_rates SET full_day_amount = ? WHERE id = ?')
      .bind(base_amount, existing.id)
      .run();
    return { learned: true, action: 'updated', slot: 'full_day', amount: base_amount };
  }

  return { learned: false, reason: 'already_exists' };
}
