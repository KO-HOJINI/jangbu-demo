import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { signOut } from '../lib/signOut';
import { useMarker } from '../lib/useMarker';
import { PresenceBadge } from '../components/Presence';
import SitesManageTab from '../components/SitesManageTab';
import { useViewing } from '../lib/presence';
import { PageLoading } from '../components/Loading';
// 탭마다 파일이 따로 있다 (src/components/settings) — 한 파일이 1,000줄을 넘어 읽고 고치기 어려웠다
import CompaniesTab from '../components/settings/CompaniesTab';
import ClientsTab from '../components/settings/ClientsTab';
import BackupsTab from '../components/settings/BackupsTab';
import AccountTab from '../components/settings/AccountTab';

type Tab = 'companies' | 'clients' | 'sites' | 'backups' | 'account';

const TABS: { key: Tab; label: string }[] = [
  { key: 'companies', label: '내 회사' },
  { key: 'clients', label: '거래처' },
  { key: 'sites', label: '현장' },
  { key: 'backups', label: '백업' },
  { key: 'account', label: '계정' },
];

export default function SettingsPage() {
  useViewing('settings', '설정');
  // 다른 화면에서 탭을 가리켜 올 수 있다 (메일 창의 「설정 > 계정」 → /settings?tab=account)
  const [params] = useSearchParams();
  const asked = TABS.find((t) => t.key === params.get('tab'))?.key;
  const [tab, setTab] = useState<Tab>(asked ?? 'companies');

  const [tabsRef, tabMarker] = useMarker<HTMLElement>('button[aria-pressed="true"]', tab);
  const masters = useQuery({ queryKey: ['masters'], queryFn: api.masters });
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage });

  if (masters.isPending) return <PageLoading />;
  if (masters.error) return <p className="text-rose-600">{masters.error.message}</p>;

  const m = masters.data!;

  return (
    <>
      {/*
        PC 는 대시보드의 기간 고르기와 같은 회색 상자. 휴대폰은 아래에 떠 있는 메뉴가 이미 알약 모양이라
        밑줄 탭으로 하고(다섯 칸이 폭을 똑같이 나눠 한 줄에 다 보인다), 내려 읽는 동안에도 화면 위에 붙어 있다.
        붙어 있으려면 긴 내용과 같은 상자 안에 있어야 해서, 휴대폰에서는 이 묶음을 풀어(contents) 놓는다.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 max-lg:contents">
        <div className="flex min-h-11 items-center justify-between gap-3 max-lg:mb-1">
          <h1 className="text-title font-bold tracking-tight">설정</h1>
          <PresenceBadge className="ml-auto flex lg:hidden" />
          <button
            type="button"
            onClick={signOut}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-caption whitespace-nowrap hover:bg-slate-50 lg:hidden"
          >
            로그아웃
          </button>
        </div>
        {/* 대시보드 기간 단추와 같은 모양·높이 (PC 44px) */}
        <nav
          ref={tabsRef}
          className="relative flex text-caption max-lg:sticky max-lg:top-0 max-lg:z-20 max-lg:-mx-4 max-lg:mb-4 max-lg:border-b max-lg:border-slate-200 max-lg:bg-slate-100 max-lg:px-4 lg:inline-flex lg:h-11 lg:rounded-xl lg:border lg:border-slate-200 lg:bg-slate-50 lg:p-1"
        >
          {/* 고른 탭 표시(PC 흰 상자, 휴대폰 밑줄) — 탭을 바꾸면 미끄러져 간다 */}
          {tabMarker && <span aria-hidden="true" className="seg-marker" style={tabMarker} />}
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`relative flex-1 px-1 py-2 whitespace-nowrap transition lg:min-h-0! lg:flex-none lg:rounded-lg lg:px-3.5 lg:py-0 ${
                tab === t.key ? 'font-medium text-slate-900' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div key={tab} className="anim-page">
      {tab === 'companies' && <CompaniesTab companies={m.companies} />}
      {tab === 'clients' && <ClientsTab clients={m.clients} usage={usage.data?.clients} />}
      {tab === 'sites' && <SitesManageTab />}
      {tab === 'backups' && <BackupsTab />}
      {tab === 'account' && <AccountTab />}
      </div>
    </>
  );
}
