import { describe, expect, it } from 'vitest';
import { FADE_PX, hintVars, moreToScroll } from '../src/lib/scrollHints';

// 잘려서 안 보이는 쪽에만 흐려지는 표시를 낸다
describe('밀면 더 나오는 쪽', () => {
  const box = { clientWidth: 300, clientHeight: 200, scrollWidth: 300, scrollHeight: 200, scrollLeft: 0, scrollTop: 0 };

  it('다 보이면 아무 쪽도 아니다', () => {
    expect(moreToScroll(box)).toEqual({ left: false, right: false, up: false, down: false });
  });

  it('옆으로 넘치고 맨 왼쪽이면 오른쪽만', () => {
    expect(moreToScroll({ ...box, scrollWidth: 500 })).toMatchObject({ left: false, right: true });
  });

  it('가운데쯤 밀었으면 양쪽 다', () => {
    expect(moreToScroll({ ...box, scrollWidth: 500, scrollLeft: 100 })).toMatchObject({ left: true, right: true });
  });

  it('끝까지 밀면 왼쪽만 (소수점 1px 오차는 끝으로 본다)', () => {
    expect(moreToScroll({ ...box, scrollWidth: 500, scrollLeft: 199.4 })).toMatchObject({ left: true, right: false });
  });

  it('아래로 넘치면 아래쪽', () => {
    expect(moreToScroll({ ...box, scrollHeight: 600, scrollTop: 50 })).toMatchObject({ up: true, down: true });
  });
});

// 그림자 겹은 앞쪽·뒤쪽 두 장 — 어느 변에 그릴지(옆/아래)와 지금 보일지를 따로 넘긴다
describe('바깥 상자에 넣는 값', () => {
  const box = { clientWidth: 300, clientHeight: 200, scrollWidth: 300, scrollHeight: 200, scrollLeft: 0, scrollTop: 0 };

  it('다 보이면 모두 꺼진다', () => {
    expect(hintVars(box)).toEqual({ '--scroll-x': 0, '--scroll-y': 0, '--more-start': 0, '--more-end': 0 });
  });

  it('옆으로 미는 표의 맨 왼쪽: 옆 변, 뒤쪽만', () => {
    expect(hintVars({ ...box, scrollWidth: 500 })).toEqual({
      '--scroll-x': 1,
      '--scroll-y': 0,
      '--more-start': 0,
      '--more-end': 1,
    });
  });

  it('끝까지 밀어도 옆으로 미는 상자인 것은 그대로다 (뒤쪽 그림자가 서서히 사라지게)', () => {
    expect(hintVars({ ...box, scrollWidth: 500, scrollLeft: 200 })).toEqual({
      '--scroll-x': 1,
      '--scroll-y': 0,
      '--more-start': 1,
      '--more-end': 0,
    });
  });

  it('아래로 미는 창의 가운데: 아래 변, 앞뒤 모두', () => {
    expect(hintVars({ ...box, scrollHeight: 600, scrollTop: 50 })).toEqual({
      '--scroll-x': 0,
      '--scroll-y': 1,
      '--more-start': 1,
      '--more-end': 1,
    });
  });

  it('끝에 가까워질수록 그쪽 그림자가 옅어진다', () => {
    const near = hintVars({ ...box, scrollWidth: 500, scrollLeft: FADE_PX / 2 });
    expect(near['--more-start']).toBe(0.5);
    expect(near['--more-end']).toBe(1);
    const nearEnd = hintVars({ ...box, scrollWidth: 500, scrollLeft: 200 - FADE_PX / 4 });
    expect(nearEnd['--more-start']).toBe(1);
    expect(nearEnd['--more-end']).toBe(0.25);
  });
});
