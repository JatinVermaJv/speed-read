"use client";

import { Pause, Play, Square } from "lucide-react";

interface RSVPControlsProps {
  isRunning: boolean;
  isPaused: boolean;
  wpm: number;
  progress: number;
  wordIndex: number;
  totalWords: number;
  onStart: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
}

export function RSVPControls({
  isRunning,
  isPaused,
  wpm,
  progress,
  wordIndex,
  totalWords,
  onStart,
  onPauseToggle,
  onStop,
}: RSVPControlsProps) {
  return (
    <div className="space-y-4">
      {/* Progress bar */}
      {isRunning && (
        <div className="w-full">
          <div className="flex justify-between text-sm text-muted-foreground mb-1">
            <span>
              {wordIndex} / {totalWords} words
            </span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-200 rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        {!isRunning ? (
          <button
            onClick={onStart}
            className="flex items-center gap-2 px-8 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-colors"
          >
            <Play className="w-5 h-5" />
            Start
          </button>
        ) : (
          <>
            <button
              onClick={onPauseToggle}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-secondary text-secondary-foreground font-semibold hover:bg-secondary/80 transition-colors"
            >
              {isPaused ? (
                <>
                  <Play className="w-5 h-5" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-5 h-5" />
                  Pause
                </>
              )}
            </button>
            <button
              onClick={onStop}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 transition-colors"
            >
              <Square className="w-5 h-5" />
              Stop
            </button>
          </>
        )}

        {/* WPM Display */}
        {isRunning && (
          <div className="flex flex-col items-center ml-4 px-4 py-2 rounded-lg bg-card border border-border">
            <span className="text-2xl font-bold text-primary">{wpm}</span>
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              WPM
            </span>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="text-center text-xs text-muted-foreground">
        <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">
          Space
        </span>{" "}
        Pause/Resume &nbsp;
        <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-mono">
          Esc
        </span>{" "}
        Stop
      </div>
    </div>
  );
}
