"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { RSVPEngine, type RSVPResult } from "@/lib/rsvp-engine";
import { RSVPDisplay } from "@/components/rsvp/RSVPDisplay";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import type { Passage } from "@/types";
import {
  Play,
  Square,
  Pause,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
} from "lucide-react";

const DEFAULT_PASSAGES = [
  {
    id: "demo-1",
    title: "The Art of Reading",
    content:
      "Reading is one of the most fundamental skills a person can develop. It opens doors to knowledge, imagination, and understanding. Throughout history, the ability to read has been a gateway to power and enlightenment. From ancient scrolls to modern screens, the written word has shaped civilizations and transformed lives. Speed reading takes this ancient skill and supercharges it, allowing you to consume information at rates that would have seemed impossible just decades ago. The key lies in training your brain to process words more efficiently, reducing subvocalization, and expanding your visual span. With practice, anyone can dramatically increase their reading speed while maintaining or even improving comprehension. The journey begins with a single word, displayed one at a time, right before your eyes.",
    wordCount: 0,
    category: "General",
    isDefault: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "demo-2",
    title: "Technology and the Future",
    content:
      "Artificial intelligence is rapidly transforming every aspect of our daily lives. From voice assistants that understand natural language to self-driving cars navigating complex urban environments, the boundaries of what machines can achieve continue to expand. Machine learning algorithms now diagnose diseases, compose music, write code, and even create visual art that rivals human creativity. The pace of innovation shows no signs of slowing down. Quantum computing promises to solve problems that would take classical computers millions of years. Biotechnology is unlocking the secrets of genetic code, offering hope for curing previously untreatable conditions. Space exploration is entering a new golden age, with private companies making the cosmos more accessible than ever before. These technologies converge and amplify each other, creating possibilities that were pure science fiction just a generation ago.",
    wordCount: 0,
    category: "Technology",
    isDefault: true,
    userId: null,
    createdAt: "",
  },
  {
    id: "demo-3",
    title: "Nature's Wonders",
    content:
      "The natural world is filled with extraordinary phenomena that continue to astound scientists and casual observers alike. Deep beneath the ocean surface, bioluminescent creatures create their own light shows in the eternal darkness. Forests communicate through vast underground networks of fungi, sharing nutrients and warning signals across great distances. Birds navigate thousands of miles during migration using the Earth's magnetic field as their compass. Flowers have evolved intricate relationships with specific pollinators, creating partnerships that span millions of years. The resilience of life in extreme environments, from boiling hot springs to frozen Antarctic lakes, demonstrates the remarkable adaptability of biological systems. Each ecosystem represents a delicate balance of countless interactions, a web of life so complex that we are only beginning to understand its true depth and beauty.",
    wordCount: 0,
    category: "Nature",
    isDefault: true,
    userId: null,
    createdAt: "",
  },
];

