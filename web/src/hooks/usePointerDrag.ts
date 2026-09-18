import { useCallback, useRef, useState } from 'react';

export interface ActivePointerDrag<T = string> {
  itemId: T;
  currentX: number;
  currentY: number;
  targetContainer: number;
  targetIndex: number;
}

export interface UsePointerDragOptions<T = string> {
  /** Refs to container DOM elements (columns, drop zones) */
  containerRefs: React.RefObject<HTMLElement | null>[];
  /** Query selector attribute used to find items inside a container, e.g. 'data-drag-item' */
  itemSelector?: string;
  /** Minimum movement distance (in px) before dragging is considered initiated (defaults to 4) */
  threshold?: number;
  /** Callback fired when an item is dropped onto a target container and index */
  onDrop: (itemId: T, targetContainer: number, targetIndex: number) => void;
}

/**
 * usePointerDrag is a system-wide, high-performance Pointer Events drag-and-drop hook.
 * It operates entirely in user space without invoking native HTML5 drag-and-drop APIs,
 * bypassing Chromium Windows OLE message loop deadlocks and Skia offscreen rasterization freezes.
 */
export function usePointerDrag<T = string>({
  containerRefs,
  itemSelector = 'data-drag-item',
  threshold = 4,
  onDrop,
}: UsePointerDragOptions<T>) {
  const [activeDrag, setActiveDrag] = useState<ActivePointerDrag<T> | null>(null);
  const activeDragRef = useRef(activeDrag);
  activeDragRef.current = activeDrag;

  const startPointerDrag = useCallback(
    (itemId: T, startEvt: React.PointerEvent) => {
      if (startEvt.button !== 0) return; // Only primary mouse button
      startEvt.preventDefault();

      const startX = startEvt.clientX;
      const startY = startEvt.clientY;
      let hasExceededThreshold = false;

      const getTargetContainer = (clientX: number, clientY: number): number => {
        const rects = containerRefs.map((ref) => ref.current?.getBoundingClientRect());
        const validRects = rects.filter(Boolean) as DOMRect[];
        if (validRects.length === 0) return 0;

        // 1. Direct hit check
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
            return i;
          }
        }

        // 2. Check if layout is vertically stacked (e.g. mobile) or horizontally arranged
        const isStacked =
          rects.length > 1 &&
          rects[0] &&
          rects[1] &&
          Math.abs(rects[0].left - rects[1].left) < 50;

        if (isStacked) {
          for (let i = 0; i < rects.length; i++) {
            const r = rects[i];
            if (r && clientY < r.bottom) return i;
          }
          return rects.length - 1;
        } else {
          // Horizontal side-by-side
          for (let i = 0; i < rects.length - 1; i++) {
            const current = rects[i];
            const next = rects[i + 1];
            if (current && next && clientX < (current.right + next.left) / 2) {
              return i;
            }
          }
          return rects.length - 1;
        }
      };

      const getTargetIndex = (targetContainer: number, clientY: number): number => {
        const items = document.querySelectorAll(
          `[${itemSelector}][data-container="${targetContainer}"]`
        );
        let targetIdx = items.length;
        for (let i = 0; i < items.length; i++) {
          const rect = items[i].getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) {
            targetIdx = i;
            break;
          }
        }
        return targetIdx;
      };

      const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!hasExceededThreshold) {
          if (Math.hypot(dx, dy) >= threshold) {
            hasExceededThreshold = true;
          } else {
            return;
          }
        }

        const targetContainer = getTargetContainer(e.clientX, e.clientY);
        const targetIndex = getTargetIndex(targetContainer, e.clientY);

        setActiveDrag({
          itemId,
          currentX: e.clientX,
          currentY: e.clientY,
          targetContainer,
          targetIndex,
        });
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', cleanup);
        window.removeEventListener('keydown', onKeyDown);
      };

      const onPointerUp = () => {
        cleanup();
        if (hasExceededThreshold && activeDragRef.current) {
          const { itemId: id, targetContainer, targetIndex } = activeDragRef.current;
          onDrop(id, targetContainer, targetIndex);
        }
        setActiveDrag(null);
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          cleanup();
          setActiveDrag(null);
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', cleanup);
      window.addEventListener('keydown', onKeyDown);
    },
    [containerRefs, itemSelector, onDrop, threshold],
  );

  return {
    activeDrag,
    startPointerDrag,
    isDragging: activeDrag !== null,
  };
}
