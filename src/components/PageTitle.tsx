import { PresenceBadge } from './Presence';

/**
 * 화면 맨 위 왼쪽의 제목 — 휴대폰은 메뉴가 화면 아래에 있어, 지금 어느 화면인지 위에서 바로 보이게 한다.
 * 오른쪽에는 그 화면의 단추를 둘 수 있다 (대시보드의 기간 칸과 같은 자리).
 * 휴대폰에서는 오른쪽 끝에 동시 접속 표시가 붙는다 (PC 는 위쪽 메뉴 줄 안에 있다).
 */
export default function PageTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-11 items-center gap-3 print:hidden">
      <h1 className="text-title font-bold tracking-tight">{children}</h1>
      <div className="ml-auto flex items-center gap-2">
        {right}
        <PresenceBadge className="flex lg:hidden" />
      </div>
    </div>
  );
}