export default function ReaderPage() {
  const { user } = useAuth();
  const engineRef = useRef<RSVPEngine | null>(null);

  // State
  const [passages, setPassages] = useState<Passage[]>(DEFAULT_PASSAGES);
  const [selectedPassageId, setSelectedPassageId] = useState(
    DEFAULT_PASSAGES[0].id
  );
  const [customText, setCustomText] = useState("");
  const [useCustomText, setUseCustomText] = useState(false);

  const [currentWord, setCurrentWord] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [wpm, setWpm] = useState(200);
  const [progress, setProgress] = useState(0);
  const [wordIndex, setWordIndex] = useState(0);
  const [totalWords, setTotalWords] = useState(0);

  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<RSVPResult | null>(null);

  // Load passages from API
  useEffect(() => {
    if (user) {
      api
        .get("/passages")
        .then(({ data }) => {
          if (data.passages && data.passages.length > 0) {
            setPassages(data.passages);
            setSelectedPassageId(data.passages[0].id);
          }
        })
        .catch(() => {
          // use defaults
        });
    }
  }, [user]);

  const getWords = useCallback(() => {
    if (useCustomText) {
      return customText.split(/\s+/).filter((w) => w.length > 0);
    }
    const passage = passages.find((p) => p.id === selectedPassageId);
    if (!passage) return [];
    return passage.content.split(/\s+/).filter((w) => w.length > 0);
  }, [useCustomText, customText, passages, selectedPassageId]);

  const handleStart = useCallback(() => {
    const words = getWords();
    if (words.length === 0) return;

    // Cleanup previous engine
    if (engineRef.current) {
      engineRef.current.destroy();
    }

    const engine = new RSVPEngine(words, {
      startWpm: 200,
      increment: 25,
      intervalSec: 30,
    });

    engine.onWord = (word, index, total) => {
      setCurrentWord(word);
      setWordIndex(index + 1);
      setTotalWords(total);
      setProgress((index + 1) / total);
    };

    engine.onWpmChange = (newWpm) => {
      setWpm(newWpm);
    };

    engine.onPauseChange = (paused) => {
      setIsPaused(paused);
    };

    engine.onFinish = (res) => {
      setResult(res);
      setShowResult(true);
      setIsRunning(false);
      setIsPaused(false);
      setCurrentWord(null);

      // Save session to API
      if (user) {
        const passageId = useCustomText ? null : selectedPassageId;
        api
          .post("/sessions", {
            passageId,
            startWpm: res.startWpm,
            endWpm: res.endWpm,
            wpmIncrement: res.wpmIncrement,
            incrementIntervalSec: res.incrementIntervalSec,
            totalWordsRead: res.totalWordsRead,
            durationSec: res.durationSec,
            stoppedByUser: res.stoppedByUser,
          })
          .catch(() => {
            // silently fail
          });
      }
    };

    engineRef.current = engine;
    setIsRunning(true);
    setIsPaused(false);
    setShowResult(false);
    setResult(null);
    setWpm(200);
    engine.start();
  }, [getWords, user, useCustomText, selectedPassageId]);

  const handlePauseToggle = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleStop = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const handleSpeedUp = useCallback(() => {
    engineRef.current?.increaseWpm(25);
  }, []);

  const handleSlowDown = useCallback(() => {
    engineRef.current?.decreaseWpm(25);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isRunning) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          handlePauseToggle();
          break;
        case "Escape":
          e.preventDefault();
          handleStop();
          break;
        case "ArrowUp":
          e.preventDefault();
          handleSpeedUp();
          break;
        case "ArrowDown":
          e.preventDefault();
          handleSlowDown();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, handlePauseToggle, handleStop, handleSpeedUp, handleSlowDown]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.destroy();
    };
  }, []);

  const selectedPassage = passages.find((p) => p.id === selectedPassageId);

  // ─── Fullscreen Reading Mode ──────────────────────────────────
  if (isRunning) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {/* Top bar: progress */}
        <div className="w-full h-1 bg-white/10">
          <div
            className="h-full bg-primary transition-all duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Center: word display */}
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="w-full max-w-4xl">
            <RSVPDisplay word={currentWord} isActive={true} />
          </div>
        </div>

        {/* Bottom controls */}
        <div className="pb-8 pt-4 px-4">
          <div className="max-w-lg mx-auto flex flex-col items-center gap-4">
            {/* Word count */}
            <div className="text-white/40 text-sm font-mono">
              {wordIndex} / {totalWords}
            </div>

            {/* Main controls row */}
            <div className="flex items-center gap-6">
              {/* Slow down */}
              <button
                onClick={handleSlowDown}
                className="flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors"
                title="Decrease speed (↓)"
              >
                <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center hover:border-white/40 transition-colors">
                  <Minus className="w-5 h-5" />
                </div>
                <span className="text-[10px] uppercase tracking-wider">
                  Slower
                </span>
              </button>

              {/* Pause / Resume */}
              <button
                onClick={handlePauseToggle}
                className="flex flex-col items-center gap-1 text-white hover:text-primary transition-colors"
                title="Pause/Resume (Space)"
              >
                <div className="w-14 h-14 rounded-full border-2 border-white/30 flex items-center justify-center hover:border-primary transition-colors">
                  {isPaused ? (
                    <Play className="w-6 h-6 ml-0.5" />
                  ) : (
                    <Pause className="w-6 h-6" />
                  )}
                </div>
                <span className="text-[10px] uppercase tracking-wider">
                  {isPaused ? "Resume" : "Pause"}
                </span>
              </button>

              {/* WPM display */}
              <div className="flex flex-col items-center mx-2">
                <span className="text-3xl font-bold text-primary font-mono">
                  {wpm}
                </span>
                <span className="text-[10px] text-white/40 uppercase tracking-widest">
                  WPM
                </span>
              </div>

              {/* Speed up */}
              <button
                onClick={handleSpeedUp}
                className="flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors"
                title="Increase speed (↑)"
              >
                <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center hover:border-white/40 transition-colors">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="text-[10px] uppercase tracking-wider">
                  Faster
                </span>
              </button>

              {/* Stop */}
              <button
                onClick={handleStop}
                className="flex flex-col items-center gap-1 text-white/60 hover:text-red-400 transition-colors"
                title="Stop (Esc)"
              >
                <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center hover:border-red-400/60 transition-colors">
                  <Square className="w-5 h-5" />
                </div>
                <span className="text-[10px] uppercase tracking-wider">
                  Stop
                </span>
              </button>
            </div>

            {/* Keyboard hints */}
            <div className="flex gap-4 text-[10px] text-white/25">
              <span>
                <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">
                  Space
                </kbd>{" "}
                Pause
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">
                  ↑
                </kbd>{" "}
                <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">
                  ↓
                </kbd>{" "}
                Speed
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono">
                  Esc
                </kbd>{" "}
                Stop
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Setup / Result view ──────────────────────────────────────
  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-3xl space-y-8">
        <h1 className="text-3xl font-bold text-center">RSVP Reader</h1>

        {/* Result screen */}
        {showResult && result ? (
          <div className="rounded-xl bg-card border border-border p-8 space-y-6">
            <h2 className="text-2xl font-bold text-center">Session Complete</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 rounded-lg bg-secondary">
                <div className="text-2xl font-bold text-primary">
                  {result.endWpm}
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  Max WPM
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-secondary">
                <div className="text-2xl font-bold text-primary">
                  {result.totalWordsRead}
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  Words Read
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-secondary">
                <div className="text-2xl font-bold text-primary">
                  {result.durationSec}s
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  Duration
                </div>
              </div>
              <div className="text-center p-4 rounded-lg bg-secondary">
                <div className="text-2xl font-bold text-accent">
                  {result.stoppedByUser ? "Stopped" : "Finished"}
                </div>
                <div className="text-xs text-muted-foreground uppercase">
                  Status
                </div>
              </div>
            </div>
            {!user && (
              <p className="text-center text-sm text-muted-foreground">
                <a href="/register" className="text-primary underline">
                  Sign up
                </a>{" "}
                to save your results and track your progress!
              </p>
            )}
            <div className="flex justify-center">
              <button
                onClick={() => setShowResult(false)}
                className="px-6 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        ) : (
          /* Passage Selection */
          <div className="space-y-6">
            {/* Toggle between preset and custom */}
            <div className="flex gap-2">
              <button
                onClick={() => setUseCustomText(false)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  !useCustomText
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                Choose Passage
              </button>
              <button
                onClick={() => setUseCustomText(true)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  useCustomText
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                }`}
              >
                Paste Your Own
              </button>
            </div>

            {useCustomText ? (
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Paste your text here (minimum 20 words)..."
                className="w-full h-40 p-4 rounded-lg bg-card border border-border text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <div className="space-y-2">
                <select
                  value={selectedPassageId}
                  onChange={(e) => setSelectedPassageId(e.target.value)}
                  className="w-full p-3 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {passages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.category})
                    </option>
                  ))}
                </select>
                {selectedPassage && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {selectedPassage.content.slice(0, 200)}...
                  </p>
                )}
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              Words:{" "}
              {useCustomText
                ? customText.split(/\s+/).filter((w) => w.length > 0).length
                : selectedPassage?.content
                    .split(/\s+/)
                    .filter((w) => w.length > 0).length || 0}
              &nbsp;| Starting Speed: 200 WPM | +25 WPM every 30s
            </div>

            {/* Big Start Button */}
            <div className="flex justify-center pt-4">
              <button
                onClick={handleStart}
                className="flex items-center gap-3 px-10 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-xl hover:bg-primary/90 transition-all hover:scale-105 active:scale-100"
              >
                <Play className="w-6 h-6" />
                Start Reading
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
