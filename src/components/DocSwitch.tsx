import { NavLink } from 'react-router-dom';

/**
 * 휴대폰에서 명세표와 견적서를 오가는 단추 — 아래 메뉴가 여섯 칸을 넘지 않게 견적서를 메뉴에서 빼고 여기 두었다
 * (2026-10-06 사용자 결정). PC 는 위 메뉴에 둘 다 있어 보이지 않는다. 모양은 설정 탭의 휴대폰 밑줄 탭과 같다.
 */
export default function DocSwitch() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `-mb-px flex min-h-11 flex-1 items-center justify-center border-b-2 px-1 py-2 whitespace-nowrap ${
      isActive ? 'border-slate-900 font-medium text-slate-900' : 'border-transparent text-slate-600'
    }`;
  return (
    <nav className="-mx-4 mb-4 flex border-b border-slate-200 px-4 text-caption lg:hidden print:hidden">
      <NavLink to="/statements" className={tab}>
        거래명세표
      </NavLink>
      <NavLink to="/quotes" className={tab}>
        견적서
      </NavLink>
    </nav>
  );
}
