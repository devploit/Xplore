import { useEffect, useRef, useState } from "preact/hooks";

const DURATION_MS = 350;

/** Tweens from the previous value to the new one so a period change reads as motion, not a jump. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    if (begin === value) return;
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      const current = begin + (value - begin) * eased;
      setShown(current);
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span>{format(shown)}</span>;
}
