import { Link } from 'react-router-dom';
import { activityLink, activitySummary } from '../api/activitySummary';
import type { AuditLogEntry } from '../api/types';

/** One audit row as a readable sentence, linked to its home where one
 * exists (activity plan-back F6). Shared by the dashboard card and the
 * Activity page. */
export default function ActivitySentence({ entry }: { entry: AuditLogEntry }) {
  const link = activityLink(entry);
  const text = activitySummary(entry);
  return link ? <Link to={link}>{text}</Link> : <>{text}</>;
}
