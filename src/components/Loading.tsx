/**
 * DB 에서 아직 값이 오지 않았을 때의 표시.
 *
 * 예전에는 불러오는 동안 「0건」「0원」「없음」이 먼저 떴다가 바뀌어,
 * 정말 0 인지 아직 안 온 것인지 구분이 안 됐다.
 * - 숫자 자리: <Pending unit="원" /> → 흐린 「–원」이 천천히 깜빡인다
 * - 목록·화면 자리: <Loading /> → 도는 표시 + 「불러오는 중…」
 * 움직임 줄이기를 켠 기기에서는 돌거나 깜빡이지 않는다 (motion-safe).
 */

export function Spinner({ className = 'size-[1.2em]' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={`shrink-0 text-slate-400 motion-safe:animate-spin ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/** 목록·화면이 비어 있는 동안 — 가운데 정렬은 감싸는 쪽에서 정한다 */
export function Loading({ label = '불러오는 중…', className = '' }: { label?: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-slate-500 ${className}`}>
      <Spinner />
      {label}
    </span>
  );
}

/** 화면 전체가 아직 없을 때 (기준정보·현장 정보 등) */
export function PageLoading() {
  return (
    <div className="py-16 text-center">
      <Loading />
    </div>
  );
}

/** 숫자가 들어올 자리 — 「–원」 「–건」 */
export function Pending({ unit = '' }: { unit?: string }) {
  return (
    <span aria-label="불러오는 중" className="text-slate-400 motion-safe:animate-pulse">
      –{unit && <span className="ml-[0.2em]">{unit}</span>}
    </span>
  );
}
