import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}

export function Dialog({ open, title, children, footer, onClose, width = 480 }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[900] flex items-center justify-center bg-black/35 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="animate-dialog-in flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-stroke bg-dialog text-fg shadow-dialog"
        style={{ maxWidth: width }}
      >
        <div className="px-6 pb-3 pt-6 text-xl font-semibold">{title}</div>
        <div className="win-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-sm">{children}</div>
        {footer && (
          <div className="grid auto-cols-fr grid-flow-col gap-2 border-t border-stroke bg-dialog-footer px-6 py-5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
