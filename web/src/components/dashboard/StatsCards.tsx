"use client";

import { BookOpen, Zap, Trophy, Hash } from "lucide-react";

interface StatsCardsProps {
  totalSessions: number;
  totalWordsRead: number;
  bestWpm: number;
  averageWpm: number;
}

export function StatsCards({
  totalSessions,
  totalWordsRead,
  bestWpm,
  averageWpm,
}: StatsCardsProps) {
  const stats = [
    {
      label: "Total Sessions",
      value: totalSessions,
      icon: Hash,
      color: "text-primary",
    },
    {
      label: "Words Read",
      value: totalWordsRead.toLocaleString(),
      icon: BookOpen,
      color: "text-primary",
    },
    {
      label: "Best WPM",
      value: bestWpm,
      icon: Trophy,
      color: "text-accent",
    },
    {
      label: "Average WPM",
      value: Math.round(averageWpm),
      icon: Zap,
      color: "text-primary",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="p-4 rounded-xl bg-card border border-border"
        >
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {stat.label}
            </span>
          </div>
          <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
