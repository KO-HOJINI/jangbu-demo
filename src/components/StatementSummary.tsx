import { longDate, shortDate, timeRange, won } from '../lib/format';
import type { SheetLine, SheetTotals } from './StatementSheet';

/**
 * 휴대폰용 명세표 요약.
 * A4 양식을 휴대폰 폭에 맞추면 0.44배로 줄어 글씨가 4pt 쯤이 되어 읽을 수 없다.
 * 같은 내용을 휴대폰 글씨 크기로 풀어 보여준다. 화면 전용이라 인쇄는 언제나 A4 양식으로 나간다.
 */
export default function StatementSummary({
  title,
  customer,
  siteName,
  supplier,
  issueDate,
  lines,
  totals,
  note,
  paidAt,
  isVoid,
  onPay,
  onUnpay,
  isPending,
}: {
  title: string;
  customer: string;
  siteName?: string | null;
  supplier: string;
  issueDate: string;
  lines: SheetLine[];
  totals: SheetTotals;
  note: string | null;
  paidAt?: string | null;
  isVoid?: boolean;
  onPay?: () => void;
  onUnpay?: () => void;
  isPending?: boolean;
}) {
  return (
    <section aria-label="명세표 요약" className="space-y-2 print:hidden">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-caption text-slate-600">{title}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lead font-bold">{customer}</span>
              {siteName && <span className="text-body font-semibold text-slate-700">({siteName})</span>}
            </div>
          </div>
          {isVoid ? (
            <span className="rounded-md bg-slate-200 px-2.5 py-1 text-caption font-bold text-slate-700">취소됨</span>
          ) : paidAt !== undefined ? (
            paidAt ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-caption font-bold text-emerald-800">
                ✓ 입금 완료 ({paidAt.slice(5)})
              </span>
            ) : (
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-caption font-bold text-rose-700">
                미수금
              </span>
            )
          ) : null}
        </div>

        {!isVoid && onPay && onUnpay && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            {paidAt ? (
              <button
                type="button"
                onClick={onUnpay}
                disabled={isPending}
                className="w-full rounded-xl border border-slate-300 py-2 text-caption text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {isPending ? '처리 중…' : '입금 취소 (미수금으로 되돌리기)'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onPay}
                disabled={isPending}
                className="w-full rounded-xl bg-emerald-700 py-2.5 text-body font-bold text-white hover:bg-emerald-800 disabled:opacity-40 shadow-sm"
              >
                {isPending ? '처리 중…' : '✓ 입금 완료 처리하기'}
              </button>
            )}
          </div>
        )}

        <div className="mt-3 flex items-baseline justify-between border-t border-slate-200 pt-3">
          <span className="text-body text-slate-700">합계</span>
          <span className="text-display font-bold tabular">{won(totals.totalAmount)}원</span>
        </div>
        <div className="mt-1 flex justify-between text-caption text-slate-600 tabular">
          <span>공급가액 {won(totals.supplyAmount)}</span>
          <span>세액 {won(totals.vatAmount)}</span>
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
              <span className="text-body font-bold tabular">{shortDate(line.work_date)}</span>
              <span className="min-w-0 flex-1 truncate text-body">{line.description || '작업 내용 없음'}</span>
              <span className="text-lead font-bold tabular">{won(line.supply_amount)}원</span>
            </div>
            {/* 작업일보 카드와 같은 꼴 — 줄마다 같은 칸이 같은 자리에 오고, 비어 있으면 「-」 */}
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 text-caption tabular">
              {[
                { label: '작업 시간', value: timeRange(line.start_time, line.end_time) },
                { label: '규격', value: line.boom_size != null ? `${line.boom_size}M` : '' },
                { label: 'OT 시간', value: line.ot_hours > 0 ? `${line.ot_hours}시간` : '', className: 'font-medium text-sky-700' },
                { label: '세액', value: `${won(line.vat_amount)}원` },
              ].map(({ label, value, className = 'text-slate-900' }) => (
                <div key={label} className="min-w-0">
                  <span className="block text-slate-600">{label}</span>
                  <span className={`block ${value ? className : 'text-slate-600'}`}>{value || '-'}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
        {!lines.length && (
          <li className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-body text-slate-600">
            명세표에 담긴 작업이 없습니다.
          </li>
        )}
      </ol>

      <p className="px-1 text-caption text-slate-700">비고: {note || '-'}</p>
    </section>
  );
}
