import type { ReactNode } from 'react';

export type InfoItem = {
  label: string;
  /** 비어 있으면(null·빈 글자) 그 칸은 아예 그리지 않는다 — 「-」만 줄줄이 서지 않게 */
  value: ReactNode;
  /** 한 줄을 다 쓴다 (주소처럼 긴 값) */
  wide?: boolean;
  /** 채워야 하는 값이 빠졌을 때 (단가 없음 등) */
  warn?: boolean;
};

/** 휴대폰 설정 상자(거래처·현장)의 「칸 이름 위, 값 아래」 목록. 두 탭이 같은 모양을 쓴다 */
export default function InfoGrid({ items, className = '' }: { items: InfoItem[]; className?: string }) {
  const shown = items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '');
  if (!shown.length) return null;
  return (
    <dl className={`mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-caption ${className}`}>
      {shown.map((i) => (
        <div key={i.label} className={`min-w-0 ${i.wide ? 'col-span-2' : ''}`}>
          <dt className="text-slate-600">{i.label}</dt>
          <dd className={`tabular ${i.warn ? 'font-medium text-amber-700' : 'text-slate-900'}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
