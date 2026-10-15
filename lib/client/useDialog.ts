'use client';

import { useEffect, type RefObject } from 'react';

/**
 * The behaviour every overlay owes a keyboard: Escape closes it, Tab stays
 * inside it, the page behind does not scroll, and focus returns to whatever
 * opened it.
 *
 * Both the bottom sheet and the search overlay had the first of those and none
 * of the rest, so Tab walked straight out of an open dialog and carried on
 * through a list the user could not see.
 */
export function useDialog(
  open: boolean,
  onClose: () => void,
  panelRef: RefObject<HTMLElement | null>,
  options: { initialFocus?: RefObject<HTMLElement | null> } = {},
) {
  const { initialFocus } = options;

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;

    const focusable = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        panel?.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    // Hold the page still, and pad for the scrollbar so it does not jump.
    const { body } = document;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    const focusTimer = window.setTimeout(() => {
      (initialFocus?.current ?? panel)?.focus();
    }, 20);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
      previous?.focus?.();
    };
  }, [open, onClose, panelRef, initialFocus]);
}
