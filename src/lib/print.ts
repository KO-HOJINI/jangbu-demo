/**
 * 브라우저는 "PDF로 저장" 할 때 문서 제목(document.title)을 기본 파일 이름으로 쓴다.
 * 인쇄 직전에만 제목을 바꿔치기해서 파일 이름이 알아서 정해지게 한다.
 */

interface FileNameSource {
  issue_date: string;
  period_end?: string;
  customer_name: string;
  customer_site_name?: string | null;
}

/** 26년 8월 아라 광장 — 기존에 쓰시던 파일 이름 규칙 그대로 */
export function statementFileName(s: FileNameSource): string {
  const base = s.period_end || s.issue_date;
  const [year, month] = base.split('-');

  // 상호에서 (주), 주식회사, 개발 같은 꼬리를 떼어 '아라개발(주)' -> '아라'
  const client = s.customer_name
    .replace(/\((주|유|합)\)|주식회사|㈜/g, '')
    .replace(/(개발|건설|산업|중기|기업)\s*$/, '')
    .trim();

  // 거래처와 현장 이름이 같으면(가온 현장 「가온」) 한 번만 — 「26년 8월 가온 가온」 이 되던 것
  const site = s.customer_site_name?.trim();
  return [`${year.slice(2)}년`, `${Number(month)}월`, client, site && site !== client ? site : null]
    .filter(Boolean)
    .join(' ');
}

export function printWithFileName(fileName: string): void {
  const original = document.title;
  document.title = fileName;

  // 인쇄 대화상자가 닫힌 뒤 원래 제목으로 되돌린다
  const restore = () => {
    document.title = original;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  window.print();

  // afterprint 를 안 쏘는 브라우저를 위한 보험
  setTimeout(restore, 1000);
}
