import Link from "next/link";
import { BookOpen, Gauge, TrendingUp, Zap, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-col items-center min-h-[calc(100vh-64px)]">
      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="flex flex-col items-center justify-center text-center px-4 pt-6 pb-20 md:pt-10 md:pb-28 max-w-4xl mx-auto">
        {/* Badge */}
        <div className="animate-fade-in-up mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary animate-pulse-soft">
          <Zap className="w-3 h-3" />
          Train your brain to read 3x faster
        </div>

        <h1 className="animate-fade-in-up delay-100 text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.08]">
          Read{" "}
          <span className="text-gradient">Faster</span>,{" "}
          <br className="hidden sm:block" />
          Understand{" "}
          <span className="text-gradient">More</span>
        </h1>

        <p className="animate-fade-in-up delay-200 mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
          Speed-Read uses <strong className="text-foreground">RSVP</strong>{" "}
          (Rapid Serial Visual Presentation) to eliminate eye movement and
          subvocalization — training you to absorb text at rates you never
          thought possible.
        </p>

        <div className="animate-fade-in-up delay-300 flex flex-col sm:flex-row gap-4 mt-10">
          <Link
            href="/reader"
            className="group inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-lg shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:brightness-110 transition-all"
          >
            Start Reading
            <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-border text-foreground font-semibold text-lg hover:bg-white/5 transition-colors"
          >
            View Progress
          </Link>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────── */}
      <section className="w-full px-4 pb-24">
        <div className="max-w-5xl mx-auto">
          <h2 className="animate-fade-in-up text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-12">
            How it works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="animate-fade-in-up delay-100 glow-card rounded-2xl p-8 flex flex-col items-start">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                <BookOpen className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">RSVP Technique</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Words flash one at a time at a calculated focus point,
                eliminating saccadic eye movement and dramatically boosting your
                intake speed.
              </p>
            </div>

            {/* Card 2 */}
            <div className="animate-fade-in-up delay-200 glow-card rounded-2xl p-8 flex flex-col items-start">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-5">
                <Gauge className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Auto Speed Ramp</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Start at 200 WPM and let the system gradually push your limits.
                Speed increases every 30 seconds so you keep improving
                naturally.
              </p>
            </div>

            {/* Card 3 */}
            <div className="animate-fade-in-up delay-300 glow-card rounded-2xl p-8 flex flex-col items-start">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Track Growth</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Every session is saved. Charts and detailed stats let you
                visualize your reading speed trajectory and celebrate
                milestones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer tagline ──────────────────────────────────────── */}
      <footer className="w-full border-t border-border py-8 text-center text-xs text-muted-foreground">
        Built for readers who refuse to be slow.
      </footer>
    </div>
  );
}
