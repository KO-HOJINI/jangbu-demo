import { useState } from 'react';
import type { Masters } from '../../shared/types';
import { manwon, parseTimeRangeInput, timeRange, won } from '../lib/format';
import { numOrNull, useNewLog } from '../lib/useNewLog';
import RateSlotQuestion from './RateSlotQuestion';
import { AutoBadge } from './SourceBadge';
import { PhotoButtons, PhotoPanel, usePhotoImport } from './PhotoImport';
import Fold from './Fold';

/**
 * 새 작업 입력.
 *
 * 라벨 붙은 칸으로 따로 둔 입력 상자. 좁은 화면(휴대폰)에서는 세로로 쌓여 그대로 쓸 수 있다.
 * PC 에서는 장부 표 맨 윗줄(NewLogRow)에서도 같은 방식으로 바로 적을 수 있다.
 */
export default function NewLogForm({
  masters,
  defaultSiteId,
}: {
  masters: Masters;
  /** 장부에서 현장을 걸러 보고 있으면 그 현장을 미리 골라 둔다 */
  defaultSiteId?: string;
}) {
  const { draft, set, setSite, setBoomSize, setAmount, rate, isAuto, discounted, submit, reset, pending, message, error, question } =
    useNewLog(masters, defaultSiteId);
  const photo = usePhotoImport(masters);
  // 휴대폰에서는 칸들을 접어 둔다 — 펼친 채로는 상자가 화면을 다 차지해 장부가 보이지 않았다. PC 는 늘 펼쳐 둔다
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:mb-3">
        <h2 className="text-body font-bold whitespace-nowrap">새 작업 추가</h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="tap -my-2 ml-auto rounded-xl border border-slate-300 bg-white px-4 py-1.5 text-caption font-medium text-slate-800 hover:bg-slate-50 lg:hidden"
        >
          {open ? '접기' : '직접 적기'}
        </button>
        {/* 휴대폰에서는 상자가 길어지지 않게 설명을 줄인다 — 금액 칸에 단가가 따로 보인다 */}
        <span className="hidden text-caption text-slate-600 sm:inline">현장과 규격을 고르면 금액이 자동으로 채워집니다</span>
        {/* 손으로 적은 장부를 찍어 한꺼번에 올리는 길 — 한 줄씩 적는 칸과 같은 상자에 둔다 */}
        <div className="w-full lg:-my-2 lg:ml-auto lg:w-auto">
          <PhotoButtons ctl={photo} />
        </div>
      </div>

      <PhotoPanel ctl={photo} masters={masters} />

      <Fold open={open} lgOpen>
      <div
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        className="grid grid-cols-2 gap-x-3 gap-y-2.5 max-lg:mt-2 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8"
      >
        {/* 휴대폰은 두 칸씩: 날짜·시간 / 현장 / 작업 내용 / 규격·금액 / 타설·OT / 기사님·주유 */}
        <Field label="날짜" className="min-w-0 max-lg:-order-2">
          <input
            type="date"
            value={draft.work_date}
            onChange={(e) => set('work_date', e.target.value)}
            className={`${inputClass} block px-2 sm:px-3 tabular`}
          />
        </Field>

        <Field label="현장" className="col-span-2">
          <select
            value={draft.site_id}
            onChange={(e) => setSite(e.target.value)}
            className={inputClass}
          >
            <option value="">현장을 고르세요</option>
            {masters.sites
              .filter((s) => !s.archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
        </Field>

        <Field label="작업 내용" className="col-span-2">
          <input
            value={draft.description}
            list="descriptions"
            placeholder="s/v, 벽체, 기초 …"
            onChange={(e) => set('description', e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="작업 시간" className="min-w-0 max-lg:-order-1">
          {/*
            크롬 시간칸(type=time) 두 개를 나란히 두면 「오전 07:00」 을 그릴 폭이 모자라
            부모님 화면에서 「오전 0」 까지만 보였다. 장부 표와 같은 「07:00~17:00」 한 칸으로 받는다.
          */}
          <input
            value={draft.time}
            onChange={(e) => set('time', e.target.value)}
            onBlur={(e) => {
              // 「7~17」 이라고 적어도 칸에서 나오면 「07:00~17:00」 으로 맞춰 보여준다
              const t = parseTimeRangeInput(e.target.value);
              if (t && (t.start || t.end)) set('time', timeRange(t.start, t.end));
            }}
            placeholder="07:00~17:00"
            className={`${inputClass} block px-2 sm:px-3 tabular`}
          />
        </Field>

        <Field label="규격 M">
          <select
            value={draft.boom_size}
            onChange={(e) => setBoomSize(e.target.value)}
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

        {/* 단가를 등록하지 않은 현장은 자동으로 채울 수 없다는 걸 바로 알게 한다 */}
        <Field
          label="금액"
          hint={
            rate != null
              ? `단가 ${won(rate)}`
              : draft.site_id && draft.boom_size
                ? '단가 미등록'
                : undefined
          }
        >
          <input
            value={draft.base_amount}
            inputMode="numeric"
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} text-right tabular ${discounted ? 'text-amber-700' : ''}`}
          />
          {/* 치는 동안 「140만 원」 처럼 읽어 준다 — 0 개수 오타를 바로 알아보게 */}
          <span
            aria-live="polite"
            className="mt-1 flex min-h-[1.5em] max-lg:empty:hidden items-center justify-end gap-2 text-caption text-slate-700 tabular"
          >
            {isAuto && <AutoBadge />}
            {manwon(numOrNull(draft.base_amount))}
          </span>
        </Field>

        <Field label="타설">
          <input
            value={draft.pour_volume}
            inputMode="decimal"
            onChange={(e) => set('pour_volume', e.target.value)}
            className={`${inputClass} text-right tabular`}
          />
        </Field>

        <Field label="OT 시간">
          <input
            value={draft.ot_hours}
            inputMode="decimal"
            placeholder="0"
            onChange={(e) => set('ot_hours', e.target.value)}
            className={`${inputClass} text-right tabular`}
          />
        </Field>

        <Field label="기사님">
          <select
            value={draft.operator_id}
            onChange={(e) => set('operator_id', e.target.value)}
            className={inputClass}
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
        </Field>

        <Field label="주유">
          <input
            value={draft.fuel_amount}
            inputMode="numeric"
            onChange={(e) => set('fuel_amount', e.target.value)}
            className={`${inputClass} text-right tabular`}
          />
        </Field>

      {/* 넓은 화면(여덟 칸)에서는 둘째 줄 남는 자리에 단추를 둔다 — 단추만 한 줄을 더 쓰면 그만큼 장부가 밀려 내려간다.
          칸 이름 높이만큼 비워 입력칸과 줄을 맞춘다 */}
      <div className="col-span-full max-2xl:mt-1.5 2xl:col-span-4">
      <span aria-hidden="true" className="mb-1 block text-caption max-2xl:hidden">&nbsp;</span>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => submit()}
          disabled={pending}
          className="rounded-xl bg-slate-900 px-6 py-2.5 text-caption font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {pending ? '추가 중…' : '추가하기'}
        </button>

        <button
          type="button"
          onClick={reset}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-caption hover:bg-slate-50"
        >
          비우기
        </button>

        {error && <span className="text-caption text-rose-700">{error}</span>}
        {!error && message && <span className="text-caption text-emerald-700">{message}</span>}
        {!error && !message && (
          <span className="hidden text-caption text-slate-500 sm:inline">칸을 채우고 Enter 를 눌러도 추가됩니다</span>
        )}
      </div>
      </div>
      </div>
      </Fold>
      <RateSlotQuestion question={question} />
    </section>
  );
}

const inputClass =
  // 휴대폰(iOS)은 16px 보다 작은 입력칸을 누르면 화면을 확하늘다 — 휴대폰에서는 16px, 여덟 칸이 한 줄에 서는 PC 에서는 15px
  'w-full min-w-0 max-w-full rounded-xl border border-slate-300 px-3 py-2 text-body lg:text-caption outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

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
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-caption font-medium text-slate-600">
        {label}
        {hint && <span className="ml-2 font-normal text-slate-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
