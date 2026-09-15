import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  message,
  cta,
}: {
  icon: LucideIcon;
  message: ReactNode;
  cta?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1 text-sm text-muted-foreground">
      <Icon className="mt-px size-5 shrink-0 opacity-75" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <span>{message}</span>
        {cta}
      </div>
    </div>
  );
}
