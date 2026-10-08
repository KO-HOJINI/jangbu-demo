import { api } from './api';

/**
 * 이 기기에서 알림(웹 푸시)을 켜고 끈다.
 * 알림은 public/sw.js 서비스 워커가 받아 띄운다.
 */

export type PushSupport =
  | 'ok'
  /** 아이폰·아이패드인데 홈 화면 아이콘으로 열지 않았다 — 애플은 이때만 알림을 허락한다 */
  | 'ios-needs-home-screen'
  /** 이 브라우저는 알림을 받지 못한다 */
  | 'unsupported';

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (isIOS() && !isStandalone()) return 'ios-needs-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return 'ok';
}

const toBytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

/** 이 기기가 지금 알림을 받게 되어 있는지 (브라우저 쪽 등록) */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** 알림 받기 켜기. 브라우저가 허락을 묻는다. */
export async function enablePush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '이 기기에서 알림이 막혀 있습니다. 휴대폰(브라우저) 설정에서 이 사이트의 알림을 허용해 주세요.'
        : '알림 허용을 누르지 않았습니다. 다시 눌러 「허용」을 골라 주세요.'
    );
  }
  const { publicKey } = await api.pushKey();
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) as BufferSource }));
  await api.pushSubscribe(sub.toJSON());
  return sub;
}

/** 알림 받기 끄기 (이 기기만) */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
}
