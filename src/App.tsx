import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, api } from './lib/api';
import { signOut } from './lib/signOut';
import { PresenceProvider } from './lib/presence';
import { isTypingField } from './lib/keyboardScroll';
import { useMarker } from './lib/useMarker';
import { overdueTitle } from '../shared/issueDue';
import { PresenceBadge } from './components/Presence';
import Toaster from './components/Toaster';
import OverdueBanner from './components/OverdueBanner';
import { Loading, PageLoading } from './components/Loading';
import MutationGuard from './components/MutationGuard';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const LedgerPage = lazy(() => import('./pages/LedgerPage'));
const SitesPage = lazy(() => import('./pages/SitesPage'));
const SiteDetailPage = lazy(() => import('./pages/SiteDetailPage'));
const SiteFormPage = lazy(() => import('./pages/SiteFormPage'));
const StatementsPage = lazy(() => import('./pages/StatementsPage'));
const QuotesPage = lazy(() => import('./pages/QuotesPage'));
const OperatorsPage = lazy(() => import('./pages/OperatorsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function prefetchRoute(to: string) {
  if (to.startsWith('/ledger')) {
    import('./pages/LedgerPage');
  } else if (to.startsWith('/sites')) {
    import('./pages/SitesPage');
    import('./pages/SiteDetailPage');
  } else if (to.startsWith('/statements')) {
    import('./pages/StatementsPage');
  } else if (to.startsWith('/quotes')) {
    import('./pages/QuotesPage');
  } else if (to.startsWith('/operators')) {
    import('./pages/OperatorsPage');
  } else if (to.startsWith('/dashboard')) {
    import('./pages/DashboardPage');
  } else if (to.startsWith('/settings')) {
    import('./pages/SettingsPage');
  }
}

// 지금 주소의 화면은 로그인 확인(/api/me)을 기다리지 않고 바로 받기 시작한다.
// 화면을 나눈 뒤로는 「로그인 확인 → 그 화면 파일 받기 → 그 화면의 자료 받기」가 줄줄이 이어져, 한 덩어리일 때보다 첫 화면이 늦게 떴다
prefetchRoute(window.location.pathname === '/' ? '/ledger' : window.location.pathname);

/** 나머지 화면 전부 — 한가할 때 받아 두면 메뉴를 처음 누를 때도 「불러오는 중」이 뜨지 않는다 */
function prefetchAll() {
  import('./pages/LedgerPage');
  import('./pages/SitesPage');
  import('./pages/SiteDetailPage');
  import('./pages/SiteFormPage');
  import('./pages/StatementsPage');
  import('./pages/QuotesPage');
  import('./pages/OperatorsPage');
  import('./pages/DashboardPage');
  import('./pages/SettingsPage');
}

export default function App() {
  const {
    data: user,
    isPending,
    error,
  } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
  });

  // 쓰는 도중 로그인이 끝나면(api.ts 가 알림) 바로 로그인 화면을 보여준다
  const queryClient = useQueryClient();
  useEffect(() => {
    const signedOut = () => queryClient.setQueryData(['me'], null);
    window.addEventListener('jangbu:signed-out', signedOut);
    return () => window.removeEventListener('jangbu:signed-out', signedOut);
  }, [queryClient]);

  // 첫 화면 렌더링 후 브라우저가 한가할 때 자주 쓰이는 화면을 조용히 받아 둔다
  useEffect(() => {
    if (!user) return;
    const idleId = (window as any).requestIdleCallback
      ? (window as any).requestIdleCallback(prefetchAll, { timeout: 3000 })
      : setTimeout(prefetchAll, 1500);

    return () => {
      if ((window as any).cancelIdleCallback && typeof idleId === 'number') {
        (window as any).cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as any);
      }
    };
  }, [user]);

  // 메뉴를 옮기면 새 화면이 살짝 떠오르며 나타난다. 같은 메뉴 안(현장 목록 → 현장 하나)에서는 그대로 둔다
  const section = useLocation().pathname.split('/')[1] ?? '';

  if (isPending) {
    return <div className="grid min-h-dvh place-items-center">
        <Loading />
      </div>;
  }

  if (!user) {
    const unexpected = error instanceof ApiError && error.status !== 401 ? error.message : null;
    return (
      <>
        <MutationGuard />
        <Suspense
          fallback={
            <div className="grid min-h-dvh place-items-center">
              <Loading />
            </div>
          }
        >
          <LoginPage notice={unexpected} />
        </Suspense>
      </>
    );
  }

  return (
    <PresenceProvider>
      <div className="min-h-dvh">
        <MutationGuard />
        <Header userName={user.name} />
        <div className="gutter-balance">
        <main className="app-main mx-auto max-w-[1400px] px-4 py-6 print:max-w-none print:p-0">
          <OverdueBanner />
          <div key={section} className="anim-page">
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<Navigate to="/ledger" replace />} />
              <Route path="/ledger" element={<LedgerPage />} />
              <Route path="/sites" element={<SitesPage />} />
              <Route path="/sites/new" element={<SiteFormPage />} />
              <Route path="/sites/:id" element={<SiteDetailPage />} />
              <Route path="/sites/:id/edit" element={<SiteFormPage />} />
              <Route path="/statements" element={<StatementsPage />} />
              <Route path="/statements/new" element={<StatementsPage />} />
              <Route path="/statements/:id" element={<StatementsPage />} />
              <Route path="/quotes" element={<QuotesPage />} />
              <Route path="/quotes/:id" element={<QuotesPage />} />
              <Route path="/operators" element={<OperatorsPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/ledger" replace />} />
            </Routes>
          </Suspense>
          </div>
        </main>
        </div>
        <Toaster />
      </div>
    </PresenceProvider>
  );
}

