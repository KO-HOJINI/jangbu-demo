import { Fragment, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Masters } from '../../shared/types';
import { api } from '../lib/api';
import { learnedRateText, parseTimeRangeInput, rateFor, today, won } from '../lib/format';
import { markDuplicates, modelLabel, normalizeRows, wantsNewSite, type PhotoRow } from '../lib/photoLog';
import { AutoBadge, PhotoBadge } from './SourceBadge';
import ScrollBox from './ScrollBox';
import { shrinkImage } from '../lib/imageShrink';
import { WebcamDialog } from './WebcamDialog';
import { useLeaving } from '../lib/useLeaving';
import PhotoNewSite from './PhotoNewSite';
import Fold from './Fold';

/** 사진에 적힌 거래처와 현장 글자 — 「아라개발 / 광명-서울 고속도로」 */
const photoSiteText = (row: PhotoRow) => [row.client_text, row.site_text].filter(Boolean).join(' / ');
/** 현장 고르는 칸의 「새 현장으로 추가」 */
const NEW_SITE = 'new';

type Stage = 'idle' | 'reading' | 'review' | 'saving' | 'done';

/**
 * 수기 장부 사진으로 작업 올리기 — 상태와 동작.
 * 사진 찍기·고르기 → AI 가 읽기(보통 5초 안팎) → 부모님이 확인·고치기 → 선택한 줄만 장부에 올리기.
 * 올린 줄에는 「사진」 딱지가 붙는다. 이미 장부에 있는 줄은 처음부터 빼 둔다.
 *
 * 단추(PhotoButtons)는 「새 작업 추가」 제목 옆에, 읽은 결과(PhotoPanel)는 그 상자 안에 둔다.
 */
