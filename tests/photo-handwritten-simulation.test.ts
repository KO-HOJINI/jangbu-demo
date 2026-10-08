// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Masters, WorkLogRow } from '../shared/types';
import { markDuplicates, matchOperator, matchSite, normalizeRows, photoDate } from '../src/lib/photoLog';
import { extractJsonArray } from '../worker/routes/photoLogs';

const site = (id: number, client_id: number, name: string, label: string, archived = 0) =>
  ({ id, client_id, name, label, archived }) as Masters['sites'][number];

// 실제 DB 마스터 데이터 형태
const masters: Masters = {
  companies: [{ id: 1, name: '한강중기' }],
  clients: [
    { id: 1, name: '가온', full_name: '가온건설' },
    { id: 2, name: '아라', full_name: '아라개발(주)' },
    { id: 3, name: '나래', full_name: '나래건설(주)' },
  ],
  sites: [
    site(1, 1, '가산동', '가온(가산동)'),
    site(2, 2, '광장', '아라(광장)'),
    site(3, 3, '마곡', '나래(마곡)'),
  ],
  operators: [
    { id: 1, name: '김기사', archived: 0 },
    { id: 2, name: '이기사', archived: 0 },
    { id: 3, name: '임기사', archived: 0 },
  ],
  rates: [
    { site_id: 1, boom_size: 37, half_day_amount: null, full_day_amount: 1_200_000 },
    { site_id: 2, boom_size: 42, half_day_amount: null, full_day_amount: 1_400_000 },
    { site_id: 3, boom_size: 42, half_day_amount: null, full_day_amount: 1_400_000 },
    { site_id: 3, boom_size: 37, half_day_amount: null, full_day_amount: 1_200_000 },
  ],
  suggestions: { descriptions: [], boomSizes: [], baseAmounts: [], businessOwners: [] },
};

// 방금 생성한 실제 악필 작업일보 사진에서 AI가 읽어낸 원본 행들
// (사진의 취소선, 약칭, 오타, 불완전 시간 표기 등이 그대로 반영된 형태)
const HANDWRITTEN_RAW_AI_OUTPUT = `
\`\`\`json
[
  {"date":"9/12","site":"광장","work":"기초","time":"07:00~17:00","m":42,"ot":1,"pour":150,"amount":null,"operator":"김기사"},
  {"date":"9/13","site":"가산동","work":"벽체","time":"08:00~16:00","m":37,"ot":0,"pour":80,"amount":null,"operator":"김기사"},
  {"date":"9/14","site":"마곡","work":"슬라브","time":"07:00~15:00","m":42,"ot":0,"pour":120,"amount":null,"operator":"이기사"},
  {"date":"9/15","site":"마곡","work":null,"time":"07:00~15:00","m":42,"ot":0,"pour":120,"amount":null,"operator":"김기사"},
  {"date":"9/16","site":"가산동","work":"슬라브","time":"08:00~16:00","m":37,"ot":0,"pour":80,"amount":null,"operator":"김기사"},
  {"date":"9/18","site":null,"work":null,"time":"07:00~17:00","m":37,"ot":1,"pour":150,"amount":null,"operator":"김기사"},
  {"date":"9/19","site":"가산동","work":"벽체","time":"08:00~17:00","m":37,"ot":1,"pour":120,"amount":null,"operator":"김기사"},
  {"date":"9/20","site":"마곡","work":"벽체","time":"07:00~16:00","m":42,"ot":0,"pour":120,"amount":null,"operator":"임기사"},
  {"date":"9/21","site":"마곡","work":"기체","time":"08:00~15:00","m":37,"ot":1,"pour":50,"amount":null,"operator":"김기사"}
]
\`\`\`
`;

describe('악필 수기 작업일보 사진 파싱 및 정규화 검증', () => {
  it('1. AI 응답 문자열에서 마크다운 울타리를 벗기고 JSON 배열을 정상 추출한다', () => {
    const array = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT);
    expect(array).not.toBeNull();
    expect(Array.isArray(array)).toBe(true);
    expect(array!.length).toBe(9);
  });

  it('2. 약칭 현장명(광장, 가산동, 마곡)이 정식 마스터 현장 ID로 정확히 매핑된다', () => {
    const rawRows = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT)!;
    const rows = normalizeRows(rawRows, masters, '2026-09-29');

    // 1행: 광장 -> 아라(광장) (id: 2)
    expect(rows[0].site_id).toBe(2);
    expect(rows[0].site_text).toBe('광장');

    // 2행: 가산동 -> 가온(가산동) (id: 1)
    expect(rows[1].site_id).toBe(1);
    expect(rows[1].site_text).toBe('가산동');

    // 3행: 마곡 -> 나래(마곡) (id: 3)
    expect(rows[2].site_id).toBe(3);
    expect(rows[2].site_text).toBe('마곡');

    // 6행: 취소선으로 지워진 행(site: null) -> site_id: null, include: false (부모님 확인 필요)
    expect(rows[5].site_id).toBeNull();
    expect(rows[5].include).toBe(false);
  });

  it('3. 기사님 이름(김기사, 이기사, 임기사)이 정확히 매핑된다', () => {
    const rawRows = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT)!;
    const rows = normalizeRows(rawRows, masters, '2026-09-29');

    expect(rows[0].operator_id).toBe(1); // 김기사
    expect(rows[2].operator_id).toBe(2); // 이기사
    expect(rows[7].operator_id).toBe(3); // 임기사
  });

  it('4. 날짜가 2026-09-XX 형태의 ISO 규격으로 정상 변환된다', () => {
    const rawRows = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT)!;
    const rows = normalizeRows(rawRows, masters, '2026-09-29');

    expect(rows[0].work_date).toBe('2026-09-12');
    expect(rows[1].work_date).toBe('2026-09-13');
    expect(rows[8].work_date).toBe('2026-09-21');
  });

  it('5. 금액이 적혀있지 않은 줄은 현장 단가표에서 자동으로 금액을 채우고 amount_auto=1로 표시한다', () => {
    const rawRows = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT)!;
    const rows = normalizeRows(rawRows, masters, '2026-09-29');

    // 1행: 아라(광장) 42M -> 단가표 1,400,000원 자동 채움
    expect(rows[0].base_amount).toBe(1_400_000);
    expect(rows[0].amount_auto).toBe(1);

    // 2행: 가온(가산동) 37M -> 단가표 1,200,000원 자동 채움
    expect(rows[1].base_amount).toBe(1_200_000);
    expect(rows[1].amount_auto).toBe(1);
  });

  it('6. 이미 장부에 들어있는 작업이 있으면 duplicateOf로 감지하여 체크를 꺼 둔다', () => {
    const rawRows = extractJsonArray(HANDWRITTEN_RAW_AI_OUTPUT)!;
    const normalized = normalizeRows(rawRows, masters, '2026-09-29');

    // 기존 장부에 9/12 광장 42M 작업(id: 99)이 이미 등록되어 있다고 가정
    const existingLog = {
      id: 99,
      work_date: '2026-09-12',
      site_id: 2,
      boom_size: 42,
      operator_id: 1,
      site_label: '아라(광장)',
      operator_name: '김기사',
    } as WorkLogRow;

    const checked = markDuplicates(normalized, [existingLog]);

    // 9/12 작업은 중복 감지되어 include=false
    expect(checked[0].duplicateOf?.id).toBe(99);
    expect(checked[0].include).toBe(false);

    // 다른 날짜(9/13 등) 작업은 중복이 아니므로 정상적으로 include=true
    expect(checked[1].duplicateOf).toBeNull();
    expect(checked[1].include).toBe(true);
  });
});
