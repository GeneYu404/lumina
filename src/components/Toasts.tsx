import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useStore } from '../store';

const S = useStore.getState;

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
        >
          {t.kind === 'success' ? (
            <CircleCheck size={17} className="toast-ok" />
          ) : t.kind === 'error' ? (
            <CircleAlert size={17} className="toast-err" />
          ) : (
            <Info size={17} className="toast-info" />
          )}
          <span className="toast-msg">{t.message}</span>
          {t.actionLabel && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action?.();
                S().dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button type="button" aria-label="关闭" className="toast-close" onClick={() => S().dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
