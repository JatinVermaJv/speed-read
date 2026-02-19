import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] px-4">
      <div className="max-w-3xl text-center space-y-8">
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight">
          Read <span className="text-primary">Faster</span>,{" "}
          <span className="text-accent">Smarter</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-xl mx-auto">
          Train your reading speed using Rapid Serial Visual Presentation
          (RSVP). Watch your WPM grow over time with data-driven insights.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/reader"
            className="px-8 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-lg hover:bg-primary/90 transition-colors"
          >
            Start Reading
          </Link>
          <Link
            href="/dashboard"
            className="px-8 py-3 rounded-lg border border-border text-foreground font-semibold text-lg hover:bg-secondary transition-colors"
          >
            View Progress
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="text-3xl font-bold text-primary mb-2">RSVP</div>
            <p className="text-muted-foreground text-sm">
              Words flash one at a time with an optimal focus point, eliminating
              eye movement and boosting comprehension.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="text-3xl font-bold text-accent mb-2">200+</div>
            <p className="text-muted-foreground text-sm">
              Start at 200 WPM and gradually increase your speed. The system
              auto-ramps to push your limits.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border">
            <div className="text-3xl font-bold text-primary mb-2">Track</div>
            <p className="text-muted-foreground text-sm">
              Every session is saved. Visualize your growth with charts and
              detailed statistics over time.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
