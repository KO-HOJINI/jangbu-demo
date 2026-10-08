/**
 * 장부 한 줄이 어떻게 들어왔는지 알리는 작은 딱지.
 *   자동 — 금액을 현장 단가표(M별 금액)에서 채웠다
 *   사진 — 수기 장부 사진에서 읽어 올렸다
 */
/** compact: 좁은 표 칸용 (옆 여백을 줄인다) */
export function AutoBadge({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span
      title="현장 단가표(M별 금액)에서 자동으로 채운 금액입니다"
      className={`inline-flex shrink-0 items-center rounded-md bg-sky-100 ${compact ? 'px-1' : 'px-1.5'} text-caption leading-6 font-medium text-sky-800 ${className}`}
    >
      자동
    </span>
  );
}

export function PhotoBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="수기 장부 사진에서 읽어 올린 기록입니다"
      className={`inline-flex shrink-0 items-center rounded-md bg-violet-100 px-1.5 text-caption leading-6 font-medium text-violet-800 ${className}`}
    >
      사진
    </span>
  );
}
