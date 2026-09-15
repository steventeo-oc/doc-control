import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

export type StatusBadgeKind =
  | 'released' | 'approved' | 'current'
  | 'draft'
  | 'in_review'
  | 'superseded' | 'obsolete'
  | 'reapproval'
  | 'overdue'
  | 'kind-approval' | 'kind-acknowledgment'
  | 'dept';

const STATUS_CLASSES: Record<Exclude<StatusBadgeKind, 'dept'>, string> = {
  released: 'bg-success/15 text-success',
  approved: 'bg-success/15 text-success',
  current: 'bg-success/15 text-success',
  draft: 'bg-warning/15 text-warning',
  in_review: 'bg-info/15 text-info',
  superseded: 'bg-destructive/10 text-destructive/70',
  obsolete: 'bg-destructive/10 text-destructive/70',
  reapproval: 'bg-violet-100 text-violet-700',
  overdue: 'bg-destructive/15 text-destructive',
  'kind-approval': 'bg-info/15 text-info',
  'kind-acknowledgment': 'bg-success/15 text-success',
};

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: StatusBadgeKind;
  children: ReactNode;
  className?: string;
}) {
  if (status === 'dept') {
    return (
      <Badge variant="outline" className={cn(className)}>
        {children}
      </Badge>
    );
  }
  return (
    <Badge className={cn(STATUS_CLASSES[status], 'border-transparent', className)}>
      {children}
    </Badge>
  );
}
