import * as React from 'react';

/** Seconds left until a resend becomes possible; `start` restarts the countdown. */
export function useCountdown(seconds: number) {
  const [left, setLeft] = React.useState(0);

  React.useEffect(() => {
    if (left <= 0) {
      return;
    }
    const timer = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return { left, start: React.useCallback(() => setLeft(seconds), [seconds]) };
}
