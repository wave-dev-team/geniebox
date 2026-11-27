'use client';

import * as React from 'react';

import { cn } from '@workspace/ui/lib/utils';

/** Time constant of the reveal: the backlog shrinks by ~63% every TAU ms. */
const TAU_STREAMING_MS = 160;
const TAU_DONE_MS = 60;

/**
 * Reveals text that grows in bursts (stream deltas arrive every ~120 ms) at an even pace on
 * animation frames. Text present on mount is shown at once; only what arrives later is animated.
 * A text that is not a continuation (replaced by the final one) is shown as is.
 */
export function useSmoothText(target: string, streaming: boolean): { text: string; done: boolean } {
  const [length, setLength] = React.useState(target.length);
  const shown = React.useRef({ text: target, length: target.length });

  React.useEffect(() => {
    const current = shown.current;
    if (!target.startsWith(current.text.slice(0, current.length))) {
      shown.current = { text: target, length: target.length };
      setLength(target.length);
      return;
    }
    shown.current = { text: target, length: current.length };
    if (current.length >= target.length) return;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const state = shown.current;
      const backlog = state.text.length - state.length;
      if (backlog <= 0) return;
      const dt = Math.min(now - last, 100);
      last = now;
      const tau = streaming ? TAU_STREAMING_MS : TAU_DONE_MS;
      let next = state.length + Math.max(1, Math.round(backlog * (1 - Math.exp(-dt / tau))));
      next = Math.min(next, state.text.length);
      // Do not cut a surrogate pair (emoji) in half.
      const code = state.text.charCodeAt(next - 1);
      if (code >= 0xd800 && code <= 0xdbff && next < state.text.length) next += 1;
      state.length = next;
      setLength(next);
      if (next < state.text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, streaming]);

  const visible = Math.min(length, target.length);
  return { text: target.slice(0, visible), done: visible >= target.length };
}

export function StreamingText({
  text,
  streaming,
  className,
  waiting,
}: {
  text: string;
  streaming: boolean;
  className?: string;
  waiting: string;
}) {
  const smooth = useSmoothText(text, streaming);
  if (streaming && !text) {
    return (
      <p role="status" className={cn(className, 'animate-pulse text-sm text-muted-foreground')}>
        {waiting}
      </p>
    );
  }
  if (!text) return null;
  return (
    <p className={className}>
      {smooth.text}
      {streaming || !smooth.done ? (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
      ) : null}
    </p>
  );
}
