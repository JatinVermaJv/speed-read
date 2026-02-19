"use client";

import { computeFocus } from "@/lib/focus-char";

interface RSVPDisplayProps {
  word: string | null;
  isActive: boolean;
}

export function RSVPDisplay({ word, isActive }: RSVPDisplayProps) {
  if (!word || !isActive) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="text-muted-foreground text-2xl">
          {isActive ? "" : "Press Start to begin"}
        </span>
      </div>
    );
  }

  const { before, focus, after } = computeFocus(word);

  return (
    <div className="flex items-center justify-center h-48 select-none">
      {/*
        Fixed-center layout: the focus character is always pinned to the
        exact horizontal center of the container.  "before" grows to the
        left, "after" grows to the right.
      */}
      <div className="relative w-full h-full flex items-center justify-center">
        {/* Top tick mark at center */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-accent/40" />
        {/* Bottom tick mark at center */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-accent/40" />

        {/* Word container — uses CSS grid so the focus col is always at center */}
        <div
          className="font-mono text-5xl md:text-7xl tracking-wider whitespace-nowrap"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "baseline",
          }}
        >
          {/* Before: right-aligned, pushes against the focus char */}
          <span className="text-right text-muted-foreground/80">
            {before}
          </span>

          {/* Focus character: center column, never moves */}
          <span className="text-accent font-bold text-center">{focus}</span>

          {/* After: left-aligned, flows away from focus char */}
          <span className="text-left text-muted-foreground/80">
            {after}
          </span>
        </div>
      </div>
    </div>
  );
}
