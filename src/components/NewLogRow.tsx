import { useEffect, useRef, useState } from 'react';
import type { Masters } from '../../shared/types';
import { parseDateInput, parseTimeRangeInput, shortDate, timeRange, today, weekday, won } from '../lib/format';
import { numOrNull, useNewLog } from '../lib/useNewLog';
import RateSlotQuestion from './RateSlotQuestion';
import { AutoBadge } from './SourceBadge';

/**
 * 장부 표 맨 윗줄에서 바로 새 작업을 적는 줄 (PC 화면).
 *
 * 엑셀 장부처럼 표 안에서 이어 적을 수 있게 둔다. 표 위의 「새 작업 추가」 상자와 같은
 * 규칙(useNewLog)을 쓰므로 현장·M 을 고르면 단가표 금액이 「자동」으로 채워진다.
 * 칸 순서·폭은 아래 장부 줄과 같다. Enter 를 누르면 더한다.
 */
export default function NewLogRow({
  masters,
  columnCount,
  defaultSiteId,
  period,
}: {
  masters: Masters;
  columnCount: number;
  defaultSiteId?: string;
  /** 지금 표에 보이는 기간 — 그 밖의 날짜로 더하면 표에 안 보인다고 알려 준다 */
  period: { from: string; to: string };
}) {
  const [outside, setOutside] = useState<string | null>(null);
  const { draft, set, setSite, setBoomSize, setAmount, isAuto, discounted, submit, pending, message, error, question } =
    useNewLog(masters, defaultSiteId, (row) =>
      setOutside(
        row.work_date < period.from || row.work_date > period.to
          ? `${shortDate(row.work_date)} 은 지금 보는 기간 밖이라 아래 표에는 안 보입니다.`
          : null
      )
    );

  // 날짜 칸은 좁아서(60px) 「9/29」 로 적고 보여준다
  const [dateText, setDateText] = useState(() => shortDate(draft.work_date));
  useEffect(() => setDateText(shortDate(draft.work_date)), [draft.work_date]);

  // 더하고 나면 다음 줄을 바로 적을 수 있게 작업 내용 칸으로 돌아간다
  const descRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !error) descRef.current?.focus();
    wasPending.current = pending;
  }, [pending, error]);

  /** 날짜 칸을 고치고 바로 Enter 를 눌러도 그 날짜로 더한다 (칸을 떠나기 전이라 draft 에 아직 없다) */
  const submitRow = () => {
    const parsed = parseDateInput(dateText, draft.work_date || today());
    submit(parsed ? { work_date: parsed } : {});
  };

  const base = numOrNull(draft.base_amount) ?? 0;
  const ot = numOrNull(draft.ot_hours) ?? 0;
  // DB 계산 열과 같은 식 (0007: 반올림)
  const otAmount = Number.isNaN(base * ot) ? 0 : Math.round((base * ot) / 10);
  const supply = Number.isNaN(base) ? 0 : base + otAmount;

  const label = (column: string) => `새 작업 ${column}`;
  const cell = 'border-r border-slate-200';

  return (
    <>
      <tr
        className="border-b-2 border-sky-200 bg-sky-50/70"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            submitRow();
          }
        }}
      >
        <td className={cell}>
          <input
            aria-label={label('날짜')}
            value={dateText}
            title={`${draft.work_date} (${weekday(draft.work_date)}) — 「9/29」 처럼 적습니다`}
            onChange={(e) => setDateText(e.target.value)}
            onBlur={() => {
              const parsed = parseDateInput(dateText, draft.work_date || today());
              if (parsed) set('work_date', parsed);
              else setDateText(shortDate(draft.work_date));
            }}
            className="cell-input text-center tabular"
          />
        </td>

        <td className={cell}>
          <select
            aria-label={label('현장')}
            value={draft.site_id}
            onChange={(e) => setSite(e.target.value)}
            className={`cell-input appearance-none ${draft.site_id ? '' : 'text-slate-500'}`}
          >
            <option value="">현장</option>
            {masters.sites
              .filter((s) => !s.archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
        </td>

        <td className={cell}>
          <input
            ref={descRef}
            aria-label={label('작업 내용')}
            value={draft.description}
            list="descriptions"
            placeholder="여기에 바로 적고 Enter"
            onChange={(e) => set('description', e.target.value)}
            className="cell-input"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('작업 시간')}
            value={draft.time}
            placeholder="07:00~17:00"
            onChange={(e) => set('time', e.target.value)}
            onBlur={(e) => {
              const t = parseTimeRangeInput(e.target.value);
              if (t && (t.start || t.end)) set('time', timeRange(t.start, t.end));
            }}
            className="cell-input text-center tabular"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('타설')}
            value={draft.pour_volume}
            inputMode="decimal"
            onChange={(e) => set('pour_volume', e.target.value)}
            className="cell-input text-right tabular"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('규격 M')}
            value={draft.boom_size}
            list="boom-sizes"
            inputMode="numeric"
            onChange={(e) => setBoomSize(e.target.value)}
            className="cell-input text-right tabular"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('OT 시간')}
            value={draft.ot_hours}
            inputMode="decimal"
            onChange={(e) => set('ot_hours', e.target.value)}
            className="cell-input text-right tabular"
          />
        </td>

        <td className={`${cell} px-2 py-1 text-right whitespace-nowrap text-slate-500 tabular`}>
          {otAmount ? `${won(otAmount)}원` : ''}
        </td>

        <td className={cell}>
          <div className="flex items-center">
            {isAuto && <AutoBadge compact className="ml-0.5" />}
            <input
              aria-label={label('금액')}
              value={/^\d+$/.test(draft.base_amount) ? won(Number(draft.base_amount)) : draft.base_amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/,/g, ''))}
              className={`cell-input text-right tabular ${isAuto ? 'pr-1.5 pl-0.5' : ''} ${discounted ? 'text-amber-700' : ''}`}
            />
          </div>
        </td>

        <td className={cell}>
          <select
            aria-label={label('기사님')}
            value={draft.operator_id}
            onChange={(e) => set('operator_id', e.target.value)}
            className="cell-input appearance-none"
          >
            <option value=""></option>
            {masters.operators
              .filter((o) => !o.archived)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </td>

        <td className={cell}>
          <input
            aria-label={label('사업자')}
            value={draft.business_owner}
            list="business-owners"
            onChange={(e) => set('business_owner', e.target.value)}
            className="cell-input"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('주유')}
            value={draft.fuel_amount}
            inputMode="numeric"
            onChange={(e) => set('fuel_amount', e.target.value)}
            className="cell-input text-right tabular"
          />
        </td>

        <td className={cell}>
          <input
            aria-label={label('기타')}
            value={draft.extra_amount}
            inputMode="numeric"
            onChange={(e) => set('extra_amount', e.target.value)}
            className="cell-input text-right tabular"
          />
        </td>

        <td className={`${cell} px-2 py-1 text-right whitespace-nowrap font-medium text-slate-500 tabular`}>
          {supply ? `${won(supply)}원` : ''}
        </td>

        <td className="px-1 py-1 text-center">
          <button
            type="button"
            onClick={submitRow}
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-3 py-1 text-caption font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {pending ? '더하는 중…' : '추가'}
          </button>
        </td>
      </tr>

      {(error || message) && (
        <tr className="border-b border-slate-200 bg-sky-50/40">
          <td colSpan={columnCount} className={`px-3 py-1.5 text-caption ${error ? 'text-rose-700' : 'text-emerald-700'}`}>
            {error ?? message}
            {!error && outside && <span className="ml-2 text-amber-700">{outside}</span>}
          </td>
        </tr>
      )}
      <RateSlotQuestion question={question} />
    </>
  );
}
