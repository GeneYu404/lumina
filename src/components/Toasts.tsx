import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useStore } from '../store';

const S = useStore.getState;

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 z-40 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in pointer-events-auto flex max-w-[min(92%,560px)] items-center gap-3 rounded-lg border border-stroke bg-acrylic py-2 pl-3 pr-1.5 text-[13px] text-fg shadow-flyout backdrop-blur-2xl"
        >
          {t.kind === 'success' ? (
            <CircleCheck size={17} className="shrink-0 text-[#6ccb5f]" />
          ) : t.kind === 'error' ? (
            <CircleAlert size={17} className="shrink-0 text-[#ff99a4]" />
          ) : (
            <Info size={17} className="shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              className="shrink-0 rounded-md px-2.5 py-1 font-medium text-accent hover:bg-subtle"
              onClick={() => {
                t.action?.();
                S().dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button type="button" aria-label="关闭" className="shrink-0 rounded-md p-1.5 text-fg2 hover:bg-subtle" onClick={() => S().dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
