import { longDate, won } from '../lib/format';
import type { QuoteSheetLine } from './QuoteSheet';

/**
 * 휴대폰용 견적서 요약 (큰 글씨로 보기).
 * A4 양식을 휴대폰 폭에 맞추면 0.4배 정도로 줄어 글씨가 너무 작다.
 * 같은 내용을 휴대폰 글씨 크기로 풀어 보여준다. 화면 전용이라 인쇄/PDF 는 언제나 A4 양식으로 나간다.
 */
export default function QuoteSummary({
  title,
  customer,
  siteName,
  supplier,
  issueDate,
  lines,
  total,
  note,
  isVoid,
}: {
  title: string;
  customer: string;
  siteName?: string | null;
  supplier: string;
  issueDate: string;
  lines: QuoteSheetLine[];
  total: number;
  note: string | null;
  isVoid?: boolean;
}) {
  // 세액은 A4 양식에 찍히는 줄마다의 세액을 더한다 — 합계에 10% 를 다시 곱하면 반올림 때문에 몇 원 어긋날 수 있다
  const vat = lines.reduce((sum, line) => sum + line.vat_amount, 0);
  const grandTotal = total + vat;

  return (
    <section aria-label="견적서 요약" className="space-y-2 print:hidden">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-caption text-slate-600">{title}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lead font-bold">{customer}</span>
              {siteName && <span className="text-body font-semibold text-slate-700">({siteName})</span>}
            </div>
          </div>
          {isVoid && (
            <span className="rounded-md bg-slate-200 px-2.5 py-1 text-caption font-bold text-slate-700">취소됨</span>
          )}
        </div>

        <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
          <span className="text-body text-slate-700">합계 (VAT 포함)</span>
          <span className="text-display font-bold tabular">{won(grandTotal)}원</span>
        </div>
        <div className="mt-1 flex justify-between text-caption text-slate-600 tabular">
          <span>공급가액 {won(total)}원</span>
          <span>세액 {won(vat)}원</span>
        </div>

        <div className="mt-3 flex flex-wrap justify-between gap-x-3 text-caption text-slate-600">
          <span>공급자 {supplier}</span>
          <span>{longDate(issueDate)}</span>
        </div>
      </div>

      <ol className="space-y-2">
        {lines.map((line, i) => (
          <li key={line.id ?? i} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-body font-bold text-slate-900">
                {line.item_name || '견적 품목'}
              </span>
              <span className="ml-auto text-lead font-bold tabular">{won(line.supply_amount)}원</span>
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 text-caption tabular">
              {[
                { label: '규격', value: line.spec },
                { label: '산출근거 / 수량', value: line.basis },
                { label: '공급가액', value: `${won(line.supply_amount)}원` },
                { label: '세액', value: `${won(line.vat_amount)}원` },
              ].map(({ label, value }) => (
                <div key={label} className="min-w-0">
                  <span className="block text-slate-600">{label}</span>
                  <span className="block text-slate-900">{value || '-'}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
        {!lines.length && (
          <li className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-body text-slate-600">
            견적 항목이 없습니다.
          </li>
        )}
      </ol>

      <p className="px-1 text-caption text-slate-700">비고: {note || '-'}</p>
    </section>
  );
}
