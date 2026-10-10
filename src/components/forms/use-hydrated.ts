"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and before hydration, true afterwards.
 * Auth forms keep their submit buttons disabled until then: before hydration
 * a submit would be a plain browser form submission instead of the
 * JavaScript sign-in flow.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
