import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Masters, WorkLog, WorkLogRow } from '../../shared/types';
import type { RateQuestion } from '../components/RateSlotQuestion';
import { api, type NewWorkLog } from './api';
import { autoAmount, learnedRateText, parseTimeRangeInput, rateFor, shouldAskRateSlot, today, won } from './format';

export const numOrNull = (v: string) => {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};

export type NewLogDraft = {
  work_date: string;
  site_id: string;
  description: string;
  /** 「07:00~17:00」 — 저장할 때 시작/끝으로 나눈다 */
  time: string;
  pour_volume: string;
  boom_size: string;
  ot_hours: string;
  base_amount: string;
  operator_id: string;
  business_owner: string;
  fuel_amount: string;
  extra_amount: string;
};

const emptyDraft = (): NewLogDraft => ({
  work_date: today(),
  site_id: '',
  description: '',
  time: '',
  pour_volume: '',
  boom_size: '',
  ot_hours: '',
  base_amount: '',
  operator_id: '',
  business_owner: '',
  fuel_amount: '',
  extra_amount: '',
});

const NUMERIC: (keyof NewLogDraft)[] = ['pour_volume', 'boom_size', 'ot_hours', 'base_amount', 'fuel_amount', 'extra_amount'];

/**
 * 새 작업 한 줄을 적어 장부에 더하는 동작.
 * 표 위의 「새 작업 추가」 칸(NewLogForm)과 장부 표 맨 윗줄(NewLogRow)이 같이 쓴다.
 */
