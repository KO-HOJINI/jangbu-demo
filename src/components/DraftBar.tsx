import { clockTime, timeAgo } from '../lib/format';
import type { DraftHandle } from '../lib/useDraft';

/**
 * 작성 중인 명세표·견적서의 임시저장 줄.
 *
 * 발행 전에는 저장 버튼이 따로 없고 손을 멈추면 알아서 담기므로,
 * 「담겼다」는 것과 「되돌릴 수 있다」는 것을 이 줄 하나로 보여준다.
 */
export default function DraftBar({ draft, what }: { draft: DraftHandle; what: string }) {
  if (!draft.loaded) return null;

  return (
    // 휴대폰에서는 한 줄에 들어가게 줄인다 — 시각은 빼고, 단추는 화살표만, 지점 고르기는 좁게
    <div className="mb-4 flex items-center gap-x-2 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-wrap sm:gap-x-3 sm:px-4 print:hidden">
      <span className="min-w-0 truncate text-caption text-slate-600">
        {draft.saving ? (
          '임시저장 중…'
        ) : draft.savedAt ? (
          <>
            <span className="text-emerald-600">●</span> 임시저장됨<span className="max-sm:hidden"> · {timeAgo(draft.savedAt)}</span>
          </>
        ) : (
          `${what}를 고치면 자동으로 담아 둡니다`
        )}
      </span>

      <span className="hidden text-caption text-slate-500 sm:inline">
        다른 컴퓨터에서 로그인해도 여기서 이어서 하실 수 있습니다
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:flex-wrap">
        <button
          type="button"
          onClick={draft.undo}
          disabled={!draft.canUndo || draft.saving}
          aria-label="되돌리기"
          className="tap rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-caption whitespace-nowrap max-sm:min-w-11 hover:bg-slate-100 disabled:opacity-40"
        >
          ↩<span className="max-sm:hidden"> 되돌리기</span>
        </button>
        <button
          type="button"
          onClick={draft.redo}
          disabled={!draft.canRedo || draft.saving}
          aria-label="다시 실행"
          className="tap rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-caption whitespace-nowrap max-sm:min-w-11 hover:bg-slate-100 disabled:opacity-40"
        >
          ↪<span className="max-sm:hidden"> 다시 실행</span>
        </button>

        {draft.points.length > 1 && (
          <select
            value=""
            onChange={(e) => e.target.value && draft.restore(Number(e.target.value))}
            aria-label="지난 시각으로 되돌리기"
            className="rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-caption max-sm:w-28"
          >
            {/* 휴대폰 폭(112px)에서 잘리지 않게 짧게 쓴다 */}
            <option value="">지난 시각</option>
            {draft.points.map((p) => (
              <option key={p.id} value={p.id}>
                {clockTime(p.savedAt)}
                {p.current ? ' (지금)' : ''}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
