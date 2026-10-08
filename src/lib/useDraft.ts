import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftPoint, DraftState } from '../../shared/types';
import { api } from './api';

/**
 * 자동 임시저장.
 *
 * 화면 값이 바뀌고 잠깐 조용해지면 서버에 담아 둔다. 브라우저가 아니라 서버라서
 * 다른 컴퓨터에서 로그인해도 하던 작업이 그대로 이어진다.
 * 저장될 때마다 되돌아갈 지점이 하나씩 쌓이고, 되돌리기로 그 사이를 오갈 수 있다.
 */

/** 손을 멈추고 이만큼 지나면 담아 둔다 */
const QUIET_MS = 1_200;

export interface DraftHandle {
  /** 처음 불러오기가 끝났는가 — 끝나기 전에는 화면 초기값을 정하면 안 된다 */
  loaded: boolean;
  /** 마지막으로 담아 둔 시각 (ISO). 아직 한 번도 안 담았으면 null */
  savedAt: string | null;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 되돌아갈 수 있는 지점들 (최근 것이 앞) */
  points: DraftPoint[];
  undo: () => void;
  redo: () => void;
  restore: (id: number) => void;
  /** 발행을 마쳤을 때처럼 기록째 지운다 */
  clear: () => void;
}

export function useDraft<T>(options: {
  /** 'statement' | 'quote' */
  kind: string;
  /** 발행본을 보고 있을 때처럼 임시저장이 필요 없으면 false */
  enabled: boolean;
  /** 지금 화면 값 */
  value: T;
  /** 화면 초기화가 끝나 담아 둘 만한 상태인가 */
  ready: boolean;
  /** 담아 둔 것을 화면에 도로 넣는다 (불러왔을 때 · 되돌렸을 때) */
  onLoad: (payload: T) => void;
}): DraftHandle {
  const { kind, enabled, value, ready, onLoad } = options;

  const [loaded, setLoaded] = useState(!enabled);
  const [state, setState] = useState<DraftState<T> | null>(null);
  const [saving, setSaving] = useState(false);

  // onLoad 는 화면이 새로 그릴 때마다 새 함수가 되므로 ref 로 잡아 둔다.
  // 이걸 의존성에 넣으면 매번 다시 불러오게 된다.
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  /**
   * 마지막으로 서버와 맞춰 둔 내용.
   * 되돌리기로 값을 도로 넣으면 화면 값이 바뀌지만 그건 「새 편집」이 아니므로,
   * 이 값과 같으면 저장하지 않는다.
   */
  const synced = useRef<string | null>(null);

  const take = useCallback((next: DraftState<T> | null) => {
    setState(next);
    if (next) {
      synced.current = JSON.stringify(next.payload);
      onLoadRef.current(next.payload);
    }
  }, []);

  // 처음 한 번 불러오기
  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    let alive = true;
    api
      .draft<T>(kind)
      .then((draft) => {
        if (!alive) return;
        take(draft);
      })
      .catch(() => {
        // 못 불러와도 화면은 열려야 한다. 새로 작성하는 것으로 본다.
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [kind, enabled, take]);

  // 값이 바뀌고 잠깐 조용해지면 담아 둔다
  const serialized = JSON.stringify(value);
  useEffect(() => {
    if (!enabled || !loaded || !ready) return;
    if (serialized === synced.current) return;

    const timer = setTimeout(() => {
      synced.current = serialized;
      setSaving(true);
      api
        .saveDraft<T>(kind, JSON.parse(serialized) as T)
        .then(setState)
        .catch(() => {
          // 다음 편집 때 다시 시도된다
          synced.current = null;
        })
        .finally(() => setSaving(false));
    }, QUIET_MS);

    return () => clearTimeout(timer);
  }, [serialized, enabled, loaded, ready, kind]);

  const step = useCallback(
    (run: () => Promise<DraftState<T>>) => {
      setSaving(true);
      run()
        .then(take)
        .catch(() => {})
        .finally(() => setSaving(false));
    },
    [take]
  );

  return {
    loaded,
    savedAt: state?.savedAt ?? null,
    saving,
    canUndo: state?.canUndo ?? false,
    canRedo: state?.canRedo ?? false,
    points: state?.points ?? [],
    undo: () => step(() => api.undoDraft<T>(kind)),
    redo: () => step(() => api.redoDraft<T>(kind)),
    restore: (id: number) => step(() => api.restoreDraft<T>(kind, id)),
    clear: () => {
      synced.current = null;
      setState(null);
      void api.clearDraft(kind).catch(() => {});
    },
  };
}