export function useNewLog(masters: Masters, defaultSiteId?: string, onAdded?: (row: WorkLogRow) => void) {
  const [draft, setDraft] = useState<NewLogDraft>(() => ({ ...emptyDraft(), site_id: defaultSiteId ?? '' }));
  const current = draft;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<RateQuestion | null>(null);
  // 자동으로 채워 넣은 금액. 사용자가 직접 친 값과 구분하려고 기억해 둔다.
  const autoFilled = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (input: NewWorkLog) => api.createWorkLog(input),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ['ledger'] });
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['masters'] });
      setError(null);
      // 이 현장·규격의 단가가 없었으면 서버가 이번 금액을 단가로 등록한다. 틀린 금액이면 바로 고칠 수 있게 알린다
      const learned = row.rate_learned;
      setMessage(
        `${row.site_label} ${won(row.supply_amount)}원 추가했습니다.` +
          (learned
            ? ` 이 현장 ${learnedRateText(row.boom_size, learned)}을 등록했습니다 (현장 수정에서 고칠 수 있습니다).`
            : '')
      );
      // 같은 날 여러 건을 이어서 넣는 경우가 많아 날짜·현장·규격·금액·기사님은 남겨 둔다
      setDraft((d) => ({
        ...emptyDraft(),
        work_date: d.work_date,
        site_id: d.site_id,
        boom_size: d.boom_size,
        base_amount: d.base_amount,
        operator_id: d.operator_id,
      }));
      onAdded?.(row);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = <K extends keyof NewLogDraft>(field: K, value: string) => setDraft((d) => ({ ...d, [field]: value }));

  /** 현장·규격이 정해지면 그 현장의 단가를 금액에 넣는다 (직접 친 금액은 건드리지 않는다, 규칙은 autoAmount) */
  const applyRate = (siteIdValue: string, boomValue: string) => {
    const rate = rateFor(masters.rates, siteIdValue ? Number(siteIdValue) : null, numOrNull(boomValue));
    // 기억해 둔 값(autoFilled)은 setDraft 안에서 바꾸지 않는다 — 개발 모드는 그 함수를 두 번 불러 둘째 번에 어긋난다
    const next = autoAmount(draft.base_amount, autoFilled.current, rate);
    if (!next) return;
    autoFilled.current = next.autoFilled;
    setDraft((d) => ({ ...d, base_amount: next.amount }));
  };

  const setSite = (value: string) => {
    set('site_id', value);
    applyRate(value, draft.boom_size);
  };
  const setBoomSize = (value: string) => {
    set('boom_size', value);
    applyRate(draft.site_id, value);
  };
  /** 금액을 손으로 치면 자동으로 채운 값이 아니게 된다 */
  const setAmount = (value: string) => {
    autoFilled.current = null;
    set('base_amount', value);
  };

  /** 금액 칸이 단가표에서 채운 그대로인지 — 「자동」 딱지 */
  const isAuto = autoFilled.current != null && draft.base_amount === autoFilled.current;
  const rate = rateFor(masters.rates, draft.site_id ? Number(draft.site_id) : null, numOrNull(draft.boom_size));
  const typedAmount = numOrNull(draft.base_amount);
  /** 단가와 다른 금액을 적었는지 (덜 받은 날 등) — 주황으로 */
  const discounted = rate != null && typedAmount != null && typedAmount !== rate;

  /** overrides: 방금 고친 칸이 아직 draft 에 안 들어갔을 때 (표 줄의 날짜 칸에서 바로 Enter) */
  const submit = (overrides: Partial<NewLogDraft> = {}) => {
    const draft = { ...current, ...overrides };
    if (overrides.work_date) set('work_date', overrides.work_date);
    const times = parseTimeRangeInput(draft.time);
    if (!times) {
      setError('작업시간은 07:00~17:00 처럼 적어 주세요.');
      return;
    }
    if (NUMERIC.some((k) => Number.isNaN(numOrNull(draft[k])))) {
      setError('금액·시간·규격 칸에는 숫자만 적어 주세요. (예: 1,400,000)');
      return;
    }
    if (!draft.work_date || !draft.site_id) {
      setError('날짜와 현장을 골라 주세요.');
      return;
    }
    setMessage(null);
    const input: Partial<WorkLog> = {
      work_date: draft.work_date,
      site_id: Number(draft.site_id),
      description: draft.description.trim() || null,
      start_time: times.start,
      end_time: times.end,
      pour_volume: numOrNull(draft.pour_volume),
      boom_size: numOrNull(draft.boom_size),
      ot_hours: numOrNull(draft.ot_hours) ?? 0,
      base_amount: numOrNull(draft.base_amount) ?? 0,
      // 단가표에서 채운 금액을 그대로 두었으면 「자동」으로 남긴다
      amount_auto: isAuto ? 1 : 0,
      operator_id: draft.operator_id ? Number(draft.operator_id) : null,
      business_owner: draft.business_owner.trim() || null,
      fuel_amount: numOrNull(draft.fuel_amount),
      extra_amount: numOrNull(draft.extra_amount),
    };

    // 단가가 없던 현장·규격인데 시간을 안 적었으면 하루·반나절을 알 수 없다 — 추가하기 전에 묻는다
    const asks = shouldAskRateSlot(masters.rates, {
      siteId: input.site_id ?? null,
      boomSize: input.boom_size ?? null,
      amount: input.base_amount ?? null,
      hasTime: Boolean(times.start && times.end),
    });
    if (!asks) {
      create.mutate(input);
      return;
    }
    const site = masters.sites.find((x) => x.id === input.site_id);
    setQuestion({
      text: `${site?.label ?? ''} ${input.boom_size}M ${won(input.base_amount ?? 0)}원`.trim(),
      answer: (slot) => {
        setQuestion(null);
        create.mutate({ ...input, rate_slot: slot });
      },
      cancel: () => setQuestion(null),
    });
  };

  const reset = () => {
    setDraft(emptyDraft());
    autoFilled.current = null;
    setMessage(null);
    setError(null);
  };

  return {
    draft,
    set,
    setSite,
    setBoomSize,
    setAmount,
    rate,
    isAuto,
    discounted,
    submit,
    reset,
    pending: create.isPending,
    message,
    error,
    question,
  };
}
