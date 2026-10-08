import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Masters, WorkLogRow } from '../../shared/types';
import { manwon, parseTimeRangeInput, shortDate, timeRange, weekday, won } from '../lib/format';
import { numOrNull, useWorkLogRow } from '../lib/useWorkLogRow';
import { AutoBadge, PhotoBadge } from './SourceBadge';

/**
 * 좁은 화면(휴대폰)에서 장부 한 줄을 보여주는 카드.
 * 15열짜리 표는 폰에서 가로로 밀어야 해서 읽지도 고치지도 못한다.
 */
export default function LedgerCard({
  row,
  masters,
  statementName,
  onError,
}: {
  row: WorkLogRow;
  masters: Masters;
  /** 발행된 명세표 이름 (8월 아라 광장) */
  statementName?: string;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // 금액 칸에 치고 있는 글자 (아래에 「140만 원」 으로 읽어 주려고)
  const [amountText, setAmountText] = useState<string | null>(null);
  const {
    save,
    saveBoomSize,
    saveSite,
    saveAmount,
    confirmRemove,
    update,
    justSaved,
    currentRate,
    isCustomAmount,
    isAutoAmount,
    version,
  } = useWorkLogRow(row, masters, onError);

  const tone = update.isPending ? 'opacity-50' : justSaved ? 'border-emerald-400 bg-emerald-50' : 'bg-white';

  const summary: { label: string; value: string | null; className?: string }[] = [
    { label: '작업 내용', value: row.description },
    { label: '작업 시간', value: timeRange(row.start_time, row.end_time), className: 'tabular text-slate-900' },
    { label: '규격', value: row.boom_size != null ? `${row.boom_size}M` : null, className: 'tabular text-slate-900' },
    { label: '기사님', value: row.operator_name },
    { label: 'OT 시간', value: row.ot_hours > 0 ? `${row.ot_hours}시간` : null, className: 'tabular font-medium text-sky-700' },
    { label: '타설량', value: row.pour_volume != null ? `${won(row.pour_volume)}m³` : null, className: 'tabular text-slate-900' },
    { label: '주유', value: row.fuel_amount ? `${won(row.fuel_amount)}원` : null, className: 'tabular text-slate-900' },
  ];

  return (
    <div className={`rounded-2xl border border-slate-200 p-4 transition-colors ${tone}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-body font-bold tabular">{shortDate(row.work_date)}</span>
        <span className="text-caption text-slate-600">({weekday(row.work_date)})</span>
        <Link
          to={`/sites/${row.site_id}`}
          className="text-body font-medium text-slate-900 hover:text-sky-700 hover:underline"
          title="현장 상세 및 담당자 연락처 보기"
        >
          {row.site_label}
        </Link>
        {row.entry_source === 'photo' && <PhotoBadge className="self-center" />}
        {isAutoAmount && <AutoBadge className="ml-auto self-center" />}
        <span
          className={`${isAutoAmount ? '' : 'ml-auto'} text-lead font-bold tabular ${isCustomAmount ? 'text-amber-700' : ''}`}
        >
          {won(row.supply_amount)}원
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-slate-100 pt-2.5 text-caption sm:grid-cols-4 md:grid-cols-6">
        {/* 비어 있는 칸도 「-」로 보인다 — 칸이 빠지면 자리가 줄마다 달라져 안 적은 것인지 알기 어렵다 */}
        {summary.map(({ label, value, className = 'text-slate-900' }) => (
          <div key={label} className="min-w-0">
            <span className="block text-caption text-slate-600">{label}</span>
            <span className={`block truncate ${value ? className : 'text-slate-600'}`}>{value || '-'}</span>
          </div>
        ))}
        {/* 비고는 길 수 있어 두 칸을 쓴다 (휴대폰에서 주유 옆 남는 자리) */}
        <div className="col-span-2 min-w-0">
          <span className="block text-caption text-slate-600">비고</span>
          <span className={`block ${row.note ? 'break-all text-slate-900' : 'text-slate-600'}`}>{row.note || '-'}</span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl border border-slate-300 px-4 py-2 text-caption hover:bg-slate-50"
        >
          {open ? '닫기' : '수정'}
        </button>
        {/* 삭제는 수정과 떨어뜨려 오른쪽 끝에, 붉게. 발행된 줄은 대신 그 명세표로 가는 길을 둔다 */}
        {row.statement_id ? (
          <Link
            to={`/statements/${row.statement_id}`}
            className="ml-auto min-w-0 truncate rounded-xl bg-emerald-50 px-3 py-2.5 text-caption leading-6 font-medium text-emerald-800 hover:bg-emerald-100"
          >
            {statementName ?? '발행된'} 명세표
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => confirmRemove(`${shortDate(row.work_date)} ${row.site_label}`)}
            className="ml-auto rounded-xl border border-rose-200 px-4 py-2 text-caption text-rose-700 hover:bg-rose-50"
          >
            삭제
          </button>
        )}
      </div>

      {open && (
        <div className="anim-reveal mt-3 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-2">
          <Field label="날짜">
            <input
              key={`date-${row.work_date}-${version}`}
              type="date"
              defaultValue={row.work_date}
              onBlur={(e) => e.target.value && save('work_date', e.target.value)}
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field label="현장">
            <select
              value={row.site_id}
              onChange={(e) => saveSite(Number(e.target.value))}
              className={inputClass}
            >
              {masters.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="작업 내용" className="sm:col-span-2">
            <input
              key={`desc-${row.description}-${version}`}
              defaultValue={row.description ?? ''}
              list="descriptions"
              onBlur={(e) => save('description', e.target.value.trim() || null)}
              className={inputClass}
            />
          </Field>

          {/* 장부 표·새 작업 추가와 같은 「07:00~17:00」 한 칸 (「7~17」 처럼 적어도 알아듣는다) */}
          <Field label="작업 시간" hint="예: 7~17" className="sm:col-span-2">
            <input
              key={`t-${row.start_time}-${row.end_time}-${version}`}
              defaultValue={timeRange(row.start_time, row.end_time)}
              placeholder="07:00~17:00"
              onBlur={(e) => {
                const shown = timeRange(row.start_time, row.end_time);
                const parsed = parseTimeRangeInput(e.target.value);
                if (!parsed) {
                  onError('작업시간은 07:00~17:00 처럼 적어 주세요.');
                  e.target.value = shown;
                  return;
                }
                if (parsed.start === row.start_time && parsed.end === row.end_time) {
                  e.target.value = shown;
                  return;
                }
                update.mutate({ start_time: parsed.start, end_time: parsed.end });
              }}
              className={`${inputClass} tabular`}
            />
          </Field>

          <Field label="규격 M">
            <select
              value={row.boom_size ?? ''}
              onChange={(e) => saveBoomSize(numOrNull(e.target.value))}
              className={inputClass}
            >
              <option value=""></option>
              {masters.suggestions.boomSizes.map((b) => (
                <option key={b} value={b}>
                  {b}M
                </option>
              ))}
            </select>
          </Field>

          <Field label="금액" hint={currentRate != null ? `단가 ${won(currentRate)}` : undefined}>
            <input
              key={`base-${row.base_amount}-${version}`}
              defaultValue={row.base_amount ? won(row.base_amount) : ''}
              inputMode="numeric"
              onChange={(e) => setAmountText(e.target.value)}
              onBlur={(e) => {
                saveAmount(numOrNull(e.target.value));
                setAmountText(null);
              }}
              className={`${inputClass} text-right tabular ${isCustomAmount ? 'text-amber-700' : ''}`}
            />
            <span
              aria-live="polite"
              className="mt-1 flex min-h-[1.5em] items-center justify-end gap-2 text-caption text-slate-700 tabular"
            >
              {isAutoAmount && amountText == null && <AutoBadge />}
              {manwon(numOrNull(amountText ?? String(row.base_amount)))}
            </span>
          </Field>

          <Field label="타설">
            <input
              key={`pour-${row.pour_volume}-${version}`}
              defaultValue={row.pour_volume ?? ''}
              inputMode="decimal"
              onBlur={(e) => save('pour_volume', numOrNull(e.target.value))}
              className={`${inputClass} text-right tabular`}
            />
          </Field>

          <Field label="OT 시간" hint={row.ot_amount ? `OT 금액 ${won(row.ot_amount)}` : undefined}>
            <input
              key={`ot-${row.ot_hours}-${version}`}
              defaultValue={row.ot_hours || ''}
              inputMode="decimal"
              onBlur={(e) => save('ot_hours', numOrNull(e.target.value) ?? 0)}
              className={`${inputClass} text-right tabular`}
            />
          </Field>

          <Field label="기사님">
            <select
              value={row.operator_id ?? ''}
              onChange={(e) => save('operator_id', e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value=""></option>
              {masters.operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="주유">
            <input
              key={`fuel-${row.fuel_amount}-${version}`}
              defaultValue={row.fuel_amount ? won(row.fuel_amount) : ''}
              inputMode="numeric"
              onBlur={(e) => save('fuel_amount', numOrNull(e.target.value))}
              className={`${inputClass} text-right tabular`}
            />
          </Field>

          <Field label="사업자">
            <input
              key={`owner-${row.business_owner}-${version}`}
              defaultValue={row.business_owner ?? ''}
              list="business-owners"
              onBlur={(e) => save('business_owner', e.target.value.trim() || null)}
              className={inputClass}
            />
          </Field>

          <Field label="기타">
            <input
              key={`extra-${row.extra_amount}-${version}`}
              defaultValue={row.extra_amount ? won(row.extra_amount) : ''}
              inputMode="numeric"
              onBlur={(e) => save('extra_amount', numOrNull(e.target.value))}
              className={`${inputClass} text-right tabular`}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// 휴대폰(iOS)은 글자가 16px 보다 작은 입력칸을 누르면 화면을 확대해 버린다
const inputClass =
  'w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-caption font-medium text-slate-600">
        {label}
        {hint && <span className="ml-2 font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
