"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query. The server snapshot is `serverDefault`, so
 * the first client render matches the server and updates right after mount.
 */
export function useMediaQuery(query: string, serverDefault = true): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Run settings sit beside the feed from 1200px (`--breakpoint-wide`). */
export const WIDE_QUERY = "(min-width: 75rem)";
/** The sidebar is inline from 860px (`--breakpoint-nav`). */
export const NAV_QUERY = "(min-width: 53.75rem)";
