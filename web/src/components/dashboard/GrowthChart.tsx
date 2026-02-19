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
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="date"
          stroke="#94a3b8"
          fontSize={12}
          tickFormatter={(value) => {
            const d = new Date(value);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis stroke="#94a3b8" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#111827",
            border: "1px solid #1e293b",
            borderRadius: "8px",
            color: "#f3f4f6",
          }}
          labelFormatter={(value) => new Date(value).toLocaleDateString()}
          formatter={(value) => [`${value} WPM`, "Max Speed"]}
        />
        <Line
          type="monotone"
          dataKey="wpm"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ fill: "#3b82f6", r: 4 }}
          activeDot={{ r: 6, fill: "#ef4444" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
