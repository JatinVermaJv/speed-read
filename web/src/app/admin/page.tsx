"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import {
  Users,
  BookOpen,
  FileQuestion,
  Zap,
  Trophy,
  Clock,
  Shield,
  Hash,
  Trash2,
  ShieldCheck,
  ShieldOff,
  Eye,
  EyeOff,
  Plus,
  Loader2,
  X,
} from "lucide-react";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
  totalSessions: number;
  totalWordsRead: number;
  totalTimeSec: number;
  averageWpm: number;
  bestWpm: number;
}

interface AdminPassage {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  category: string;
  isDefault: boolean;
  userId: string | null;
  authorName: string | null;
  createdAt: string;
}

interface AdminUnseenPassage {
  id: string;
  title: string;
  theme: string;
  wordCount: number;
  difficultyKey: string;
  timeLimitSec: number;
  sourceType: string;
  isPublished: boolean;
  createdBy: string | null;
  authorName: string | null;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface UnseenQuestionDraft {
  prompt: string;
  explanation: string;
  options: string[];
  correctIndex: number;
}

interface PlatformStats {
  totalUsers: number;
  totalSessions: number;
  totalWordsRead: number;
  totalTimeSec: number;
  platformAvgWpm: number;
  platformBestWpm: number;
}

interface AdminLanguageTemplate {
  id: string;
  targetLanguageCode: string;
  level: string;
  title: string;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lessonCount: number;
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs < 24) return `${hrs}h ${remainMins}m`;
  const days = Math.floor(hrs / 24);
  const remainHrs = hrs % 24;
  return `${days}d ${remainHrs}h`;
}

