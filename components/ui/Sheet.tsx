'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useDialog } from '@/lib/client/useDialog';

/**
 * Bottom sheet with a drag-to-dismiss grabber on touch, centred as a dialog on
 * wide screens. Focus is trapped while open and Escape closes it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  useDialog(open, onClose, panelRef);

  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  if (!open) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    setDragY(Math.max(0, e.clientY - dragStart.current));
  };
  const onPointerUp = () => {
    if (dragY > 110) onClose();
    dragStart.current = null;
    setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={clsx(
          'animate-sheet relative max-h-[86vh] w-full overflow-y-auto scroll-touch rounded-t-[var(--radius-sheet)] pb-safe outline-none',
          'border-t bg-[var(--bg-raised,var(--bg-elevated))] shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.45)] hairline',
          'sm:max-w-lg sm:rounded-[var(--radius-sheet)] sm:border',
          className,
        )}
      >
        <div
          className="sticky top-0 z-10 flex cursor-grab touch-none justify-center bg-[var(--bg-raised,var(--bg-elevated))] pt-2.5 pb-1 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="my-1.5 h-1.5 w-11 rounded-full bg-[var(--border-strong)]" aria-hidden />
        </div>
        {children}
      </div>
    </div>
  );
}
