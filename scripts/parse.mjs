/**
 * 엑셀에서 읽은 값을 다듬는 함수들.
 * 이관 스크립트와 테스트가 같이 쓰도록 따로 뺐다.
 */

export const isNum = (v) => v != null && v !== '' && !Number.isNaN(Number(v));

/** 엑셀 날짜 일련번호 -> YYYY-MM-DD */
export const serialToISO = (serial) =>
  new Date(Math.round((Number(serial) - 25569) * 86400000)).toISOString().slice(0, 10);

/**
 * 작업시간 정규화.
 * "07:00~16:00" 형태와, 엑셀이 숫자로 뭉개버린 7001600 / 1.30016E7 형태를 모두 받는다.
 * (HHMM + HHMM 이 이어붙은 값이라 8자리로 zero-pad 후 4자리씩 자른다)
 */
export function parseTimeRange(raw) {
  if (raw == null || raw === '') return [null, null];
  const text = String(raw).trim();

  const m = /^(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})$/.exec(text);
  if (m) return [`${m[1].padStart(2, '0')}:${m[2]}`, `${m[3].padStart(2, '0')}:${m[4]}`];

  if (isNum(text)) {
    const value = Math.round(Number(text));
    // 원래 값은 HHMM+HHMM 이 이어붙은 것이라 최소 여섯 자리다.
    // 이 문턱이 없으면 123 같은 엉뚱한 숫자가 00:00~01:23 으로 조용히 둔갑한다.
    if (value < 100_000 || value > 23_592_359) return [null, null];

    const digits = String(value).padStart(8, '0');
    const [sh, sm, eh, em] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6), digits.slice(6, 8)];
    if (+sh > 23 || +sm > 59 || +eh > 23 || +em > 59) return [null, null];
    return [`${sh}:${sm}`, `${eh}:${em}`];
  }
  return [null, null];
}

/** "아라(광장)" -> { client: '아라', site: '광장' } / "다솜" -> { client: '다솜', site: '다솜' } */
export function parseSiteLabel(label) {
  const m = /^(.*?)\s*[（(]\s*(.*?)\s*[)）]\s*$/.exec(label);
  return m ? { client: m[1].trim(), site: m[2].trim() } : { client: label, site: label };
}

/** SQL 문자열 리터럴로 감싼다 (작은따옴표는 두 번 써서 이스케이프) */
export const sqlQuote = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export const sqlNumber = (v) => (v == null ? 'NULL' : String(v));
