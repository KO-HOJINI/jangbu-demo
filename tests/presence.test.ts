import { describe, expect, it } from 'vitest';
import { deviceName, sqlToIso } from '../worker/routes/presence';
import { clockTime, timeAgo } from '../src/lib/format';

describe('deviceName — 접속 중인 기기 이름', () => {
  // 엣지·웨일·삼성 인터넷은 User-Agent 에 Chrome 을 함께 달고 다닌다.
  // 크롬보다 먼저 가려내지 않으면 전부 '크롬'으로 뭉쳐 누가 누군지 알 수 없다.
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '윈도우 크롬',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      '윈도우 엣지',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Whale/3.27.254.14 Safari/537.36',
      '윈도우 웨일',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      '안드로이드 삼성 인터넷',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      '아이폰 사파리',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      '맥 사파리',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
      '안드로이드 크롬',
    ],
  ])('%s → %s', (ua, expected) => {
    expect(deviceName(ua)).toBe(expected);
  });

  it('User-Agent 가 없으면 빈 칸 대신 알아볼 말을 준다', () => {
    expect(deviceName(undefined)).toBe('알 수 없는 기기');
    expect(deviceName('아무 말')).toBe('알 수 없는 기기');
  });
});

describe('sqlToIso — SQLite 시각을 브라우저가 읽는 형식으로', () => {
  // datetime('now') 는 'YYYY-MM-DD HH:MM:SS' (UTC) 다. 그냥 넘기면 브라우저가
  // 이걸 지역 시각으로 읽어 9시간 어긋난다.
  it('UTC 임을 분명히 해서 넘긴다', () => {
    expect(sqlToIso('2026-09-14 11:22:33')).toBe('2026-09-14T11:22:33Z');
    expect(new Date(sqlToIso('2026-09-14 11:22:33')).getTime()).toBe(Date.parse('2026-09-14T11:22:33Z'));
  });

  it('비어 있으면 지금 시각으로 채운다', () => {
    expect(Number.isNaN(new Date(sqlToIso(null)).getTime())).toBe(false);
  });
});

describe('timeAgo — 임시저장 시각', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const ago = (seconds: number) => timeAgo(new Date(now - seconds * 1000).toISOString(), now);

  it('1분 안쪽은 「방금 전」', () => {
    expect(ago(0)).toBe('방금 전');
    expect(ago(59)).toBe('방금 전');
  });

  it('한 시간 안쪽은 분 단위로', () => {
    expect(ago(60)).toBe('1분 전');
    expect(ago(25 * 60)).toBe('25분 전');
    expect(ago(59 * 60)).toBe('59분 전');
  });

  it('한 시간이 넘으면 시각 자체를 보여준다', () => {
    // 12:00 UTC = 21:00 한국. 한 시간 전이면 20:00.
    expect(ago(60 * 60)).toBe(clockTime(new Date(now - 3_600_000).toISOString()));
    expect(ago(60 * 60)).toMatch(/\d/);
  });

  it('값이 없거나 이상하면 빈 글자', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo('아무 말')).toBe('');
  });
});
