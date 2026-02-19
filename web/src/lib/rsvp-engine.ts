/**
 * RSVP (Rapid Serial Visual Presentation) Engine
 *
 * Controls the timing of word display with automatic WPM ramping.
 *
 * Usage:
 *   const engine = new RSVPEngine(words, { startWpm: 200, increment: 25, intervalSec: 30 });
 *   engine.onWord = (word, index) => { ... };
 *   engine.onWpmChange = (wpm) => { ... };
 *   engine.onFinish = (result) => { ... };
 *   engine.start();
 */

export interface RSVPConfig {
  startWpm: number;
  increment: number;
  intervalSec: number;
}

export interface RSVPResult {
  startWpm: number;
  endWpm: number;
  wpmIncrement: number;
  incrementIntervalSec: number;
  totalWordsRead: number;
  durationSec: number;
  stoppedByUser: boolean;
}

export class RSVPEngine {
  private words: string[];
  private config: RSVPConfig;
  private currentIndex = 0;
  private currentWpm: number;
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rampTimer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;

  // Callbacks
  onWord: ((word: string, index: number, total: number) => void) | null = null;
  onWpmChange: ((wpm: number) => void) | null = null;
  onFinish: ((result: RSVPResult) => void) | null = null;
  onPauseChange: ((paused: boolean) => void) | null = null;

  constructor(words: string[], config: RSVPConfig) {
    this.words = words;
    this.config = config;
    this.currentWpm = config.startWpm;
  }

  get wpm() {
    return this.currentWpm;
  }

  get progress() {
    return this.words.length > 0
      ? this.currentIndex / this.words.length
      : 0;
  }

  get wordIndex() {
    return this.currentIndex;
  }

  get totalWords() {
    return this.words.length;
  }

  get isRunning() {
    return this.running;
  }

  get isPaused() {
    return this.paused;
  }

  private get interval() {
    return 60000 / this.currentWpm; // ms per word
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.startTime = Date.now();
    this.currentIndex = 0;
    this.currentWpm = this.config.startWpm;

    // Start WPM ramp timer
    this.rampTimer = setInterval(() => {
      if (!this.paused) {
        this.currentWpm += this.config.increment;
        this.onWpmChange?.(this.currentWpm);
      }
    }, this.config.intervalSec * 1000);

    this.showNext();
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.onPauseChange?.(true);
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.onPauseChange?.(false);
    this.showNext();
  }

  togglePause() {
    if (this.paused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  /**
   * Manually set the current WPM. Clamps to a minimum of 50.
   */
  setWpm(newWpm: number) {
    this.currentWpm = Math.max(50, newWpm);
    this.onWpmChange?.(this.currentWpm);
  }

  /**
   * Increase WPM by a given amount (default: 25).
   */
  increaseWpm(amount = 25) {
    this.setWpm(this.currentWpm + amount);
  }

  /**
   * Decrease WPM by a given amount (default: 25). Won't go below 50.
   */
  decreaseWpm(amount = 25) {
    this.setWpm(this.currentWpm - amount);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.paused = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.rampTimer) {
      clearInterval(this.rampTimer);
      this.rampTimer = null;
    }

    const durationSec = (Date.now() - this.startTime) / 1000;

    this.onFinish?.({
      startWpm: this.config.startWpm,
      endWpm: this.currentWpm,
      wpmIncrement: this.config.increment,
      incrementIntervalSec: this.config.intervalSec,
      totalWordsRead: this.currentIndex,
      durationSec: Math.round(durationSec),
      stoppedByUser: this.currentIndex < this.words.length,
    });
  }

  private showNext() {
    if (!this.running || this.paused) return;

    if (this.currentIndex >= this.words.length) {
      this.stop();
      return;
    }

    const word = this.words[this.currentIndex];
    this.onWord?.(word, this.currentIndex, this.words.length);
    this.currentIndex++;

    this.timer = setTimeout(() => this.showNext(), this.interval);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    if (this.rampTimer) clearInterval(this.rampTimer);
    this.running = false;
    this.paused = false;
    this.onWord = null;
    this.onWpmChange = null;
    this.onFinish = null;
    this.onPauseChange = null;
  }
}
