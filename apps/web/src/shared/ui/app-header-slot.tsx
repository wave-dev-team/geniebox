'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { createPortal } from 'react-dom';

export const AppHeaderTarget = createContext<HTMLElement | null>(null);

export function AppHeaderSlot({ children }: { children: ReactNode }) {
  const target = useContext(AppHeaderTarget);
  return target ? createPortal(children, target) : null;
}
