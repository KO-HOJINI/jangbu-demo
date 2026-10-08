/*
 * 알림 전용 서비스 워커.
 *
 * 화면을 닫아 두어도 휴대폰·PC 에 알림(발행일 지난 미발행)을 띄우는 일만 한다.
 * 파일을 저장해 두는(오프라인) 기능은 넣지 않았다 — 옛 화면이 남아 헷갈리는 일이 없게.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '장부', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || '장부', {
      body: data.body || '',
      tag: data.tag,
      icon: '/apple-touch-icon.png',
      badge: '/favicon-32.png',
      lang: 'ko',
      data: { url: data.url || '/' },
    })
  );
});

// 알림을 누르면 이미 열린 장부 창이 있으면 그 창을, 없으면 새 창을 그 화면으로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
