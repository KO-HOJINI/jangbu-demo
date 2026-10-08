import { createPortal } from 'react-dom';
import type { RateLearned } from '../../shared/types';
import { useLeaving } from '../lib/useLeaving';

export type RateQuestion = {
  /** 「다솜 42M 1,400,000원」 */
  text: string;
  answer: (slot: RateLearned['slot']) => void;
  cancel: () => void;
};

/**
 * 단가가 없던 현장·규격에 시간 없이 금액을 적었을 때, 추가하기 전에 하루 금액인지 반나절 금액인지 묻는다.
 * 고른 대로 그 현장의 단가로 등록된다.
 */
export default function RateSlotQuestion({ question }: { question: RateQuestion | null }) {
  // 닫을 때는 올라온 길로 내려간다 — 그 움직임이 끝난 뒤에 답을 넘긴다
  const [leaving, leave] = useLeaving(200);
  if (!question) return null;
  const cancel = () => leave(question.cancel);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="단가 등록"
      className={`anim-overlay fixed inset-0 z-50 grid place-items-end bg-slate-900/40 sm:place-items-center sm:p-4 print:hidden ${leaving ? 'is-leaving' : ''}`}
      onClick={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => e.key === 'Escape' && cancel()}
    >
      <div className="anim-drawer w-full rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-md sm:rounded-2xl sm:pb-5">
        <h2 className="mb-2 text-lead font-bold text-slate-900">하루 금액인가요, 반나절 금액인가요?</h2>
        <p className="mb-4 text-body text-slate-700">
          <strong className="font-bold text-slate-900">{question.text}</strong>
          <br />이 현장에 처음 적는 규격이라 단가로 등록해 둡니다. 다음부터는 금액이 자동으로 들어갑니다.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => leave(() => question.answer('full_day'))}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-body font-medium text-white hover:bg-slate-800"
          >
            하루
          </button>
          <button
            type="button"
            onClick={() => leave(() => question.answer('half_day'))}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-body font-medium text-slate-800 hover:bg-slate-50"
          >
            반나절
          </button>
        </div>
        <button
          type="button"
          onClick={cancel}
          className="mt-2 w-full rounded-xl px-4 py-2.5 text-caption text-slate-700 hover:bg-slate-50"
        >
          추가하지 않고 돌아가기
        </button>
      </div>
    </div>,
    document.body
  );
}
