import { GripVertical } from 'lucide-react';

export interface DragOverlayProps {
  title: string;
  containerLabel?: string;
  x: number;
  y: number;
}

/**
 * DragOverlay renders a GPU-accelerated floating ghost badge following the cursor
 * at 60fps/120fps during active drag operations.
 */
export function DragOverlay({ title, containerLabel, x, y }: DragOverlayProps) {
  return (
    <div
      className="fixed pointer-events-none z-50 rounded-xl bg-card/98 border-2 border-primary shadow-2xl px-4 py-2.5 flex items-center gap-2.5 -translate-x-1/2 -translate-y-1/2 select-none"
      style={{ left: x, top: y }}
    >
      <GripVertical className="size-4 text-primary animate-pulse" />
      <span className="font-semibold text-xs uppercase tracking-wider text-foreground">
        {title}
      </span>
      {containerLabel && (
        <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
          {containerLabel}
        </span>
      )}
    </div>
  );
}