export function usePhotoImport(masters: Masters) {
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>('idle');
  const [photo, setPhoto] = useState<{ url: string; base64: string } | null>(null);
  const [rows, setRows] = useState<PhotoRow[]>([]);
  /** 몇 번째로 읽은 결과인지 — 다시 읽으면 줄마다 열어 둔 상자(새 현장)를 처음 상태로 돌린다 */
  const [readNo, setReadNo] = useState(0);
  /** 어느 모델이 몇 초 만에 읽었는지 — 원본 사진 상자에 작게 적는다 */
  const [readBy, setReadBy] = useState<{ model: string; seconds: number } | null>(null);
  /** 「꼼꼼히 다시 읽기」로 읽는 중인지 — 기다리는 시간 안내가 다르다 */
  const [careful, setCareful] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  /** 올리면서 단가로 등록된 금액 (「가온 42M 하루 단가 1,400,000원」) — 잘못 읽힌 금액이 말없이 단가가 되지 않게 알린다 */
  const [learned, setLearned] = useState<string[]>([]);

  // 사진이 바뀌거나 닫으면 앞 사진 미리보기를 놓아 준다
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo]
  );

  const read = async (base64: string, careful = false) => {
    setStage('reading');
    setCareful(careful);
    setError(null);
    try {
      const { rows: raw, model, seconds } = await api.readPhotoLog(base64, careful);
      setReadBy({ model, seconds });
      const normalized = normalizeRows(raw, masters, today());
      // 사진 속 날짜 범위의 장부를 불러 이미 있는 줄을 가린다
      const dates = normalized.map((r) => r.work_date).sort();
      const existing = dates.length ? (await api.ledger({ from: dates[0], to: dates[dates.length - 1] })).rows : [];
      setRows(markDuplicates(normalized, existing));
      setReadNo((n) => n + 1);
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('idle');
    }
  };

  const choose = async (file: File | Blob | undefined) => {
    if (!file) return;
    setError(null);
    setCareful(false);
    setStage('reading');
    try {
      // 미리보기는 줄인 사진으로 — 아이폰의 HEIC 원본은 PC·안드로이드 화면에 못 띄운다
      const { base64, blob } = await shrinkImage(file);
      setPhoto({ url: URL.createObjectURL(blob), base64 });
      await read(base64);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('idle');
    }
  };

  /** 한 줄 고치기. 현장·M 을 바꾸면 자동 금액도 다시 채운다 (손으로 적은 금액은 그대로) */
  const update = (key: number, patch: Partial<PhotoRow>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (('site_id' in patch || 'boom_size' in patch) && (r.amount_auto || !r.base_amount)) {
          const rate = next.site_id != null && next.boom_size != null ? rateFor(masters.rates, next.site_id, next.boom_size) : null;
          if (rate != null) Object.assign(next, { base_amount: rate, amount_auto: 1 });
        }
        if ('base_amount' in patch) next.amount_auto = 0;
        return next;
      })
    );

  /** 한 줄 목록에서 완전히 삭제 */
  const remove = (key: number) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  /** 전체 선택 / 전체 해제 (현장 미지정 건은 제외) */
  const toggleAll = (include: boolean) => {
    setRows((prev) => prev.map((r) => (r.site_id != null ? { ...r, include } : r)));
  };

  const chosen = rows.filter((r) => r.include && r.site_id != null);

  const save = async () => {
    setStage('saving');
    setError(null);
    let done = 0;
    const rates: string[] = [];
    try {
      for (const r of chosen) {
        const times = parseTimeRangeInput(r.time) ?? { start: null, end: null };
        const row = await api.createWorkLog({
          work_date: r.work_date,
          site_id: r.site_id!,
          description: r.description.trim() || null,
          start_time: times.start,
          end_time: times.end,
          boom_size: r.boom_size,
          ot_hours: r.ot_hours,
          pour_volume: r.pour_volume,
          base_amount: r.base_amount,
          amount_auto: r.amount_auto,
          operator_id: r.operator_id,
          entry_source: 'photo',
        });
        if (row.rate_learned) rates.push(`${row.site_label} ${learnedRateText(row.boom_size, row.rate_learned)}`);
        done += 1;
      }
      setSaved(done);
      setStage('done');
    } catch (e) {
      // 몇 줄은 올라갔을 수 있다 — 올라간 줄은 목록에서 빼고 남은 것만 다시 올리게 한다
      const doneKeys = new Set(chosen.slice(0, done).map((r) => r.key));
      setRows((prev) => prev.filter((r) => !doneKeys.has(r.key)));
      setError(`${done}건은 올렸고, 나머지에서 멈췄습니다: ${e instanceof Error ? e.message : String(e)}`);
      setStage('review');
    } finally {
      // 중간에 멈춰 다시 올려도 앞서 등록된 단가 알림이 빠지지 않게 이어 붙인다
      setLearned((prev) => [...prev, ...rates]);
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['overdue'] });
      queryClient.invalidateQueries({ queryKey: ['masters'] });
    }
  };

  const close = () => {
    setStage('idle');
    setRows([]);
    setError(null);
    setPhoto(null);
    setLearned([]);
  };

  return { stage, photo, rows, readNo, readBy, careful, error, saved, learned, chosen, choose, read, update, remove, toggleAll, save, close };
}

export type PhotoImportState = ReturnType<typeof usePhotoImport>;

/** 휴대폰·태블릿(손가락으로 누르는 화면)인지 — 사진 찍기를 휴대폰 카메라로 바로 연다 */
const isTouchDevice = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

/**
 * 「사진 찍기」「사진 고르기」 두 단추.
 *   휴대폰: 찍기 = 카메라가 바로 열린다, 고르기 = 사진첩
 *   PC: 찍기 = 이 화면에서 웹캠으로 찍는 창, 고르기 = 파일 고르기
 */