function Header({ userName }: { userName: string }) {

  // 지금 메뉴 뒤에 깔리는 검은 상자. 메뉴를 바꾸면 그 자리로 미끄러져 간다

  // 발행일이 내일까지 돌아오는데 안 낸 명세표가 있으면 메뉴의 「명세표」에 점을 붙인다 (맨 위 알림 띠와 같은 자료)
  const overdue = useQuery({ queryKey: ['overdue'], queryFn: api.overdue, staleTime: 5 * 60_000 });
  const dueNotice = overdue.data?.items.length ? overdueTitle(overdue.data.items, overdue.data.today) : undefined;

  const { pathname } = useLocation();
  // 휴대폰에서 견적서를 보는 동안에는 메뉴에 견적서 칸이 없어, 표시가 「명세표」 칸에 머문다 (data-current)
  const [navRef, marker] = useMarker<HTMLElement>(['a[aria-current="page"]', 'a[data-current]'], pathname);

  // 휴대폰에서 글자를 적는 동안에는 떠 있는 메뉴를 내려 둔다 (자판 위로 올라와 칸을 가린다)
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const update = () => setTyping(isTypingField(document.activeElement));
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  return (
    <header className={`app-nav gutter-balance print:hidden ${typing ? 'is-away' : ''}`}>
      {/*
        휴대폰에서는 메뉴 여섯 개가 한 줄에 들어가도록 앱 이름과 계정 영역을 감춘다.
        (밀어서 찾게 하면 「설정」을 못 찾는다. 로그아웃은 설정 → 계정에 있다)
        일곱 번째인 견적서는 휴대폰 메뉴에서 빼고 명세표 화면 위의 단추(DocSwitch)로 오간다 (2026-10-06 사용자 결정)
      */}
      <div className="mx-auto flex max-w-[1400px] items-center gap-1.5 p-[5px] whitespace-nowrap lg:gap-4 lg:px-4 lg:py-1.5">
        <span className="hidden shrink-0 text-lead font-bold tracking-tight lg:inline">장부</span>
        <nav ref={navRef} className="relative flex min-w-0 flex-1 text-caption lg:flex-none lg:gap-1">
          {marker && (
            <span aria-hidden="true" className="nav-marker" style={marker} />
          )}
          <Tab to="/ledger">작업일보</Tab>
          <Tab to="/sites">현장별</Tab>
          <Tab to="/statements" shortLabel="명세표" notice={dueNotice} phoneAlso="/quotes">
            거래명세표
          </Tab>
          <Tab to="/quotes" className="max-lg:hidden">
            견적서
          </Tab>
          <Tab to="/operators">기사님</Tab>
          <Tab to="/dashboard">통계</Tab>
          <Tab to="/settings">설정</Tab>
        </nav>
        <div className="ml-auto hidden shrink-0 items-center gap-3 text-caption text-slate-600 lg:flex">
          {/* 휴대폰에서는 화면 제목 줄 오른쪽 끝에 나온다 (PageTitle 등) */}
          <PresenceBadge className="flex" />
          <span>{userName}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg px-2 py-1 hover:bg-slate-100 hover:text-slate-900"
          >
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}

function Tab({
  to,
  shortLabel,
  notice,
  phoneAlso,
  className = '',
  children,
}: {
  to: string;
  /** 휴대폰에서는 이 주소의 화면도 이 메뉴에 든 것으로 본다 (그 화면의 메뉴 칸이 휴대폰에는 없다) */
  phoneAlso?: string;
  className?: string;
  /** 이 메뉴에 볼 일이 있을 때 붙는 점의 설명 (예: 「오늘 발행할 명세표 2곳」) */
  notice?: string;
  /** 좁은 화면에서 쓸 짧은 이름 (없으면 원래 이름 그대로) */
  shortLabel?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const alsoHere = phoneAlso != null && pathname.startsWith(phoneAlso);
  return (
    <NavLink
      to={to}
      data-current={alsoHere || undefined}
      onMouseEnter={() => prefetchRoute(to)}
      onTouchStart={() => prefetchRoute(to)}
      // 아래로 내려 보다가 메뉴를 누르면 (지금 화면의 메뉴여도) 맨 위로 올라간다. 하루에도 여러 번 누르는 자리라 미끄러지지 않고 바로 올린다
      onClick={(e) => {
        // 지금 화면의 메뉴를 또 누르면 장부를 서버에서 새로 받는다 — 새로 고침 없이 다른 기기에서 적은 것을 본다 (2026-10-05 사용자 결정).
        // 적고 있는 칸은 받아 온 자료와 따로라 그대로 남는다
        if (window.location.pathname === to && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
          window.scrollTo({ top: 0 });
          void queryClient.invalidateQueries();
          return;
        }
        // 새 탭으로 여는 누름(Ctrl·가운데 단추 등), 겹쳐 넘어가기를 못 쓰는 브라우저는 하던 대로
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !document.startViewTransition) {
          window.scrollTo({ top: 0 });
          return;
        }
        // 앞 화면이 뚝 사라지지 않고 흐려지며 다음 화면으로 넘어간다 (index.css 의 ::view-transition).
        // 앞 화면을 찍어 둔 뒤에 올려야, 내려 보던 자리 그대로 흐려진다
        e.preventDefault();
        document.startViewTransition(() => {
          flushSync(() => navigate(to));
          window.scrollTo({ top: 0 });
        });
      }}
      // 바탕은 뒤에 깔린 표시(.nav-marker)가 맡는다 — 진한 칸에 흰 글자 (PC 는 상자, 휴대폰은 알약).
      // 휴대폰은 글자 수가 달라도 양옆 여백이 같게 남는 폭을 고루 나눈다 (flex-auto). 올렸을 때 회색 상자는 PC 에서만
      className={({ isActive }) =>
        `tap relative inline-flex min-h-11 flex-auto items-center justify-center rounded-full px-1 font-medium transition-colors duration-150 lg:flex-none lg:rounded-xl lg:px-3 ${
          isActive ? 'text-white' : `text-slate-600 hover:text-slate-900 lg:hover:bg-slate-100 ${alsoHere ? 'max-lg:text-white' : ''}`
        } ${className}`
      }
    >
      {shortLabel ? (
        <>
          <span className="lg:hidden">{shortLabel}</span>
          <span className="hidden lg:inline">{children}</span>
        </>
      ) : (
        children
      )}
      {notice && (
        <span title={notice} className="absolute top-2 right-1 size-2 rounded-full bg-amber-500 lg:top-1.5">
          <span className="sr-only">{notice}</span>
        </span>
      )}
    </NavLink>
  );
}
