"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface GrowthChartProps {
  data: { date: string; wpm: number }[];
}

export function GrowthChart({ data }: GrowthChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No session data yet. Start reading to see your progress!
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="date"
          stroke="#8b8fa3"
          fontSize={12}
          tickFormatter={(value) => {
            const d = new Date(value);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis stroke="#8b8fa3" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0c0c1d",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "12px",
            color: "#eef0f6",
            boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
          }}
          labelFormatter={(value) => new Date(value).toLocaleDateString()}
          formatter={(value) => [`${value} WPM`, "Max Speed"]}
        />
        <Line
          type="monotone"
          dataKey="wpm"
          stroke="url(#lineGradient)"
          strokeWidth={2.5}
          dot={{ fill: "#6366f1", r: 4, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: "#f43f5e", strokeWidth: 0 }}
        />
        <defs>
          <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
      </LineChart>
    </ResponsiveContainer>
  );
}
