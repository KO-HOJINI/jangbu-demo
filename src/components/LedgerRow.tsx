import { Link } from 'react-router-dom';
import type { Masters, WorkLogRow } from '../../shared/types';
import { parseTimeRangeInput, shortDate, timeRange, weekday, won } from '../lib/format';
import { numOrNull, useWorkLogRow } from '../lib/useWorkLogRow';
import { AutoBadge, PhotoBadge } from './SourceBadge';

export default function LedgerRow({
  row,
  masters,
  showDate,
  statementName,
  onError,
}: {
  row: WorkLogRow;
  masters: Masters;
  /** 같은 날짜가 이어질 때는 첫 행에만 날짜를 보여준다 (엑셀 장부와 동일) */
  showDate: boolean;
  /** 발행된 명세표 이름 (8월 아라 광장) */
  statementName?: string;
  onError: (message: string) => void;
}) {
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
  // 칸마다 이름을 붙인다 — 화면 읽기 프로그램이 「편집 가능 텍스트」 대신 「8/13 아라(광장) 금액」 으로 읽는다
  const label = (column: string) => `${shortDate(row.work_date)} ${row.site_label} ${column}`;
  const rowTone = update.isPending
    ? 'opacity-50'
    : justSaved
      ? 'bg-emerald-50'
      : 'hover:bg-slate-50/70';

  return (
    <tr className={`group border-t border-slate-200 transition-colors ${rowTone}`}>
      <td className="border-r border-slate-200 px-2 py-1 text-center text-slate-600 tabular">
        {showDate ? (
          <span title={`${row.work_date} (${weekday(row.work_date)})`}>{shortDate(row.work_date)}</span>
        ) : null}
      </td>

      <td className="border-r border-slate-200">
        <select
          aria-label={label('현장')}
          value={row.site_id}
          onChange={(e) => saveSite(Number(e.target.value))}
          className="cell-input appearance-none"
        >
          {masters.sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </td>

      <td className="border-r border-slate-200">
        {/* 수기 장부 사진에서 올린 줄은 작업 내용 앞에 「사진」 딱지 (작업 내용 칸이 가장 넓다) */}
        <div className="flex items-center">
          {row.entry_source === 'photo' && <PhotoBadge className="ml-1.5" />}
          <input
          key={`desc-${row.description}-${version}`}
          aria-label={label('작업 내용')}
          defaultValue={row.description ?? ''}
          list="descriptions"
          onBlur={(e) => save('description', e.target.value.trim() || null)}
          className="cell-input"
        />
        </div>
      </td>

      <td className="border-r border-slate-200">
        {/*
          크롬의 시간 입력칸(type=time)은 「오전 07:00」 꼴로 그리고 폭이 컴퓨터마다 달라서
          좁은 표에서 잘렸다. 엑셀·명세표와 같은 「07:00~17:00」 한 칸으로 받는다.
        */}
        <input
          key={`t-${row.start_time}-${row.end_time}-${version}`}
          aria-label={label('작업 시간')}
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
              e.target.value = shown; // 「7~17」 이라고 적었어도 모양을 맞춰 보여준다
              return;
            }
            update.mutate({ start_time: parsed.start, end_time: parsed.end });
          }}
          className="cell-input text-center tabular"
        />
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`pour-${row.pour_volume}-${version}`}
          aria-label={label('타설')}
          defaultValue={row.pour_volume ?? ''}
          inputMode="decimal"
          onBlur={(e) => save('pour_volume', numOrNull(e.target.value))}
          className="cell-input text-right tabular"
        />
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`boom-${row.boom_size}-${version}`}
          aria-label={label('규격 M')}
          defaultValue={row.boom_size ?? ''}
          list="boom-sizes"
          inputMode="numeric"
          onBlur={(e) => saveBoomSize(numOrNull(e.target.value))}
          className="cell-input text-right tabular"
        />
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`ot-${row.ot_hours}-${version}`}
          aria-label={label('OT 시간')}
          defaultValue={row.ot_hours || ''}
          inputMode="decimal"
          onBlur={(e) => save('ot_hours', numOrNull(e.target.value) ?? 0)}
          className="cell-input text-right tabular"
        />
      </td>

      <td className="border-r border-slate-200 px-2 py-1 text-right whitespace-nowrap text-slate-500 tabular">
        {row.ot_amount ? `${won(row.ot_amount)}원` : ''}
      </td>

      <td className="border-r border-slate-200">
        {/* 단가표에서 자동으로 채운 금액이면 칸 왼쪽에 「자동」 딱지 */}
        <div className="flex items-center">
          {/*
            금액 칸이 좁아(124px) 딱지 옆 여백을 줄였다. 하루 단가(9,999,999 까지)는 딱지와 함께 들어간다.
            14,000,000 같은 월 장비대는 손으로 적는 금액이라 딱지가 붙지 않는다.
          */}
          {isAutoAmount && <AutoBadge compact className="ml-0.5" />}
          <input
            key={`base-${row.base_amount}-${version}`}
            aria-label={label('금액')}
            defaultValue={row.base_amount ? won(row.base_amount) : ''}
            list="base-amounts"
            inputMode="numeric"
            title={
              isAutoAmount
                ? `이 현장 ${row.boom_size}M 단가표에서 자동으로 채운 금액입니다`
                : currentRate != null
                  ? isCustomAmount
                    ? `이 현장 ${row.boom_size}M 단가는 ${won(currentRate)}원 — 직접 고친 금액입니다`
                    : `이 현장 ${row.boom_size}M 단가`
                  : undefined
            }
            onBlur={(e) => saveAmount(numOrNull(e.target.value))}
            className={`cell-input text-right tabular ${isAutoAmount ? 'pr-1.5 pl-0.5' : ''} ${isCustomAmount ? 'text-amber-700' : ''}`}
          />
        </div>
      </td>

      <td className="border-r border-slate-200">
        <select
          aria-label={label('기사님')}
          value={row.operator_id ?? ''}
          onChange={(e) => save('operator_id', e.target.value ? Number(e.target.value) : null)}
          className="cell-input appearance-none"
        >
          <option value=""></option>
          {masters.operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`owner-${row.business_owner}-${version}`}
          aria-label={label('사업자')}
          defaultValue={row.business_owner ?? ''}
          list="business-owners"
          onBlur={(e) => save('business_owner', e.target.value.trim() || null)}
          className="cell-input"
        />
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`fuel-${row.fuel_amount}-${version}`}
          aria-label={label('주유')}
          defaultValue={row.fuel_amount ? won(row.fuel_amount) : ''}
          inputMode="numeric"
          onBlur={(e) => save('fuel_amount', numOrNull(e.target.value))}
          className="cell-input text-right tabular"
        />
      </td>

      <td className="border-r border-slate-200">
        <input
          key={`extra-${row.extra_amount}-${version}`}
          aria-label={label('기타')}
          defaultValue={row.extra_amount ? won(row.extra_amount) : ''}
          inputMode="numeric"
          onBlur={(e) => save('extra_amount', numOrNull(e.target.value))}
          className="cell-input text-right tabular"
        />
      </td>

      <td className="border-r border-slate-200 px-2 py-1 text-right whitespace-nowrap font-medium tabular">
        {won(row.supply_amount)}원
      </td>

      <td className="px-1 py-1 text-center">
        {row.statement_id ? (
          <Link
            to={`/statements/${row.statement_id}`}
            className="block truncate rounded-md bg-emerald-50 px-2 py-1 text-caption font-medium text-emerald-800 hover:bg-emerald-100"
            title={`${statementName ?? ''} 명세표로 발행된 작업입니다. 누르면 명세표를 엽니다.`}
          >
            {statementName ?? '발행됨'}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => confirmRemove(`${shortDate(row.work_date)} ${row.site_label}`)}
            className="rounded-md border border-rose-200 px-3 py-1 text-caption text-rose-700 hover:bg-rose-50"
          >
            삭제
          </button>
        )}
      </td>
    </tr>
  );
}
