"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import type {
  UnseenAttemptLog,
  UnseenAttemptState,
  UnseenPassageSummary,
  UnseenQuestion,
} from "@/types";
import {
  Sparkles,
  Clock3,
  CircleCheck,
  CircleX,
  Loader2,
  Play,
  FileQuestion,
} from "lucide-react";

type ViewStage = "pick" | "reading" | "questions" | "result";
type LogDateFilter = "all" | "7d" | "30d" | "90d";

interface ActiveReadingPassage {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  theme: string;
  difficultyKey: string;
  timeLimitSec: number;
  sourceType: string;
}

interface UnseenResultPayload {
  attempt: UnseenAttemptState;
  passage: {
    id: string;
    title: string;
    theme: string;
    difficultyKey: string;
    timeLimitSec: number;
    sourceType: string;
  };
  questions: UnseenQuestion[];
}

function formatSeconds(value: number): string {
  const safe = Math.max(0, value);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(totalSec: number | null): string {
  if (!totalSec || totalSec <= 0) {
    return "0s";
  }
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

function formatAttemptStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export default function UnseenPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [stage, setStage] = useState<ViewStage>("pick");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [passages, setPassages] = useState<UnseenPassageSummary[]>([]);
  const [selectedPassageId, setSelectedPassageId] = useState("");
  const [attemptLogs, setAttemptLogs] = useState<UnseenAttemptLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logStatusFilter, setLogStatusFilter] = useState<string>("all");
  const [logDifficultyFilter, setLogDifficultyFilter] = useState<string>("all");
  const [logDateFilter, setLogDateFilter] = useState<LogDateFilter>("all");

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [activePassage, setActivePassage] = useState<ActiveReadingPassage | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [questionRequested, setQuestionRequested] = useState(false);

  const [questions, setQuestions] = useState<UnseenQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<UnseenResultPayload | null>(null);

  const [generateTheme, setGenerateTheme] = useState("General Knowledge");
  const [generateKeywords, setGenerateKeywords] = useState("");
  const [generateDifficulty, setGenerateDifficulty] = useState("medium");
  const [generateTimeLimit, setGenerateTimeLimit] = useState(180);
  const [generatePublish, setGeneratePublish] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  const selectedPassage = useMemo(
    () => passages.find((passage) => passage.id === selectedPassageId) || null,
    [passages, selectedPassageId]
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(attemptLogs.map((attempt) => attempt.status))).sort(),
    [attemptLogs]
  );

  const difficultyOptions = useMemo(
    () => Array.from(new Set(attemptLogs.map((attempt) => attempt.difficultyKey))).sort(),
    [attemptLogs]
  );

  const filteredAttemptLogs = useMemo(() => {
    const now = Date.now();
    const cutoffMap: Record<Exclude<LogDateFilter, "all">, number> = {
      "7d": now - 7 * 24 * 60 * 60 * 1000,
      "30d": now - 30 * 24 * 60 * 60 * 1000,
      "90d": now - 90 * 24 * 60 * 60 * 1000,
    };

    return attemptLogs.filter((attempt) => {
      if (logStatusFilter !== "all" && attempt.status !== logStatusFilter) {
        return false;
      }

      if (
        logDifficultyFilter !== "all" &&
        attempt.difficultyKey !== logDifficultyFilter
      ) {
        return false;
      }

      if (logDateFilter === "all") {
        return true;
      }

      const createdAtMs = new Date(attempt.createdAt).getTime();
      if (Number.isNaN(createdAtMs)) {
        return false;
      }

      return createdAtMs >= cutoffMap[logDateFilter];
    });
  }, [attemptLogs, logStatusFilter, logDifficultyFilter, logDateFilter]);

  const hasActiveLogFilters =
    logStatusFilter !== "all" ||
    logDifficultyFilter !== "all" ||
    logDateFilter !== "all";

  const fetchPassages = async () => {
    try {
      const { data } = await api.get("/unseen");
      const nextPassages: UnseenPassageSummary[] = data.passages || [];
      setPassages(nextPassages);

      if (nextPassages.length === 0) {
        setSelectedPassageId("");
      } else if (!selectedPassageId || !nextPassages.some((p) => p.id === selectedPassageId)) {
        setSelectedPassageId(nextPassages[0].id);
      }
    } catch {
      setError("Failed to load unseen passages");
    } finally {
      setLoading(false);
    }
  };

  const fetchAttemptLogs = async () => {
    try {
      const { data } = await api.get("/unseen/attempts");
      setAttemptLogs(data.attempts || []);
    } catch {
      setAttemptLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setLogsLoading(true);
    void fetchPassages();
    void fetchAttemptLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchQuestions = async (currentAttemptId: string) => {
    setBusy("questions");
    try {
      const { data } = await api.get(`/unseen/attempts/${currentAttemptId}/questions`);
      setQuestions(data.questions || []);
      setStage("questions");
      setError("");
    } catch {
      setError("Unable to load questions yet. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (stage !== "reading") {
      return;
    }

    const timer = window.setInterval(() => {
      setRemainingSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== "reading" || remainingSec > 0 || !attemptId || questionRequested) {
      return;
    }

    setQuestionRequested(true);
    void fetchQuestions(attemptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, remainingSec, attemptId, questionRequested]);

  const startAttempt = async (passageId: string) => {
    setBusy("start");
    setError("");
    setNotice("");

    try {
      const { data } = await api.post(`/unseen/${passageId}/start`);
      const expiresAt = new Date(data.attempt.passageExpiresAt).getTime();

      setAttemptId(data.attempt.id);
      setActivePassage(data.passage);
      setRemainingSec(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
      setQuestions([]);
      setAnswers({});
      setResult(null);
      setQuestionRequested(false);
      setStage("reading");
    } catch {
      setError("Unable to start unseen passage");
    } finally {
      setBusy(null);
    }
  };

  const submitAnswers = async () => {
    if (!attemptId) return;

    setBusy("submit");
    setError("");

    try {
      await api.post(`/unseen/attempts/${attemptId}/submit`, {
        answers: questions.map((question) => ({
          questionId: question.id,
          selectedOptionId: answers[question.id] || null,
        })),
      });

      const { data } = await api.get(`/unseen/attempts/${attemptId}/result`);
      setResult(data as UnseenResultPayload);
      setStage("result");
    } catch {
      setError("Unable to submit answers. Please retry.");
    } finally {
      setBusy(null);
    }
  };

  const generateWithAi = async () => {
    if (!generateTheme.trim()) {
      setError("Please enter a theme for AI generation");
      return;
    }

    setBusy("generate");
    setError("");
    setNotice("");

    try {
      const { data } = await api.post("/unseen/generate", {
        theme: generateTheme,
        keywords: generateKeywords || undefined,
        difficultyKey: generateDifficulty,
        timeLimitSec: generateTimeLimit,
        publish: user?.isAdmin ? generatePublish : false,
      });

      await fetchPassages();

      const generatedPassageId: string | undefined = data?.passage?.id;
      if (data.fallback) {
        setNotice("AI generation was unavailable, so a fallback unseen passage was opened.");
      } else {
        setNotice("AI unseen passage is ready.");
      }

      if (generatedPassageId) {
        setSelectedPassageId(generatedPassageId);
        await startAttempt(generatedPassageId);
      }
    } catch {
      setError("Failed to generate passage with AI");
    } finally {
      setBusy(null);
    }
  };

  const resetToPick = async () => {
    setStage("pick");
    setAttemptId(null);
    setActivePassage(null);
    setQuestions([]);
    setAnswers({});
    setResult(null);
    setRemainingSec(0);
    setQuestionRequested(false);
    setLogsLoading(true);
    await Promise.all([fetchPassages(), fetchAttemptLogs()]);
  };

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
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-extrabold tracking-tight">Unseen Passage Lab</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Read under a timer, then answer MCQs after the passage is hidden.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {notice}
          </div>
        )}

        {stage === "pick" && (
          <div className="space-y-6 animate-fade-in-up delay-100">
            <div className="glow-card rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Choose Unseen Passage</h2>
                <span className="text-xs text-muted-foreground">
                  {passages.length} available
                </span>
              </div>

              {passages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No unseen passages are available yet. Ask an admin to add one.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {passages.map((passage) => (
                      <button
                        key={passage.id}
                        type="button"
                        onClick={() => setSelectedPassageId(passage.id)}
                        className={`text-left rounded-xl border p-4 transition-colors ${
                          selectedPassageId === passage.id
                            ? "border-primary/60 bg-primary/10"
                            : "border-border bg-card/70 hover:border-primary/30"
                        }`}
                      >
                        <div className="font-semibold text-sm truncate">{passage.title}</div>
                        <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-secondary/70">
                            {passage.theme}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-secondary/70">
                            {passage.difficultyKey}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-secondary/70">
                            {passage.timeLimitSec}s
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-secondary/70">
                            {passage.sourceType}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-3 items-center justify-between pt-1">
                    <div className="text-xs text-muted-foreground">
                      {selectedPassage
                        ? `${selectedPassage.wordCount} words | ${selectedPassage.timeLimitSec}s reading time`
                        : "Select a passage"}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedPassageId || busy === "start"}
                      onClick={() => void startAttempt(selectedPassageId)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-40"
                    >
                      {busy === "start" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                      Start Unseen
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="glow-card rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold inline-flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Generate with AI
                </h2>
                <span className="text-xs text-muted-foreground">OpenRouter free models</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  value={generateTheme}
                  onChange={(e) => setGenerateTheme(e.target.value)}
                  placeholder="Theme (e.g., climate policy, entrepreneurship)"
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <input
                  value={generateKeywords}
                  onChange={(e) => setGenerateKeywords(e.target.value)}
                  placeholder="Keywords (optional, comma-separated)"
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <select
                  value={generateDifficulty}
                  onChange={(e) => setGenerateDifficulty(e.target.value)}
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <input
                  value={generateTimeLimit}
                  onChange={(e) => setGenerateTimeLimit(Number(e.target.value) || 180)}
                  type="number"
                  min={30}
                  max={1800}
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>

              {user.isAdmin && (
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={generatePublish}
                    onChange={(e) => setGeneratePublish(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Publish generated passage for all users
                </label>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void generateWithAi()}
                  disabled={busy === "generate"}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-accent-foreground font-semibold text-sm shadow-md shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-40"
                >
                  {busy === "generate" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Generate & Start
                </button>
              </div>
            </div>

            <div className="glow-card rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-border/60 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Unseen Logs</h2>
                <span className="text-xs text-muted-foreground">
                  {filteredAttemptLogs.length} / {attemptLogs.length} attempts
                </span>
              </div>

              {!logsLoading && attemptLogs.length > 0 && (
                <div className="px-6 py-4 border-b border-border/60 bg-card/20">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select
                      value={logStatusFilter}
                      onChange={(e) => setLogStatusFilter(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-card/80 border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="all">All Statuses</option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatAttemptStatus(status)}
                        </option>
                      ))}
                    </select>

                    <select
                      value={logDifficultyFilter}
                      onChange={(e) => setLogDifficultyFilter(e.target.value)}
                      className="w-full p-2.5 rounded-lg bg-card/80 border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="all">All Difficulties</option>
                      {difficultyOptions.map((difficulty) => (
                        <option key={difficulty} value={difficulty}>
                          {difficulty}
                        </option>
                      ))}
                    </select>

                    <select
                      value={logDateFilter}
                      onChange={(e) => setLogDateFilter(e.target.value as LogDateFilter)}
                      className="w-full p-2.5 rounded-lg bg-card/80 border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                    >
                      <option value="all">All Time</option>
                      <option value="7d">Last 7 Days</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="90d">Last 90 Days</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setLogStatusFilter("all");
                        setLogDifficultyFilter("all");
                        setLogDateFilter("all");
                      }}
                      disabled={!hasActiveLogFilters}
                      className="w-full p-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-40"
                    >
                      Clear Filters
                    </button>
                  </div>
                </div>
              )}

              {logsLoading ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                  Loading unseen attempt logs...
                </div>
              ) : attemptLogs.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                  No unseen attempts yet. Start one above to create your first log.
                </div>
              ) : filteredAttemptLogs.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground text-sm">
                  No unseen logs match the current filters.
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
                      {filteredAttemptLogs.map((attempt) => (
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
                            {attempt.scorePercent === null
                              ? "-"
                              : `${attempt.scorePercent}%`}
                          </td>
                          <td className="p-4 text-right font-mono text-primary font-semibold whitespace-nowrap">
                            {formatDuration(attempt.durationSec)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "reading" && activePassage && (
          <div className="animate-fade-in-up delay-100 space-y-4">
            <div className="glow-card rounded-2xl p-4 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{activePassage.title}</h2>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-secondary/70">{activePassage.theme}</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary/70">{activePassage.difficultyKey}</span>
                  <span className="px-2 py-0.5 rounded-full bg-secondary/70">{activePassage.wordCount} words</span>
                </div>
              </div>

              <div className="inline-flex items-center gap-2 rounded-xl bg-primary/10 text-primary px-4 py-2 text-sm font-semibold">
                <Clock3 className="w-4 h-4" />
                {formatSeconds(remainingSec)}
              </div>
            </div>

            <div className="glow-card rounded-2xl p-5 md:p-6">
              <p className="text-sm md:text-base leading-7 text-foreground/95 whitespace-pre-wrap max-h-[62vh] overflow-y-auto pr-2">
                {activePassage.content}
              </p>
            </div>

            <div className="text-center text-xs text-muted-foreground">
              Passage will hide automatically when the timer reaches 0.
            </div>
          </div>
        )}

        {stage === "questions" && (
          <div className="animate-fade-in-up delay-100 space-y-6">
            <div className="glow-card rounded-2xl p-6">
              <h2 className="text-xl font-bold inline-flex items-center gap-2">
                <FileQuestion className="w-5 h-5 text-primary" />
                MCQs
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Passage is now hidden. Answer the questions below.
              </p>
            </div>

            {questions.map((question, index) => (
              <div key={question.id} className="glow-card rounded-2xl p-5 space-y-4">
                <div className="text-sm font-semibold">
                  {index + 1}. {question.prompt}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {question.options.map((option) => {
                    const selected = answers[question.id] === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() =>
                          setAnswers((prev) => ({
                            ...prev,
                            [question.id]: option.id,
                          }))
                        }
                        className={`text-left rounded-xl border px-3 py-2 text-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-card/70 hover:border-primary/40"
                        }`}
                      >
                        {option.text}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void submitAnswers()}
                disabled={busy === "submit" || questions.length === 0}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-40"
              >
                {busy === "submit" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CircleCheck className="w-4 h-4" />
                )}
                Submit Answers
              </button>
            </div>
          </div>
        )}

        {stage === "result" && result && (
          <div className="animate-fade-in-up delay-100 space-y-6">
            <div className="glow-card rounded-2xl p-6 md:p-8">
              <h2 className="text-2xl font-bold">Result Summary</h2>
              <p className="text-muted-foreground text-sm mt-1">{result.passage.title}</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Score</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    {result.attempt.scorePercent ?? 0}%
                  </div>
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Correct</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    {result.attempt.correctAnswers ?? 0}/{result.attempt.totalQuestions ?? 0}
                  </div>
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Time</div>
                  <div className="text-2xl font-bold text-primary mt-1">
                    {formatDuration(result.attempt.durationSec)}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {result.questions.map((question, index) => (
                <div key={question.id} className="glow-card rounded-2xl p-5 space-y-3">
                  <div className="font-semibold text-sm">
                    {index + 1}. {question.prompt}
                  </div>
                  <div className="space-y-2">
                    {question.options.map((option) => {
                      const isSelected = question.selectedOptionId === option.id;
                      const isCorrect = Boolean(option.isCorrect);
                      return (
                        <div
                          key={option.id}
                          className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between ${
                            isCorrect
                              ? "border-green-500/40 bg-green-500/10"
                              : isSelected
                              ? "border-destructive/50 bg-destructive/10"
                              : "border-border bg-card/70"
                          }`}
                        >
                          <span>{option.text}</span>
                          {isCorrect ? (
                            <CircleCheck className="w-4 h-4 text-green-400" />
                          ) : isSelected ? (
                            <CircleX className="w-4 h-4 text-destructive" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void resetToPick()}
                className="px-6 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all"
              >
                Try Another Unseen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
