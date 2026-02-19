"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { GrowthChart } from "@/components/dashboard/GrowthChart";
import { StatsCards } from "@/components/dashboard/StatsCards";
import type { Session, SessionStats } from "@/types";

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async () => {
      try {
        const [statsRes, sessionsRes] = await Promise.all([
          api.get("/sessions/stats"),
          api.get("/sessions"),
        ]);
        setStats(statsRes.data);
        setSessions(sessionsRes.data.sessions || []);
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (authLoading || !user) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Track your reading speed progress over time
          </p>
        </div>

        {/* Stats Cards */}
        <div className="animate-fade-in-up delay-100">
          <StatsCards
            totalSessions={stats?.totalSessions || 0}
            totalWordsRead={stats?.totalWordsRead || 0}
            bestWpm={stats?.bestWpm || 0}
            averageWpm={stats?.averageWpm || 0}
          />
        </div>

        {/* Growth Chart */}
        <div className="animate-fade-in-up delay-200 glow-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">WPM Growth Over Time</h2>
          <GrowthChart data={stats?.wpmOverTime || []} />
        </div>

        {/* Session History Table */}
        <div className="animate-fade-in-up delay-300 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60">
            <h2 className="text-lg font-semibold">Session History</h2>
          </div>
          {sessions.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No sessions yet. Head to the{" "}
              <a href="/reader" className="text-primary hover:underline">
                Reader
              </a>{" "}
              to start!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Passage
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Start
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      End
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Words
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Time
                    </th>
                    <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="p-4 text-muted-foreground">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {session.passageTitle || "Custom text"}
                      </td>
                      <td className="p-4 text-right font-mono">{session.startWpm}</td>
                      <td className="p-4 text-right font-mono font-semibold text-primary">
                        {session.endWpm}
                      </td>
                      <td className="p-4 text-right font-mono">
                        {session.totalWordsRead}
                      </td>
                      <td className="p-4 text-right font-mono">{session.durationSec}s</td>
                      <td className="p-4 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            session.stoppedByUser
                              ? "bg-accent/10 text-accent"
                              : "bg-green-500/10 text-green-400"
                          }`}
                        >
                          {session.stoppedByUser ? "Stopped" : "Complete"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
