"use client";

import { useSyncExternalStore } from "react";

import type { Language } from "@/lib/lms/types";

// The visitor's chosen display language (English / Malayalam), shared by the
// public About/Founder sections and the student lesson player. Stored only in
// this browser; it never affects enrollment, permissions or what the server
// returns.

const STORAGE_KEY = "swaraanjanam-language";
const listeners = new Set<() => void>();
/** Fallback when storage is unavailable (private mode, blocked site data). */
let memoryValue: Language | null = null;

function read(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ml") return stored;
  } catch {
    // Storage blocked: fall through to the in-memory value.
  }
  return memoryValue ?? "en";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setLanguagePreference(language: Language) {
  memoryValue = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Keep the in-memory value only.
  }
  listeners.forEach((listener) => listener());
}

/** Server render and first hydration use English; the stored choice applies right after. */
export function useLanguagePreference(): [Language, (language: Language) => void] {
  const language = useSyncExternalStore(subscribe, read, () => "en" as const);
  return [language, setLanguagePreference];
}
