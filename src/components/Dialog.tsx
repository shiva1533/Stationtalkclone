import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ titleId, onClose, children }: DialogProps) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const firstInput = panel.current?.querySelector<HTMLInputElement>('input:not([disabled])');
      (firstInput ?? panel.current)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close.current(); }}>
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="dialog space-y-4"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close.current();
          }
          if (event.key !== 'Tab') return;
          const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href]')];
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        {children}
      </section>
    </div>
  );
}