function createDefaultQuestions(): UnseenQuestionDraft[] {
  return Array.from({ length: 5 }, () => ({
    prompt: "",
    explanation: "",
    options: ["", "", "", ""],
    correctIndex: 0,
  }));
}

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [userList, setUserList] = useState<AdminUser[]>([]);
  const [passageList, setPassageList] = useState<AdminPassage[]>([]);
  const [unseenList, setUnseenList] = useState<AdminUnseenPassage[]>([]);
  const [languageTemplates, setLanguageTemplates] = useState<AdminLanguageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [languageBusy, setLanguageBusy] = useState<string | null>(null);

  // Passage form state
  const [showPassageForm, setShowPassageForm] = useState(false);
  const [pTitle, setPTitle] = useState("");
  const [pContent, setPContent] = useState("");
  const [pCategory, setPCategory] = useState("General");
  const [pIsDefault, setPIsDefault] = useState(true);
  const [pSaving, setPSaving] = useState(false);

  // Unseen form state
  const [showUnseenForm, setShowUnseenForm] = useState(false);
  const [uTitle, setUTitle] = useState("");
  const [uContent, setUContent] = useState("");
  const [uTheme, setUTheme] = useState("General");
  const [uDifficultyKey, setUDifficultyKey] = useState("medium");
  const [uTimeLimitSec, setUTimeLimitSec] = useState(180);
  const [uIsPublished, setUIsPublished] = useState(true);
  const [uQuestions, setUQuestions] = useState<UnseenQuestionDraft[]>(
    createDefaultQuestions()
  );
  const [uSaving, setUSaving] = useState(false);

  // Language template form state
  const [lTargetLanguageCode, setLTargetLanguageCode] = useState("es-ES");
  const [lLevel, setLLevel] = useState("A1");
  const [lLessonCount, setLLessonCount] = useState(5);

  // Confirm modal state
  const [confirm, setConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Active tab
  const [tab, setTab] = useState<"users" | "passages" | "unseen" | "language">("users");

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  const fetchData = useCallback(async () => {
    if (!user || !user.isAdmin) return;
    try {
      const [statsRes, usersRes, passagesRes, unseenRes, languageRes] = await Promise.all([
        api.get("/admin/stats"),
        api.get("/admin/users"),
        api.get("/admin/passages"),
        api.get("/admin/unseen"),
        api.get("/admin/language/templates"),
      ]);
      setStats(statsRes.data);
      setUserList(usersRes.data.users || []);
      setPassageList(passagesRes.data.passages || []);
      setUnseenList(unseenRes.data.unseenPassages || []);
      setLanguageTemplates(languageRes.data.templates || []);
    } catch {
      setError("Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── User actions ──────────────────────────────────────────────

  const toggleAdmin = async (targetId: string, makeAdmin: boolean) => {
    setActionLoading(targetId);
    try {
      await api.patch(`/admin/users/${targetId}/role`, { isAdmin: makeAdmin });
      setUserList((prev) =>
        prev.map((u) => (u.id === targetId ? { ...u, isAdmin: makeAdmin } : u))
      );
    } catch {
      setError("Failed to update user role");
    } finally {
      setActionLoading(null);
    }
  };

  const deleteUser = async (targetId: string) => {
    setActionLoading(targetId);
    try {
      await api.delete(`/admin/users/${targetId}`);
      setUserList((prev) => prev.filter((u) => u.id !== targetId));
      if (stats) setStats({ ...stats, totalUsers: stats.totalUsers - 1 });
    } catch {
      setError("Failed to delete user");
    } finally {
      setActionLoading(null);
      setConfirm(null);
    }
  };

  // ── Passage actions ───────────────────────────────────────────

  const createPassage = async () => {
    setPSaving(true);
    try {
      await api.post("/admin/passages", {
        title: pTitle,
        content: pContent,
        category: pCategory,
        isDefault: pIsDefault,
      });
      setPTitle("");
      setPContent("");
      setPCategory("General");
      setPIsDefault(true);
      setShowPassageForm(false);
      // Refresh
      const res = await api.get("/admin/passages");
      setPassageList(res.data.passages || []);
    } catch {
      setError("Failed to create passage");
    } finally {
      setPSaving(false);
    }
  };

  const deletePassage = async (passageId: string) => {
    setActionLoading(passageId);
    try {
      await api.delete(`/admin/passages/${passageId}`);
      setPassageList((prev) => prev.filter((p) => p.id !== passageId));
    } catch {
      setError("Failed to delete passage");
    } finally {
      setActionLoading(null);
      setConfirm(null);
    }
  };

  const createUnseenPassage = async () => {
    setUSaving(true);
    try {
      await api.post("/admin/unseen", {
        title: uTitle,
        content: uContent,
        theme: uTheme,
        difficultyKey: uDifficultyKey,
        timeLimitSec: uTimeLimitSec,
        isPublished: uIsPublished,
        questions: uQuestions.map((question) => ({
          prompt: question.prompt,
          explanation: question.explanation || undefined,
          options: question.options.map((text, index) => ({
            text,
            isCorrect: index === question.correctIndex,
          })),
        })),
      });

      setUTitle("");
      setUContent("");
      setUTheme("General");
      setUDifficultyKey("medium");
      setUTimeLimitSec(180);
      setUIsPublished(true);
      setUQuestions(createDefaultQuestions());
      setShowUnseenForm(false);

      const res = await api.get("/admin/unseen");
      setUnseenList(res.data.unseenPassages || []);
    } catch {
      setError("Failed to create unseen passage");
    } finally {
      setUSaving(false);
    }
  };

  const toggleUnseenPublish = async (passageId: string, isPublished: boolean) => {
    setActionLoading(passageId);
    try {
      await api.patch(`/admin/unseen/${passageId}/publish`, {
        isPublished: !isPublished,
      });
      setUnseenList((prev) =>
        prev.map((item) =>
          item.id === passageId ? { ...item, isPublished: !isPublished } : item
        )
      );
    } catch {
      setError("Failed to update unseen visibility");
    } finally {
      setActionLoading(null);
    }
  };

  const deleteUnseenPassage = async (passageId: string) => {
    setActionLoading(passageId);
    try {
      await api.delete(`/admin/unseen/${passageId}`);
      setUnseenList((prev) => prev.filter((item) => item.id !== passageId));
    } catch {
      setError("Failed to delete unseen passage");
    } finally {
      setActionLoading(null);
      setConfirm(null);
    }
  };

  // ── Language template actions ─────────────────────────────────

  const refreshLanguageTemplates = async () => {
    try {
      const res = await api.get("/admin/language/templates");
      setLanguageTemplates(res.data.templates || []);
    } catch {
      setError("Failed to load language templates");
    }
  };

  const generateLanguageTemplate = async () => {
    setLanguageBusy("generate");
    try {
      await api.post("/admin/language/templates/generate", {
        targetLanguageCode: lTargetLanguageCode,
        level: lLevel,
        lessonCount: lLessonCount,
      });
      await refreshLanguageTemplates();
    } catch {
      setError("Failed to generate language template");
    } finally {
      setLanguageBusy(null);
    }
  };

  const toggleLanguageTemplatePublish = async (
    templateId: string,
    isPublished: boolean
  ) => {
    setLanguageBusy(`publish:${templateId}`);
    try {
      await api.patch(`/admin/language/templates/${templateId}/publish`, {
        isPublished: !isPublished,
      });
      await refreshLanguageTemplates();
    } catch {
      setError("Failed to update template visibility");
    } finally {
      setLanguageBusy(null);
    }
  };

  const testEnrollLanguageTemplate = async (templateId: string) => {
    setLanguageBusy(`test:${templateId}`);
    try {
      await api.post("/language/enroll", { templateId });
      router.push("/language");
    } catch {
      setError("Failed to enroll into template");
    } finally {
      setLanguageBusy(null);
    }
  };

  // ── Guards ────────────────────────────────────────────────────

  if (authLoading || !user || !user.isAdmin) {
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

  const platformStats = [
    {
      label: "Total Users",
      value: stats?.totalUsers || 0,
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Total Sessions",
      value: stats?.totalSessions || 0,
      icon: Hash,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Words Read",
      value: (stats?.totalWordsRead || 0).toLocaleString(),
      icon: BookOpen,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Platform Time",
      value: formatDuration(stats?.totalTimeSec || 0),
      icon: Clock,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "Avg WPM",
      value: stats?.platformAvgWpm || 0,
      icon: Zap,
      color: "text-accent",
      bg: "bg-accent/10",
    },
    {
      label: "Best WPM",
      value: stats?.platformBestWpm || 0,
      icon: Trophy,
      color: "text-accent",
      bg: "bg-accent/10",
    },
  ];

  const wordCount = pContent
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  const unseenWordCount = uContent
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  const unseenFormValid =
    uTitle.trim().length > 0 &&
    unseenWordCount >= 80 &&
    uQuestions.every(
      (question) =>
        question.prompt.trim().length > 0 &&
        question.options.every((option) => option.trim().length > 0)
    );

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-10">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="animate-fade-in-up flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground text-sm">
              Platform overview, user management & passages
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm flex items-center justify-between">
            {error}
            <button onClick={() => setError("")} className="ml-2 hover:text-destructive/70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Platform Stats */}
        <div className="animate-fade-in-up delay-100 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {platformStats.map((stat) => (
            <div key={stat.label} className="glow-card p-4 rounded-2xl">
              <div className="flex items-center gap-2 mb-2">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.bg}`}
                >
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </div>
              <div className={`text-xl font-bold ${stat.color}`}>
                {stat.value}
              </div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1 block">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="animate-fade-in-up delay-200 flex gap-2 p-1 rounded-xl bg-secondary/60 w-fit">
          <button
            onClick={() => setTab("users")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "users"
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Users className="w-4 h-4" /> Users ({userList.length})
            </span>
          </button>
          <button
            onClick={() => setTab("passages")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "passages"
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" /> Passages ({passageList.length})
            </span>
          </button>
          <button
            onClick={() => setTab("unseen")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "unseen"
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <FileQuestion className="w-4 h-4" /> Unseen ({unseenList.length})
            </span>
          </button>
          <button
            onClick={() => setTab("language")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "language"
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Zap className="w-4 h-4" /> Language ({languageTemplates.length})
            </span>
          </button>
        </div>

        {/* ── Users Tab ──────────────────────────────────────────── */}
        {tab === "users" && (
          <div className="animate-fade-in-up glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-lg font-semibold">All Users</h2>
              <span className="text-xs text-muted-foreground">
                {userList.length} user{userList.length !== 1 ? "s" : ""}
              </span>
            </div>
            {userList.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground">
                No users found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        User
                      </th>
                      <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Email
                      </th>
                      <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Sessions
                      </th>
                      <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Avg WPM
                      </th>
                      <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Best WPM
                      </th>
                      <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Time
                      </th>
                      <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Joined
                      </th>
                      <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Role
                      </th>
                      <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.map((u) => {
                      const isSelf = u.id === user.id;
                      const busy = actionLoading === u.id;
                      return (
                        <tr
                          key={u.id}
                          className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              {u.avatarUrl ? (
                                <img
                                  src={u.avatarUrl}
                                  alt=""
                                  className="w-7 h-7 rounded-full"
                                />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                                  {u.name.charAt(0).toUpperCase()}
                                </div>
                              )}
                              <span className="font-medium">{u.name}</span>
                            </div>
                          </td>
                          <td className="p-4 text-muted-foreground">{u.email}</td>
                          <td className="p-4 text-right font-mono">
                            {u.totalSessions}
                          </td>
                          <td className="p-4 text-right font-mono font-semibold text-primary">
                            {u.averageWpm}
                          </td>
                          <td className="p-4 text-right font-mono font-semibold text-accent">
                            {u.bestWpm}
                          </td>
                          <td className="p-4 text-right font-mono text-muted-foreground">
                            {formatDuration(u.totalTimeSec)}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-4 text-center">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                u.isAdmin
                                  ? "bg-accent/10 text-accent"
                                  : "bg-primary/10 text-primary"
                              }`}
                            >
                              {u.isAdmin ? "Admin" : "User"}
                            </span>
                          </td>
                          <td className="p-4">
                            {isSelf ? (
                              <span className="text-xs text-muted-foreground">You</span>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    toggleAdmin(u.id, !u.isAdmin)
                                  }
                                  title={
                                    u.isAdmin
                                      ? "Remove admin"
                                      : "Make admin"
                                  }
                                  className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                                    u.isAdmin
                                      ? "hover:bg-accent/10 text-accent"
                                      : "hover:bg-primary/10 text-primary"
                                  }`}
                                >
                                  {u.isAdmin ? (
                                    <ShieldOff className="w-4 h-4" />
                                  ) : (
                                    <ShieldCheck className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    setConfirm({
                                      message: `Delete user "${u.name}" (${u.email})? This will remove all their sessions and data permanently.`,
                                      onConfirm: () => deleteUser(u.id),
                                    })
                                  }
                                  title="Delete user"
                                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-40"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Passages Tab ───────────────────────────────────────── */}
        {tab === "passages" && (
          <div className="space-y-6 animate-fade-in-up">
            {/* Add Passage Button / Form */}
            {!showPassageForm ? (
              <button
                onClick={() => setShowPassageForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all"
              >
                <Plus className="w-4 h-4" /> Add Passage
              </button>
            ) : (
              <div className="glow-card rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">New Passage</h3>
                  <button
                    onClick={() => setShowPassageForm(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    value={pTitle}
                    onChange={(e) => setPTitle(e.target.value)}
                    placeholder="Passage title"
                    className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                  <div className="flex gap-3">
                    <input
                      value={pCategory}
                      onChange={(e) => setPCategory(e.target.value)}
                      placeholder="Category"
                      className="flex-1 p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                    />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={pIsDefault}
                        onChange={(e) => setPIsDefault(e.target.checked)}
                        className="w-4 h-4 rounded accent-primary"
                      />
                      Default
                    </label>
                  </div>
                </div>
                <textarea
                  value={pContent}
                  onChange={(e) => setPContent(e.target.value)}
                  placeholder="Paste passage content here (min 20 words)..."
                  rows={5}
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {wordCount} word{wordCount !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={createPassage}
                    disabled={pSaving || wordCount < 20 || !pTitle.trim()}
                    className="px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-40"
                  >
                    {pSaving ? "Saving..." : "Create Passage"}
                  </button>
                </div>
              </div>
            )}

            {/* Passages list */}
            <div className="glow-card rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-border/60 flex items-center justify-between">
                <h2 className="text-lg font-semibold">All Passages</h2>
                <span className="text-xs text-muted-foreground">
                  {passageList.length} passage{passageList.length !== 1 ? "s" : ""}
                </span>
              </div>
              {passageList.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  No passages yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Title
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Category
                        </th>
                        <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Words
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Type
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Author
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Created
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {passageList.map((p) => (
                        <tr
                          key={p.id}
                          className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="p-4 font-medium max-w-[200px] truncate">
                            {p.title}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {p.category}
                          </td>
                          <td className="p-4 text-right font-mono">
                            {p.wordCount}
                          </td>
                          <td className="p-4 text-center">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                p.isDefault
                                  ? "bg-primary/10 text-primary"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {p.isDefault ? "Default" : "Custom"}
                            </span>
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {p.authorName || "System"}
                          </td>
                          <td className="p-4 text-muted-foreground">
                            {new Date(p.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-4 text-center">
                            <button
                              disabled={actionLoading === p.id}
                              onClick={() =>
                                setConfirm({
                                  message: `Delete passage "${p.title}"? This cannot be undone.`,
                                  onConfirm: () => deletePassage(p.id),
                                })
                              }
                              title="Delete passage"
                              className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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

        {/* ── Unseen Tab ───────────────────────────────────────── */}
        {tab === "unseen" && (
          <div className="space-y-6 animate-fade-in-up">
            {!showUnseenForm ? (
              <button
                onClick={() => setShowUnseenForm(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all"
              >
                <Plus className="w-4 h-4" /> Add Unseen Passage
              </button>
            ) : (
              <div className="glow-card rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">New Unseen Passage (5 MCQs)</h3>
                  <button
                    onClick={() => setShowUnseenForm(false)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    value={uTitle}
                    onChange={(e) => setUTitle(e.target.value)}
                    placeholder="Unseen title"
                    className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                  <input
                    value={uTheme}
                    onChange={(e) => setUTheme(e.target.value)}
                    placeholder="Theme"
                    className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                  <select
                    value={uDifficultyKey}
                    onChange={(e) => setUDifficultyKey(e.target.value)}
                    className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                  <input
                    type="number"
                    min={30}
                    max={1800}
                    value={uTimeLimitSec}
                    onChange={(e) => setUTimeLimitSec(Number(e.target.value) || 180)}
                    placeholder="Time limit (seconds)"
                    className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                  />
                </div>

                <textarea
                  value={uContent}
                  onChange={(e) => setUContent(e.target.value)}
                  placeholder="Paste unseen passage content here (min 80 words)..."
                  rows={6}
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
                />

                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={uIsPublished}
                    onChange={(e) => setUIsPublished(e.target.checked)}
                    className="w-4 h-4 rounded accent-primary"
                  />
                  Publish immediately
                </label>

                <div className="space-y-4">
                  {uQuestions.map((question, qIndex) => (
                    <div key={qIndex} className="rounded-xl border border-border/60 p-4 space-y-3 bg-card/30">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        Question {qIndex + 1}
                      </div>
                      <input
                        value={question.prompt}
                        onChange={(e) =>
                          setUQuestions((prev) =>
                            prev.map((item, index) =>
                              index === qIndex
                                ? { ...item, prompt: e.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Question prompt"
                        className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                      />
                      <input
                        value={question.explanation}
                        onChange={(e) =>
                          setUQuestions((prev) =>
                            prev.map((item, index) =>
                              index === qIndex
                                ? { ...item, explanation: e.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Explanation (optional)"
                        className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                      />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {question.options.map((optionText, optionIndex) => (
                          <div key={optionIndex} className="flex items-center gap-2">
                            <input
                              value={optionText}
                              onChange={(e) =>
                                setUQuestions((prev) =>
                                  prev.map((item, index) =>
                                    index === qIndex
                                      ? {
                                          ...item,
                                          options: item.options.map((option, optIndex) =>
                                            optIndex === optionIndex ? e.target.value : option
                                          ),
                                        }
                                      : item
                                  )
                                )
                              }
                              placeholder={`Option ${optionIndex + 1}`}
                              className="flex-1 p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                            />
                            <label className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                              <input
                                type="radio"
                                name={`correct-${qIndex}`}
                                checked={question.correctIndex === optionIndex}
                                onChange={() =>
                                  setUQuestions((prev) =>
                                    prev.map((item, index) =>
                                      index === qIndex
                                        ? { ...item, correctIndex: optionIndex }
                                        : item
                                    )
                                  )
                                }
                                className="w-4 h-4 accent-primary"
                              />
                              Correct
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {unseenWordCount} words | 5 questions required
                  </span>
                  <button
                    onClick={createUnseenPassage}
                    disabled={uSaving || !unseenFormValid}
                    className="px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-40"
                  >
                    {uSaving ? "Saving..." : "Create Unseen"}
                  </button>
                </div>
              </div>
            )}

            <div className="glow-card rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-border/60 flex items-center justify-between">
                <h2 className="text-lg font-semibold">All Unseen Passages</h2>
                <span className="text-xs text-muted-foreground">
                  {unseenList.length} unseen{unseenList.length !== 1 ? "s" : ""}
                </span>
              </div>

              {unseenList.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  No unseen passages yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Title
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Theme
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Difficulty
                        </th>
                        <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Timer
                        </th>
                        <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          MCQs
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Source
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Visibility
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Author
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Created
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unseenList.map((item) => (
                        <tr
                          key={item.id}
                          className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="p-4 font-medium max-w-[220px] truncate">{item.title}</td>
                          <td className="p-4 text-muted-foreground">{item.theme}</td>
                          <td className="p-4 text-center text-muted-foreground uppercase">
                            {item.difficultyKey}
                          </td>
                          <td className="p-4 text-right font-mono">{item.timeLimitSec}s</td>
                          <td className="p-4 text-right font-mono">{item.questionCount}</td>
                          <td className="p-4 text-muted-foreground capitalize">{item.sourceType}</td>
                          <td className="p-4 text-center">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                item.isPublished
                                  ? "bg-green-500/10 text-green-400"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {item.isPublished ? "Published" : "Hidden"}
                            </span>
                          </td>
                          <td className="p-4 text-muted-foreground">{item.authorName || "System"}</td>
                          <td className="p-4 text-muted-foreground">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                disabled={actionLoading === item.id}
                                onClick={() => toggleUnseenPublish(item.id, item.isPublished)}
                                title={item.isPublished ? "Hide unseen" : "Publish unseen"}
                                className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors disabled:opacity-40"
                              >
                                {item.isPublished ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                disabled={actionLoading === item.id}
                                onClick={() =>
                                  setConfirm({
                                    message: `Delete unseen passage "${item.title}"? This cannot be undone.`,
                                    onConfirm: () => deleteUnseenPassage(item.id),
                                  })
                                }
                                title="Delete unseen"
                                className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors disabled:opacity-40"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
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

        {/* ── Language Tab ─────────────────────────────────────── */}
        {tab === "language" && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="glow-card rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Generate Language Template</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  value={lTargetLanguageCode}
                  onChange={(e) => setLTargetLanguageCode(e.target.value)}
                  placeholder="Target language code (e.g. es-ES)"
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <input
                  value={lLevel}
                  onChange={(e) => setLLevel(e.target.value)}
                  placeholder="Level (e.g. A1)"
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={lLessonCount}
                  onChange={(e) => setLLessonCount(Number(e.target.value) || 0)}
                  placeholder="Lesson count"
                  className="w-full p-3 rounded-xl bg-card/80 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Generation can take a minute.
                </span>
                <button
                  onClick={generateLanguageTemplate}
                  disabled={
                    languageBusy !== null ||
                    lTargetLanguageCode.trim().length < 2 ||
                    lLevel.trim().length < 1 ||
                    lLessonCount < 3 ||
                    lLessonCount > 30
                  }
                  className="px-6 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-md shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-40"
                >
                  {languageBusy === "generate" ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating...
                    </span>
                  ) : (
                    "Generate Template"
                  )}
                </button>
              </div>
            </div>

            <div className="glow-card rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-border/60 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Language Templates</h2>
                <span className="text-xs text-muted-foreground">
                  {languageTemplates.length} template
                  {languageTemplates.length !== 1 ? "s" : ""}
                </span>
              </div>

              {languageTemplates.length === 0 ? (
                <div className="p-10 text-center text-muted-foreground">
                  No language templates yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Title
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Language
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Level
                        </th>
                        <th className="text-right p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Lessons
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Visibility
                        </th>
                        <th className="text-left p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Created
                        </th>
                        <th className="text-center p-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {languageTemplates.map((t) => {
                        const publishBusy = languageBusy === `publish:${t.id}`;
                        const testBusy = languageBusy === `test:${t.id}`;

                        return (
                          <tr
                            key={t.id}
                            className="border-b border-border/30 last:border-0 hover:bg-white/[0.02] transition-colors"
                          >
                            <td className="p-4 font-medium max-w-[320px] truncate">
                              {t.title}
                            </td>
                            <td className="p-4 font-mono text-muted-foreground">
                              {t.targetLanguageCode}
                            </td>
                            <td className="p-4 text-muted-foreground">
                              {t.level}
                            </td>
                            <td className="p-4 text-right font-mono">
                              {t.lessonCount}
                            </td>
                            <td className="p-4 text-center">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  t.isPublished
                                    ? "bg-green-500/10 text-green-400"
                                    : "bg-secondary text-muted-foreground"
                                }`}
                              >
                                {t.isPublished ? "Published" : "Hidden"}
                              </span>
                            </td>
                            <td className="p-4 text-muted-foreground">
                              {new Date(t.createdAt).toLocaleDateString()}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  disabled={languageBusy !== null}
                                  onClick={() =>
                                    toggleLanguageTemplatePublish(t.id, t.isPublished)
                                  }
                                  title={t.isPublished ? "Unpublish" : "Publish"}
                                  className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors disabled:opacity-40"
                                >
                                  {publishBusy ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : t.isPublished ? (
                                    <EyeOff className="w-4 h-4" />
                                  ) : (
                                    <Eye className="w-4 h-4" />
                                  )}
                                </button>
                                <button
                                  disabled={languageBusy !== null}
                                  onClick={() => testEnrollLanguageTemplate(t.id)}
                                  title="Test enroll"
                                  className="p-1.5 rounded-lg hover:bg-accent/10 text-accent transition-colors disabled:opacity-40"
                                >
                                  {testBusy ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <BookOpen className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Confirm Modal ──────────────────────────────────────── */}
      {confirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="glow-card rounded-2xl p-6 max-w-md w-full space-y-4 animate-fade-in-up">
            <h3 className="font-semibold text-lg">Are you sure?</h3>
            <p className="text-sm text-muted-foreground">{confirm.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirm.onConfirm}
                className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:brightness-110 transition-all"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
