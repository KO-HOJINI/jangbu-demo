import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionEntry } from '../../shared/types';
import { api } from './api';

/**
 * 동시 접속 표시.
 *
 * 20초마다 서버에 「나 아직 여기 있고, 지금 이 문서를 보고 있다」고 알리고,
 * 그 답으로 지금 접속 중인 다른 기기 목록을 받아 둔다.
 * 화면을 덮어 두었거나 다른 탭에 가 있으면 알리지 않는다 (접속 중으로 잘못 보이지 않게).
 * 같은 답에 「장부가 마지막으로 바뀐 시각」도 실려 와, 다른 기기에서 저장한 것을 새로고침 없이 알아챈다.
 */
const BEAT_MS = 20_000;

type View = { key: string; label: string } | null;

const Ctx = createContext<{
  sessions: SessionEntry[];
  setView: (view: View) => void;
}>({ sessions: [], setView: () => {} });

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  // 보고 있는 화면은 ref 에 둔다. state 로 두면 알릴 때마다 화면이 다시 그려진다.
  const view = useRef<View>(null);
  // 마지막으로 받은 「장부가 바뀐 시각」. 처음 한 번은 견줄 것이 없어 적어만 둔다.
  const seen = useRef<string | null | undefined>(undefined);
  const queryClient = useQueryClient();

  const beat = useCallback(async () => {
    try {
      const { sessions, changed } = await api.presence(view.current?.key ?? null, view.current?.label ?? null);
      setSessions(sessions);
      // 그 사이에 장부가 바뀌었으면 받아 둔 내용을 모두 「낡았다」고 표시해 둔다.
      // 지금 보고 있는 화면은 건드리지 않고(적던 것이 바뀌지 않게), 다른 화면은 열 때 새로 불러온다. (2026-10-05 사용자 결정)
      if (seen.current !== undefined && changed !== seen.current) {
        void queryClient.invalidateQueries({ refetchType: 'none' });
      }
      seen.current = changed;
    } catch {
      // 잠깐 끊긴 것뿐일 수 있으니 목록은 그대로 두고 다음 차례를 기다린다
    }
  }, [queryClient]);

  useEffect(() => {
    void beat();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void beat();
    }, BEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [beat]);

  const setView = useCallback(
    (next: View) => {
      if (view.current?.key === next?.key && view.current?.label === next?.label) return;
      view.current = next;
      void beat(); // 화면을 옮긴 건 바로 알려야 상대가 늦게 알지 않는다
    },
    [beat]
  );

  return <Ctx.Provider value={{ sessions, setView }}>{children}</Ctx.Provider>;
}

/** 지금 접속 중인 다른 기기들 (나는 뺀다) */
export function useOthers(): SessionEntry[] {
  return useContext(Ctx).sessions.filter((s) => !s.self);
}

/**
 * 이 화면을 보고 있다고 알린다.
 * key 는 같은 문서인지 맞춰보는 데 쓰고, label 은 상대 화면에 그대로 보인다.
 */
export function useViewing(key: string, label: string) {
  const { setView } = useContext(Ctx);
  useEffect(() => {
    setView({ key, label });
  }, [key, label, setView]);
}

/** 나와 똑같은 문서를 열어 둔 다른 기기 */
export function useClashes(key: string): SessionEntry[] {
  return useOthers().filter((s) => s.viewing === key);
}
