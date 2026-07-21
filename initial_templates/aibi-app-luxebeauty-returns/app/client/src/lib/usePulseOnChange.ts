import { useEffect, useRef, useState } from 'react';

/**
 * Diff-aware visual pulse for the agent → UI cascade.
 *
 * When the agent's write tool fires `dataMutated` and a subscribing surface
 * refetches, *individual* values (a KPI count, a row's status, a city bubble's
 * size) may have changed. This hook compares prev vs next and flips a boolean
 * to `true` for `durationMs` whenever the value actually changes — so the
 * consumer can add a one-shot CSS class (`animate-pulse-ring`, etc.) only
 * on the things that moved.
 *
 * That keeps the live cascade specific: the eye lands on what the agent
 * just changed, not on every panel flashing in unison.
 *
 * Usage:
 *   const pulse = usePulseOnChange(count);
 *   <div className={pulse ? 'animate-pulse-ring' : ''} />
 *
 * On first mount, pulse stays false (we don't want the page to flash just
 * because data arrived). `eq` defaults to `Object.is`.
 */
export function usePulseOnChange<T>(
  value: T,
  opts: { durationMs?: number; eq?: (a: T, b: T) => boolean } = {},
): boolean {
  const duration = opts.durationMs ?? 1500;
  const eq = opts.eq ?? Object.is;
  const prev = useRef<T>(value);
  const initialized = useRef(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      prev.current = value;
      return;
    }
    if (eq(prev.current, value)) return;
    prev.current = value;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), duration);
    return () => clearTimeout(t);
  }, [value, duration, eq]);

  return pulse;
}
