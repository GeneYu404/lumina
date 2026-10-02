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
      className="dialog-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="dialog"
        style={{ maxWidth: width }}
      >
        <div className="dialog-title">{title}</div>
        <div className="dialog-body win-scroll">{children}</div>
        {footer && (
          <div className="dialog-footer">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
