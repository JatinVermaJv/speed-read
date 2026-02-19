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
    <div className="min-h-[calc(100vh-64px)] px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Track your reading speed progress over time
          </p>
        </div>

        {/* Stats Cards */}
        <StatsCards
          totalSessions={stats?.totalSessions || 0}
          totalWordsRead={stats?.totalWordsRead || 0}
          bestWpm={stats?.bestWpm || 0}
          averageWpm={stats?.averageWpm || 0}
        />

        {/* Growth Chart */}
        <div className="rounded-xl bg-card border border-border p-6">
          <h2 className="text-lg font-semibold mb-4">WPM Growth Over Time</h2>
          <GrowthChart data={stats?.wpmOverTime || []} />
        </div>

        {/* Session History Table */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-semibold">Session History</h2>
          </div>
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No sessions yet. Head to the{" "}
              <a href="/reader" className="text-primary underline">
                Reader
              </a>{" "}
              to start!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-4 text-muted-foreground font-medium">
                      Date
                    </th>
                    <th className="text-left p-4 text-muted-foreground font-medium">
                      Passage
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium">
                      Start WPM
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium">
                      End WPM
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium">
                      Words
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium">
                      Duration
                    </th>
                    <th className="text-center p-4 text-muted-foreground font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="border-b border-border last:border-0 hover:bg-secondary/30"
                    >
                      <td className="p-4">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {session.passageTitle || "Custom text"}
                      </td>
                      <td className="p-4 text-right">{session.startWpm}</td>
                      <td className="p-4 text-right font-semibold text-primary">
                        {session.endWpm}
                      </td>
                      <td className="p-4 text-right">
                        {session.totalWordsRead}
                      </td>
                      <td className="p-4 text-right">{session.durationSec}s</td>
                      <td className="p-4 text-center">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            session.stoppedByUser
                              ? "bg-accent/10 text-accent"
                              : "bg-green-500/10 text-green-500"
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
