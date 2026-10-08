import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Masters, WorkLog, WorkLogRow } from '../../shared/types';
import { api } from './api';
import { rateFor } from './format';
import { SAVED, toast } from './toast';

export const numOrNull = (v: string) => {
  const t = v.replace(/,/g, '').trim();
  return t === '' ? null : Number(t);
};

/**
 * 장부 한 줄을 고치고 지우는 동작.
 * 넓은 화면의 표(LedgerRow)와 좁은 화면의 카드(LedgerCard)가 같이 쓴다.
 */
export function useWorkLogRow(row: WorkLogRow, masters: Masters, onError: (message: string) => void) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ledger'] });
    queryClient.invalidateQueries({ queryKey: ['summary'] });
  };

  // 고쳐도 아무 반응이 없으면 저장됐는지 알 수 없어, 잠깐 초록으로 물들인다
  const [justSaved, setJustSaved] = useState(false);

  /**
   * 저장이 안 됐거나 숫자 칸에 숫자가 아닌 것을 적었을 때, 칸을 저장된 값으로 되돌린다.
   * 칸의 key 에 이 번호를 붙여 두어 번호가 바뀌면 칸이 새로 그려진다.
   * (예전에는 저장에 실패해도 친 값이 그대로 남아 저장된 것처럼 보였다)
   */
  const [version, setVersion] = useState(0);
  const rollback = () => {
    setVersion((v) => v + 1);
    invalidate();
  };

  const update = useMutation({
    mutationFn: (patch: Partial<WorkLog>) => api.updateWorkLog(row.id, patch),
    onSuccess: () => {
      invalidate();
      toast(SAVED);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 900);
    },
    onError: (e: Error) => {
      rollback();
      onError(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteWorkLog(row.id),
    onSuccess: invalidate,
    onError: (e: Error) => onError(e.message),
  });

  /** 값이 실제로 바뀐 경우에만 저장한다 */
  const save = <K extends keyof WorkLog>(field: K, value: WorkLog[K]) => {
    if (typeof value === 'number' && Number.isNaN(value)) {
      rollback();
      onError('숫자만 적어 주세요. (예: 1,400,000)');
      return;
    }
    if (value === row[field] || (value == null && row[field] == null)) return;
    update.mutate({ [field]: value } as Partial<WorkLog>);
  };

  const currentRate = rateFor(masters.rates, row.site_id, row.boom_size);
  /** 금액을 단가표에서 자동으로 채운 줄인지 — 「자동」 딱지 */
  const isAutoAmount = Boolean(row.amount_auto);
  /**
   * 이 줄의 금액을 손으로 고쳐 놓았는지 (덜 받은 날 등).
   * 자동으로 채운 줄은 나중에 단가표가 바뀌어 금액이 달라져도 손으로 고친 것이 아니다.
   */
  const isCustomAmount = currentRate != null && !isAutoAmount && row.base_amount !== currentRate;
  /** 금액을 다시 채워도 되는 줄 — 비어 있거나, 자동으로 채웠거나, 단가와 같은 줄 */
  const canRefill = row.base_amount === 0 || !isCustomAmount;

  /**
   * 규격(M)을 바꾸면 그 현장의 단가로 금액을 다시 채운다.
   * 단, 금액을 손으로 고쳐 둔 줄은 건드리지 않는다.
   */
  const saveBoomSize = (next: number | null) => {
    if (next === row.boom_size) return;
    const nextRate = rateFor(masters.rates, row.site_id, next);
    const patch: Partial<WorkLog> = { boom_size: next };
    if (nextRate != null && canRefill) Object.assign(patch, { base_amount: nextRate, amount_auto: 1 });
    update.mutate(patch);
  };

  /** 현장을 바꿔도 새 현장의 단가로 금액을 다시 채운다 (예전에는 M 을 바꿀 때만 채웠다) */
  const saveSite = (next: number) => {
    if (next === row.site_id) return;
    const nextRate = rateFor(masters.rates, next, row.boom_size);
    const patch: Partial<WorkLog> = { site_id: next };
    if (nextRate != null && canRefill) Object.assign(patch, { base_amount: nextRate, amount_auto: 1 });
    update.mutate(patch);
  };

  /** 금액을 손으로 적으면 「자동」 딱지를 뗀다 */
  const saveAmount = (next: number | null) => {
    if (next != null && Number.isNaN(next)) return save('base_amount', next);
    const value = next ?? 0;
    if (value === row.base_amount) return;
    update.mutate({ base_amount: value, amount_auto: 0 });
  };

  const confirmRemove = (label: string) => {
    if (confirm(`${label} 작업을 삭제할까요?`)) remove.mutate();
  };

  return {
    save,
    saveBoomSize,
    saveSite,
    saveAmount,
    remove,
    confirmRemove,
    update,
    justSaved,
    currentRate,
    isCustomAmount,
    isAutoAmount,
    version,
  };
}
