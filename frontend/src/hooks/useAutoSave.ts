"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { createAutoSaveController, normalizeAutoSaveInterval } from "@/lib/autoSave";

const ENABLED_KEY = "evacstudio_autosave_enabled";
const INTERVAL_KEY = "evacstudio_autosave_interval";
const PREFERENCES_EVENT = "evacstudio-autosave-preferences";

function readPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(PREFERENCES_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PREFERENCES_EVENT, callback);
  };
}

export function useAutoSave({
  scope,
  blocked,
  isDirty,
  onSave,
}: {
  scope: string;
  blocked: boolean;
  isDirty: () => boolean;
  onSave: () => Promise<unknown>;
}) {
  // A stable server snapshot avoids reading browser preferences during SSR.
  const storedEnabled = useSyncExternalStore(subscribe, () => readPreference(ENABLED_KEY), () => null);
  const storedInterval = useSyncExternalStore(subscribe, () => readPreference(INTERVAL_KEY), () => null);
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const [intervalOverride, setIntervalOverride] = useState<number | null>(null);
  const enabled = enabledOverride ?? storedEnabled !== "false";
  const interval = intervalOverride ?? normalizeAutoSaveInterval(storedInterval);
  const [countdown, setCountdown] = useState({ scope, interval, seconds: interval });

  const persist = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
      window.dispatchEvent(new Event(PREFERENCES_EVENT));
    } catch {
      // Preferences still work in this editor when browser storage is unavailable.
    }
  };

  // Effect Events always read the latest committed editor state, including changes
  // to the legend, template, eraser and visibility, without restarting the clock.
  const readState = useEffectEvent(() => ({ dirty: isDirty(), blocked }));
  const save = useEffectEvent(async () => {
    try {
      return await onSave();
    } catch (error) {
      console.error("Auto-save failed:", error);
      return null;
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = createAutoSaveController({
      intervalSeconds: interval,
      readState: () => readState(),
      save: () => save(),
      onCountdown: (seconds) => setCountdown((current) => (
        current.scope === scope && current.interval === interval && current.seconds === seconds
          ? current : { scope, interval, seconds }
      )),
    });
    const timer = window.setInterval(() => void controller.tick(), 250);
    return () => {
      window.clearInterval(timer);
      controller.dispose();
    };
  }, [scope, enabled, interval]);

  return {
    enabled,
    interval,
    secondsUntilNextSave: enabled && countdown.scope === scope && countdown.interval === interval
      ? countdown.seconds : interval,
    setEnabled(value: boolean) {
      setEnabledOverride(value);
      persist(ENABLED_KEY, String(value));
    },
    setInterval(value: number) {
      const normalized = normalizeAutoSaveInterval(value);
      setIntervalOverride(normalized);
      persist(INTERVAL_KEY, String(normalized));
    },
  };
}
