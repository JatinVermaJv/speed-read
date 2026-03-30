"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import type { Session, UnseenAttemptLog } from "@/types";

function formatDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;

  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }

  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatAttemptStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [unseenLogs, setUnseenLogs] = useState<UnseenAttemptLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user) return;

    const fetchLogs = async () => {
      const [sessionsResult, unseenResult] = await Promise.allSettled([
        api.get("/sessions"),
        api.get("/unseen/attempts"),
      ]);

      try {
        if (sessionsResult.status === "fulfilled") {
          setSessions(sessionsResult.value.data.sessions || []);
        } else {
          setSessions([]);
        }

        if (unseenResult.status === "fulfilled") {
          setUnseenLogs(unseenResult.value.data.attempts || []);
        } else {
          setUnseenLogs([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
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
          <h1 className="text-3xl font-extrabold tracking-tight">Logs Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            All your logs in one place, separated by Reader and Unseen
          </p>
        </div>

        <div className="animate-fade-in-up delay-100 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60">
            <h2 className="text-lg font-semibold">Reader Logs</h2>
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
                      Passage
                    </th>
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr
                      key={session.id}
                      className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="p-4 text-muted-foreground max-w-[380px] truncate">
                        {session.passageTitle || "Custom text"}
                      </td>
                      <td className="p-4 text-muted-foreground whitespace-nowrap">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right font-mono text-primary font-semibold whitespace-nowrap">
                        {formatDuration(session.durationSec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60">
            <h2 className="text-lg font-semibold">Unseen Logs</h2>
          </div>
          {unseenLogs.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No unseen attempts yet. Head to the{" "}
              <a href="/unseen" className="text-primary hover:underline">
                Unseen
              </a>{" "}
              section to start!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Passage
                    </th>
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Score
                    </th>
                    <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unseenLogs.map((attempt) => (
                    <tr
                      key={attempt.id}
                      className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="p-4 max-w-[340px]">
                        <div className="font-medium text-foreground truncate">{attempt.title}</div>
                        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                          <span>{attempt.theme}</span>
                          <span>•</span>
                          <span>{attempt.difficultyKey}</span>
                          <span>•</span>
                          <span>#{attempt.attemptNumber}</span>
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground whitespace-nowrap">
                        {new Date(attempt.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                            attempt.status === "submitted"
                              ? "bg-green-500/15 text-green-400"
                              : "bg-amber-500/15 text-amber-300"
                          }`}
                        >
                          {formatAttemptStatus(attempt.status)}
                        </span>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap font-semibold">
                        {attempt.scorePercent === null ? "-" : `${attempt.scorePercent}%`}
                      </td>
                      <td className="p-4 text-right font-mono text-primary font-semibold whitespace-nowrap">
                        {formatDuration(attempt.durationSec ?? 0)}
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
