import { createContext, useContext, useEffect, type ReactNode } from 'react';

/**
 * Lets a page supply the content for Layout's chrome-level section sidebar dynamically, instead of the fixed link
 * list `Layout.tsx`'s own `sections` map drives every other section with (Documents' All/Mine/Trash, Tasks' panes,
 * and so on). Only the Assistant page uses this today -- its sidebar is a per-user list of saved conversations,
 * not a fixed set of links, so it can't be expressed as a `SectionItem[]`. Layout owns the state and provides the
 * setter; `useSectionSidebar` is how a page calls it, so Layout never needs to know anything assistant-specific.
 */
export const SectionSidebarContext = createContext<(node: ReactNode) => void>(() => {});

/**
 * Renders `node` inside Layout's desktop section sidebar -- the bordered column flush against the nav rail that
 * Documents/Tasks/Departments/Activity/Admin all use -- for as long as the calling page is mounted. Clears itself
 * on unmount (the standard cleanup for a context-based "slot"), so navigating away never leaves a stale sidebar
 * showing under a different section.
 */
export function useSectionSidebar(node: ReactNode) {
  const setSidebar = useContext(SectionSidebarContext);
  useEffect(() => {
    setSidebar(node);
    return () => setSidebar(null);
  }, [setSidebar, node]);
}
