import { useEffect, useRef, useState } from 'react';
import { useLeaving } from '../lib/useLeaving';

/** PC 웹캠으로 장부를 찍는 모달 창 */
export function WebcamDialog({ onShot, onClose }: { onShot: (blob: Blob) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, leave] = useLeaving(160);
  const close = () => leave(onClose);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() =>
        setError('이 컴퓨터에 카메라가 없거나 카메라 사용이 막혀 있습니다. 휴대폰으로 찍거나 「사진 고르기」로 올려 주세요.')
      );
    if (!navigator.mediaDevices) setError('이 브라우저는 카메라를 쓸 수 없습니다. 「사진 고르기」로 올려 주세요.');
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    canvas.toBlob((b) => b && onShot(b), 'image/jpeg', 0.9);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="웹캠으로 장부 찍기"
      className={`anim-overlay fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-4 ${leaving ? 'is-leaving' : ''}`}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="anim-sheet w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl">
        <h2 className="mb-1 text-lead font-bold">장부 찍기</h2>
        <p className="mb-3 text-caption text-slate-600">장부 한 쪽이 화면에 꽉 차게 카메라 앞에 대고 「찍기」를 누르세요.</p>
        {error ? (
          <p className="mb-3 rounded-xl bg-amber-50 px-3 py-3 text-body text-amber-900">{error}</p>
        ) : (
          <video ref={video} autoPlay playsInline muted className="mb-3 aspect-video w-full rounded-xl bg-slate-900 object-contain" />
        )}
        <div className="flex gap-2">
          {!error && (
            <button type="button" onClick={shoot} className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-body font-medium text-white hover:bg-slate-800">
              찍기
            </button>
          )}
          <button type="button" onClick={close} className="rounded-xl border border-slate-300 px-4 py-2.5 text-body hover:bg-slate-50">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
