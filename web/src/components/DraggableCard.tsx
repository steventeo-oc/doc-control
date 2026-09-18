import React from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, EyeOff, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export interface DraggableCardProps {
  id: string;
  title: string;
  containerIndex: number;
  itemIndex: number;
  totalInContainer: number;
  isCustomizing: boolean;
  isDragging?: boolean;
  onMoveDirection: (id: string, dir: 'left' | 'right' | 'up' | 'down') => void;
  onHide?: (id: string) => void;
  onStartPointerDrag: (id: string, e: React.PointerEvent) => void;
  children: React.ReactNode;
}

/**
 * DraggableCard wraps any dashboard or system card with:
 * - A high-performance pointer grab handle
 * - Quick accessible keyboard/click directional buttons (←, ↑, ↓, →)
 * - Visibility toggle (Hide)
 * - Automatic interaction shielding while in customizing mode
 */
export function DraggableCard({
  id,
  title,
  containerIndex,
  itemIndex,
  totalInContainer,
  isCustomizing,
  isDragging,
  onMoveDirection,
  onHide,
  onStartPointerDrag,
  children,
}: DraggableCardProps) {
  return (
    <div
      data-drag-item={id}
      data-container={containerIndex}
      className={cn(
        'group/card relative transition-all duration-200',
        isCustomizing &&
          'rounded-2xl p-1.5 ring-1 ring-border/70 bg-card/60 shadow-xs hover:ring-primary/40',
        isDragging && 'opacity-25 ring-2 ring-dashed ring-primary scale-[0.98]',
      )}
    >
      {isCustomizing && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-muted/95 px-3 py-1.5 text-xs text-muted-foreground border border-border/60 select-none shadow-xs">
          {/* Drag Handle */}
          <div
            className="flex items-center gap-1.5 text-foreground/80 hover:text-foreground cursor-grab active:cursor-grabbing touch-none py-1 px-1 -ml-1 rounded-md hover:bg-accent/60 transition-colors"
            onPointerDown={(e) => onStartPointerDrag(id, e)}
            title="Drag to reposition card"
          >
            <GripVertical className="size-4 text-primary" />
            <span className="font-semibold text-[11px] uppercase tracking-wider text-foreground">
              {title}
            </span>
          </div>

          {/* Directional Arrows & Hide button */}
          <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={containerIndex === 0}
              onClick={() => onMoveDirection(id, 'left')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card left"
            >
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={itemIndex === 0}
              onClick={() => onMoveDirection(id, 'up')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card up"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={itemIndex === totalInContainer - 1}
              onClick={() => onMoveDirection(id, 'down')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card down"
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={containerIndex === 2}
              onClick={() => onMoveDirection(id, 'right')}
              className="size-7 p-0 hover:bg-accent"
              title="Move card right"
            >
              <ArrowRight className="size-3.5" />
            </Button>
            {onHide && (
              <>
                <div className="mx-1 h-3 w-px bg-border/60" />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onHide(id)}
                  className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Hide this card"
                >
                  <EyeOff className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <div className={cn(isCustomizing && 'pointer-events-none select-none')}>{children}</div>
    </div>
  );
}
