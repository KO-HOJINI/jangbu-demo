/**
 * 접었다 펴는 상자 — 높이가 부드럽게 늘고 준다 (움직임은 index.css 의 .fold).
 * 내용은 접혀 있어도 그대로 두므로 적던 값이 사라지지 않는다.
 */
export default function Fold({
  open,
  lgOpen = false,
  children,
}: {
  open: boolean;
  /** PC 에서는 늘 펼쳐 둔다 (휴대폰에서만 접는 상자) */
  lgOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`fold ${open ? 'is-open' : ''} ${lgOpen ? 'lg-open' : ''}`}>
      <div>
        {/* 위아래 4px: 맨 윗줄·아랫줄 칸의 테두리 빛이 잘리지 않게 */}
        <div className="py-1">{children}</div>
      </div>
    </div>
  );
}