export function PhotoButtons({ ctl }: { ctl: PhotoImportState }) {
  const [webcam, setWebcam] = useState(false);
  const busy = ctl.stage === 'reading' || ctl.stage === 'saving';
  const button =
    'tap inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-caption font-medium whitespace-nowrap';
  // 흰 단추는 상자에 묻혀 눈에 띄지 않았다 — 입력칸을 누를 때와 같은 하늘색으로 옅게 칠한다
  const tint = 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100';
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    ctl.choose(e.target.files?.[0]);
    e.target.value = '';
  };

  // 휴대폰: 설명 한 줄 + 같은 폭 단추 둘. PC: 한 줄로 「수기 작업일보를 사진찍어 올리기: [찍기] [고르기]」
  return (
    <div className="grid grid-cols-2 items-center gap-2 sm:flex">
      <span className="col-span-2 text-caption text-slate-600">수기 작업일보를 사진찍어 올리기:</span>
      {isTouchDevice() ? (
        <label className={`${button} ${tint} ${busy ? 'pointer-events-none opacity-40' : ''}`}>
          사진 찍기
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy} onChange={onFile} />
        </label>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setWebcam(true)}
          className={`${button} ${tint} disabled:opacity-40`}
        >
          사진 찍기
        </button>
      )}
      <label className={`${button} ${tint} ${busy ? 'pointer-events-none opacity-40' : ''}`}>
        사진 고르기
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={onFile} />
      </label>
      {webcam && (
        <WebcamDialog
          onShot={(blob) => {
            setWebcam(false);
            ctl.choose(blob);
          }}
          onClose={() => setWebcam(false)}
        />
      )}
    </div>
  );
}
/** 읽는 중 · 확인하고 고치기 · 올림 — 전체 화면 팝업(모달 다이얼로그) */
export function PhotoPanel({ ctl, masters }: { ctl: PhotoImportState; masters: Masters }) {
  const { stage, photo, rows, error, saved, learned, chosen } = ctl;
  // 현장을 못 찾은 첫 줄은 「새 현장으로 추가」 상자를 열어 둔다 — 이름만 확인하고 누르면 된다 (2026-10-05 사용자 요청)
  const newSiteKey = rows.find(wantsNewSite)?.key ?? null;
  // 닫을 때는 작아지며 사라진다 (index.css 의 is-leaving) — 그 움직임이 끝난 뒤에 창을 치운다
  const [leaving, leave] = useLeaving(160);
  const close = () => leave(ctl.close);
  if (stage === 'idle' && !error) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="수기 작업일보 사진 확인"
      className={`anim-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs print:hidden ${leaving ? 'is-leaving' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && stage !== 'reading' && stage !== 'saving') {
          close();
        }
      }}
    >
      <div className="anim-sheet flex max-h-[92dvh] w-full max-w-5xl lg:max-w-[min(1440px,96vw)] flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* 모달 상단 헤더 */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3.5 sm:px-6 bg-slate-50">
          <div className="min-w-0 pr-2">
            <h2 className="text-body sm:text-lead font-bold text-slate-900 truncate">수기 작업일보 사진 확인</h2>
            {stage === 'review' && (
              <p className="mt-0.5 text-caption text-slate-600">
                사진에서 <b>{rows.length}줄</b>을 읽었습니다.
              </p>
            )}
          </div>
          {stage !== 'reading' && stage !== 'saving' && (
            <button
              type="button"
              onClick={close}
              className="shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-caption font-medium whitespace-nowrap text-slate-700 hover:bg-slate-50"
            >
              닫기
            </button>
          )}
        </div>

        {/* 모달 본문 스크롤 영역 */}
        <ScrollBox className="flex min-h-0 flex-1 flex-col" viewClassName="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {error && <div className="rounded-xl bg-rose-50 p-3 text-caption text-rose-700 border border-rose-200">{error}</div>}

          {stage === 'reading' && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="mb-4 inline-block size-8 animate-spin rounded-full border-3 border-slate-200 border-t-slate-800" />
              <p className="text-body font-medium text-slate-800">사진을 읽는 중입니다…</p>
              <p className="mt-1 text-caption text-slate-600">
                {ctl.careful ? '보통 20초 안팎, 길면 1분쯤 걸립니다.' : '보통 5초 안팎, 길면 30초쯤 걸립니다.'}
              </p>
            </div>
          )}

          {stage === 'done' && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-lead font-bold text-slate-900">{saved}건을 장부에 올렸습니다</p>
              <p className="mt-1 text-caption text-slate-600">
                장부 목록에서 <PhotoBadge /> 딱지로 등록된 작업을 확인할 수 있습니다.
              </p>
              {learned.length > 0 && (
                <div className="mt-4 max-w-md rounded-xl bg-amber-50 p-4 text-left text-caption text-amber-900">
                  <p className="font-bold">단가가 없던 현장은 이번 금액을 단가로 등록했습니다</p>
                  <ul className="mt-1 tabular">
                    {learned.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                  <p className="mt-1">금액이 틀렸으면 현장 수정에서 고칠 수 있습니다.</p>
                </div>
              )}
              <button
                type="button"
                onClick={close}
                className="mt-6 rounded-xl bg-slate-900 px-6 py-2.5 text-body font-medium text-white hover:bg-slate-800"
              >
                확인
              </button>
            </div>
          )}

          {(stage === 'review' || stage === 'saving') && (
            <div className="flex flex-col gap-4">
              <div className="space-y-3 min-w-0">
                {/* 툴바: 선택 건수 및 전체 선택/해제 */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2">
                  <div className="flex items-center gap-2 text-caption">
                    <span className="font-semibold text-slate-800">
                      선택 {chosen.length}건 / 전체 {rows.length}줄
                    </span>
                    {rows.some((r) => r.duplicateOf) && (
                      <span className="hidden text-slate-600 sm:inline">(회색 줄: 이미 장부에 등록된 작업)</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-caption">
                    <button
                      type="button"
                      onClick={() => ctl.toggleAll(true)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100"
                    >
                      모두 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => ctl.toggleAll(false)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-100"
                    >
                      모두 해제
                    </button>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-caption text-slate-500">
                    모든 줄이 제외되었습니다. 잘못 읽었으면 아래 「다시 읽기」를 누르거나 닫아 주세요.
                  </div>
                ) : (
                  <>
                    {/* 휴대폰: 줄마다 카드 */}
                    <div className="space-y-3 lg:hidden">
                      {rows.map((r) => (
                        <RowCard
                          key={`${ctl.readNo}-${r.key}`}
                          row={r}
                          startAdding={r.key === newSiteKey}
                          masters={masters}
                          onChange={(patch) => ctl.update(r.key, patch)}
                          onRemove={() => ctl.remove(r.key)}
                        />
                      ))}
                    </div>
                    {/* 넓은 화면: 작업일보 표처럼 한 작업 한 줄 */}
                    <RowTable key={ctl.readNo} rows={rows} masters={masters} ctl={ctl} startAdding={newSiteKey} />
                  </>
                )}
              </div>

              {/* 원본 사진 — 휴대폰은 줄 아래, 넓은 화면은 표 위 */}
              {photo && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2 lg:order-first">
                  {/* 휴대폰은 폭이 좁아 읽은 모델을 제목 아랫줄로 내린다 */}
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-caption font-semibold text-slate-700">원본 사진</span>
                    {ctl.readBy && (
                      <span className="order-last w-full text-caption text-slate-600 lg:order-none lg:w-auto">
                        {modelLabel(ctl.readBy.model)} 로 읽음 ({ctl.readBy.seconds}초)
                      </span>
                    )}
                    <a
                      href={photo.url}
                      target="_blank"
                      rel="noreferrer"
                      // 창은 main 밖이라 글자 링크의 누르는 자리를 넓히는 규칙(index.css)이 닿지 않는다 — 위아래로 넓혀 44px
                      className="-my-3 ml-auto inline-block py-3 text-caption text-sky-700 hover:underline"
                    >
                      새 창으로 크게 보기
                    </a>
                  </div>
                  <a href={photo.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 bg-white lg:mx-auto lg:w-fit" title="누르면 새 창에서 원본 크기로 봅니다">
                    <img
                      src={photo.url}
                      alt="올린 장부 사진"
                      className="max-h-72 lg:max-h-[30vh] w-full lg:w-auto object-contain"
                    />
                  </a>
                </div>
              )}
            </div>
          )}
        </ScrollBox>

        {/* 모달 하단 고정 액션바 */}
        {(stage === 'review' || stage === 'saving') && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
            <div>
              {photo && (
                <button
                  type="button"
                  onClick={() => ctl.read(photo.base64, true)}
                  disabled={stage === 'saving'}
                  className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-caption text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  잘못 읽었으면: 더 꼼꼼히 다시 읽기 (20초쯤)
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={close}
                disabled={stage === 'saving'}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-body text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                onClick={ctl.save}
                disabled={!chosen.length || stage === 'saving'}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-body font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {stage === 'saving' ? '올리는 중…' : `선택한 ${chosen.length}건 장부에 올리기`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 사진에서 읽은 한 줄 — 칸마다 고칠 수 있고, [줄 삭제]로 완전히 뺄 수 있다 */
function RowCard({
  row,
  masters,
  onChange,
  onRemove,
  startAdding,
}: {
  row: PhotoRow;
  masters: Masters;
  onChange: (patch: Partial<PhotoRow>) => void;
  onRemove: () => void;
  /** 현장을 못 찾은 줄 — 「새 현장으로 추가」 상자를 처음부터 열어 둔다 */
  startAdding: boolean;
}) {
  const [adding, setAdding] = useState(startAdding);
  const dim = row.duplicateOf != null && !row.include;
  // 현장을 모르거나, 비슷한 글자로 짐작만 하고 아직 체크하지 않은 줄
  const unsure = row.site_id == null || (row.site_guessed && !row.include);
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')));

  return (
    <div className={`rounded-xl border p-3 transition-colors duration-200 ${dim ? 'border-slate-200 bg-slate-50 opacity-70' : unsure ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex items-center gap-2 text-caption font-medium">
          <input
            type="checkbox"
            checked={row.include}
            disabled={row.site_id == null}
            onChange={(e) => onChange({ include: e.target.checked })}
            className="size-5 accent-slate-900"
          />
          올리기
        </label>
        <input
          type="date"
          value={row.work_date}
          onChange={(e) => e.target.value && onChange({ work_date: e.target.value })}
          className={`${field} w-36 sm:w-40 tabular`}
          aria-label="날짜"
        />
        {row.duplicateOf && <span className="text-caption text-slate-500">이미 장부에 있음: {row.duplicateOf.label}</span>}
        {row.site_id == null && (
          <span className="text-caption font-medium break-keep text-amber-800">
            사진의 「{photoSiteText(row) || '?'}」 — 현장을 고르거나 새로 추가해 주세요
          </span>
        )}
        {row.site_guessed && !row.include && (
          <span className="text-caption font-medium break-keep text-amber-800">사진의 「{photoSiteText(row)}」 — 현장이 맞으면 체크해 주세요</span>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto rounded-lg border border-rose-300 bg-white px-3 py-1 text-caption font-medium text-rose-700 hover:bg-rose-50"
          title="이 줄 완전히 제외하기"
        >
          줄 삭제
        </button>
      </div>

      {/* 칸마다 이름을 붙인다 — 「42」「150」 만 있으면 규격인지 타설인지 알 수 없다 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Labeled label="현장" className="col-span-2">
          <select
            value={row.site_id ?? ''}
            onChange={(e) => {
              if (e.target.value === NEW_SITE) return setAdding(true);
              onChange({ site_id: e.target.value ? Number(e.target.value) : null, site_guessed: false, include: Boolean(e.target.value) });
            }}
            className={field}
            aria-label="현장"
          >
            <option value="">현장 고르기</option>
            <option value={NEW_SITE}>새 현장으로 추가</option>
            {masters.sites
              .filter((s) => !s.archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
          </select>
        </Labeled>
        {/* 방금 누른 「현장」 칸 바로 아래에서 펼쳐진다. 접혀 있을 때는 격자 틈(8px)이 두 번 생기지 않게 당긴다 */}
        <div className={`col-span-full ${adding ? '' : '-mt-2'}`}>
          <Fold open={adding}>
            <PhotoNewSite
              row={row}
              masters={masters}
              onPicked={(id) => {
                onChange({ site_id: id, site_guessed: false, include: true });
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </Fold>
        </div>
        <Labeled label="작업 내용" className="col-span-2">
          <input value={row.description} onChange={(e) => onChange({ description: e.target.value })} className={field} aria-label="작업 내용" />
        </Labeled>
        <Labeled label="작업 시간">
          <input value={row.time} onChange={(e) => onChange({ time: e.target.value })} placeholder="07:00~17:00" className={`${field} tabular`} aria-label="작업 시간" />
        </Labeled>
        <Labeled label="규격 M">
          <input
            value={row.boom_size ?? ''}
            onChange={(e) => onChange({ boom_size: numOrNull(e.target.value) })}
            inputMode="numeric"
            className={`${field} text-right tabular`}
            aria-label="규격 M"
          />
        </Labeled>
        <Labeled label="OT 시간">
          <input
            value={row.ot_hours || ''}
            onChange={(e) => onChange({ ot_hours: numOrNull(e.target.value) ?? 0 })}
            inputMode="decimal"
            className={`${field} text-right tabular`}
            aria-label="OT 시간"
          />
        </Labeled>
        <Labeled label="타설">
          <input
            value={row.pour_volume ?? ''}
            onChange={(e) => onChange({ pour_volume: numOrNull(e.target.value) })}
            inputMode="decimal"
            className={`${field} text-right tabular`}
            aria-label="타설"
          />
        </Labeled>
        <Labeled label={row.base_amount ? '금액' : '금액 (사진에 없음 — 적어 주세요)'} className="col-span-2">
          <span className="flex items-center gap-2">
            {row.amount_auto ? <AutoBadge /> : null}
            <input
              value={row.base_amount ? won(row.base_amount) : ''}
              onChange={(e) => onChange({ base_amount: numOrNull(e.target.value) ?? 0 })}
              inputMode="numeric"
              className={`${field} min-w-0 flex-1 text-right tabular`}
              aria-label="금액"
            />
          </span>
        </Labeled>
        <Labeled
          label={row.operator_text && row.operator_id == null ? `기사님 (사진: ${row.operator_text})` : '기사님'}
          className="col-span-2"
        >
          <select
            value={row.operator_id ?? ''}
            onChange={(e) => onChange({ operator_id: e.target.value ? Number(e.target.value) : null })}
            className={field}
            aria-label="기사님"
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
        </Labeled>
      </div>
    </div>
  );
}

/**
 * 넓은 화면: 읽은 줄을 작업일보 표처럼 한 줄씩. 칸을 바로 고친다.
 * 현장을 못 맞춘 줄은 주황, 이미 장부에 있는 줄은 회색.
 */
function RowTable({ rows, masters, ctl, startAdding }: { rows: PhotoRow[]; masters: Masters; ctl: PhotoImportState; startAdding: number | null }) {
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d.]/g, '')));
  const th = 'px-1.5 py-2 text-left font-semibold whitespace-nowrap';
  // 「새 현장으로 추가」를 고른 줄 — 그 줄 바로 아래에 적는 상자가 열린다
  const [addingKey, setAddingKey] = useState<number | null>(startAdding);
  return (
    <table className="hidden w-full table-fixed border-collapse text-caption lg:table">
      <colgroup>
        <col style={{ width: '60px' }} />
        <col style={{ width: '156px' }} />
        <col style={{ width: '176px' }} />
        <col />
        <col style={{ width: '132px' }} />
        <col style={{ width: '64px' }} />
        <col style={{ width: '60px' }} />
        <col style={{ width: '72px' }} />
        <col style={{ width: '176px' }} />
        <col style={{ width: '120px' }} />
        <col style={{ width: '64px' }} />
      </colgroup>
      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700">
        <tr>
          <th className={`${th} text-center`}>올리기</th>
          <th className={th}>월 일</th>
          <th className={th}>현장</th>
          <th className={th}>작업 내용</th>
          <th className={th}>작업 시간</th>
          <th className={`${th} text-right`}>M</th>
          <th className={`${th} text-right`}>OT</th>
          <th className={`${th} text-right`}>타설</th>
          <th className={`${th} pr-3 text-right`}>금액</th>
          <th className={th}>기사님</th>
          <th className={th}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const onChange = (patch: Partial<PhotoRow>) => ctl.update(row.key, patch);
          const dim = row.duplicateOf != null && !row.include;
          const guessed = row.site_guessed && !row.include;
          const tone = dim ? 'bg-slate-50 text-slate-600' : row.site_id == null || guessed ? 'bg-amber-50' : '';
          return (
            <Fragment key={row.key}>
            <tr
              className={`h-14 border-b border-slate-200 ${tone}`}
              title={
                row.duplicateOf
                  ? `이미 장부에 있음: ${row.duplicateOf.label}`
                  : guessed
                    ? `사진의 「${photoSiteText(row)}」 — 현장이 맞으면 체크해 주세요`
                    : undefined
              }
            >
              <td className="px-1.5 text-center">
                <input
                  type="checkbox"
                  checked={row.include}
                  disabled={row.site_id == null}
                  onChange={(e) => onChange({ include: e.target.checked })}
                  className="size-5 accent-slate-900"
                  aria-label="올리기"
                />
              </td>
              <td className="px-1.5">
                <input
                  type="date"
                  value={row.work_date}
                  onChange={(e) => e.target.value && onChange({ work_date: e.target.value })}
                  className={`${cell} tabular`}
                  aria-label="날짜"
                />
              </td>
              <td className="px-1.5">
                <select
                  value={row.site_id ?? ''}
                  onChange={(e) => {
                    if (e.target.value === NEW_SITE) return setAddingKey(row.key);
                    onChange({ site_id: e.target.value ? Number(e.target.value) : null, site_guessed: false, include: Boolean(e.target.value) });
                  }}
                  className={`${cell} ${row.site_id == null || guessed ? 'border-amber-500 font-medium text-amber-800' : ''}`}
                  aria-label="현장"
                  title={photoSiteText(row) ? `사진: ${photoSiteText(row)}` : undefined}
                >
                  <option value="">{photoSiteText(row) ? `사진: ${photoSiteText(row)}` : '현장 고르기'}</option>
                  <option value={NEW_SITE}>새 현장으로 추가</option>
                  {masters.sites
                    .filter((s) => !s.archived)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                </select>
                {guessed && <p className="truncate pb-1 pt-0.5 text-caption font-medium text-amber-800">사진: {photoSiteText(row)}</p>}
              </td>
              <td className="px-1.5">
                <input value={row.description} onChange={(e) => onChange({ description: e.target.value })} className={cell} aria-label="작업 내용" />
              </td>
              <td className="px-1.5">
                <input value={row.time} onChange={(e) => onChange({ time: e.target.value })} placeholder="07:00~17:00" className={`${cell} tabular`} aria-label="작업 시간" />
              </td>
              <td className="px-1.5">
                <input
                  value={row.boom_size ?? ''}
                  onChange={(e) => onChange({ boom_size: numOrNull(e.target.value) })}
                  inputMode="numeric"
                  className={`${cell} text-right tabular`}
                  aria-label="규격 M"
                />
              </td>
              <td className="px-1.5">
                <input
                  value={row.ot_hours || ''}
                  onChange={(e) => onChange({ ot_hours: numOrNull(e.target.value) ?? 0 })}
                  inputMode="decimal"
                  className={`${cell} text-right tabular`}
                  aria-label="OT 시간"
                />
              </td>
              <td className="px-1.5">
                <input
                  value={row.pour_volume ?? ''}
                  onChange={(e) => onChange({ pour_volume: numOrNull(e.target.value) })}
                  inputMode="decimal"
                  className={`${cell} text-right tabular`}
                  aria-label="타설"
                />
              </td>
              <td className="px-1.5">
                <span className="flex items-center gap-1">
                  {row.amount_auto ? <AutoBadge /> : null}
                  <input
                    value={row.base_amount ? won(row.base_amount) : ''}
                    onChange={(e) => onChange({ base_amount: numOrNull(e.target.value) ?? 0 })}
                    inputMode="numeric"
                    placeholder="사진에 없음"
                    className={`${cell} min-w-0 flex-1 text-right tabular`}
                    aria-label="금액"
                  />
                </span>
              </td>
              <td className="px-1.5">
                <select
                  value={row.operator_id ?? ''}
                  onChange={(e) => onChange({ operator_id: e.target.value ? Number(e.target.value) : null })}
                  className={cell}
                  aria-label="기사님"
                >
                  <option value="">{row.operator_text ? `사진: ${row.operator_text}` : ''}</option>
                  {masters.operators
                    .filter((o) => !o.archived)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </td>
              <td className="px-1.5 text-center">
                <button
                  type="button"
                  onClick={() => ctl.remove(row.key)}
                  className="h-11 rounded-lg border border-rose-300 bg-white px-2 text-caption font-medium whitespace-nowrap text-rose-700 hover:bg-rose-50"
                  title="이 줄 완전히 빼기"
                >
                  삭제
                </button>
              </td>
            </tr>
            {addingKey === row.key && (
              <tr className="border-b border-slate-200 bg-amber-50">
                <td colSpan={11} className="px-3 py-3">
                  <PhotoNewSite
                    row={row}
                    masters={masters}
                    onPicked={(id) => {
                      onChange({ site_id: id, site_guessed: false, include: true });
                      setAddingKey(null);
                    }}
                    onCancel={() => setAddingKey(null)}
                  />
                </td>
              </tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// 표 칸 안의 입력칸 — 높이 44px, 글씨 16px
const cell = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';

function Labeled({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-0.5 block text-caption text-slate-500">{label}</span>
      {children}
    </label>
  );
}

// 휴대폰(iOS)은 16px 보다 작은 입력칸을 누르면 화면을 확하늘다
const field = 'w-full rounded-lg border border-slate-300 px-2.5 py-2 text-body outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200';
