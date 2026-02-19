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
          className="glow-card p-5 rounded-2xl"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.color === 'text-accent' ? 'bg-accent/10' : 'bg-primary/10'}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
          </div>
          <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
          <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1 block">
            {stat.label}
          </span>
        </div>
      ))}
    </div>
  );
}
