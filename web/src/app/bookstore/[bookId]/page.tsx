"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Flag,
  Sparkles,
  StickyNote,
  Quote,
  Lightbulb,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import type { Book, BookAiOutput, BookStatus } from "@/types";

const STATUSES: BookStatus[] = ["to_read", "reading", "finished", "abandoned"];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

type AiOutputMap = Record<
  string,
  {
    model: string;
    payload: any;
    updatedAt: string;
  }
>;

function formatStatus(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function statusBadgeClasses(status: BookStatus): string {
  switch (status) {
    case "reading":
      return "bg-primary/15 text-primary border border-primary/20";
    case "finished":
      return "bg-accent/15 text-accent border border-accent/20";
    case "abandoned":
      return "bg-muted text-muted-foreground border border-border/60";
    case "to_read":
    default:
      return "bg-secondary/70 text-secondary-foreground border border-border/60";
  }
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function BookCover({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary/40 rounded-xl overflow-hidden">
        <BookOpen className="w-12 h-12 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover rounded-xl overflow-hidden"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function BookDetailPage({
  params,
}: {
  params?: { bookId?: string };
}) {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const routeParams = useParams<{ bookId?: string | string[] }>();

  const bookId = firstParam(routeParams?.bookId) ?? firstParam(params?.bookId) ?? "";
  const bookIdIsValid = isUuid(bookId);

  const [book, setBook] = useState<Book | null>(null);
  const [aiOutputs, setAiOutputs] = useState<AiOutputMap>({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  const [status, setStatus] = useState<BookStatus>("to_read");
  const [rating, setRating] = useState<string>("");
  const [savingMeta, setSavingMeta] = useState(false);

  const [activeSummary, setActiveSummary] = useState<
    "tldr" | "concise" | "deep" | "skimmable"
  >("tldr");

  const [generating, setGenerating] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [applyGoal, setApplyGoal] = useState("");

  const [shelfBooks, setShelfBooks] = useState<Book[]>([]);
  const [compareWith, setCompareWith] = useState<string>("");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setPageError(null);

    try {
      const { data } = await api.get(`/books/${bookId}`);
      const loadedBook: Book = data.book;
      const outputs: BookAiOutput[] = data.aiOutputs || [];

      const map: AiOutputMap = {};
      for (const out of outputs) {
        map[out.kind] = {
          model: out.model,
          payload: safeJsonParse(out.payload) ?? out.payload,
          updatedAt: out.updatedAt,
        };
      }

      setBook(loadedBook);
      setAiOutputs(map);
      setNotes(loadedBook.notes || "");
      setStatus(loadedBook.status);
      setRating(typeof loadedBook.rating === "number" ? String(loadedBook.rating) : "");
    } catch (err: any) {
      setPageError(err?.response?.data?.message || "Failed to load book");
    } finally {
      setLoading(false);
    }
  };

  const loadShelf = async () => {
    if (!user) return;
    try {
      const { data } = await api.get("/books");
      setShelfBooks(data.books || []);
    } catch {
      // Non-blocking.
    }
  };

  useEffect(() => {
    if (!user) return;
    if (!bookIdIsValid) {
      setLoading(false);
      setPageError("Invalid book id");
      return;
    }
    load();
    loadShelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, bookId, bookIdIsValid]);

  useEffect(() => {
    if (compareWith) return;
    const other = shelfBooks.filter((b) => b.id !== bookId);
    if (other.length > 0) setCompareWith(other[0].id);
  }, [shelfBooks, bookId, compareWith]);

  const canSaveMeta = useMemo(() => {
    if (!book) return false;
    const ratingValue = rating ? Number(rating) : null;
    const hasRatingChanged =
      (typeof book.rating === "number" ? book.rating : null) !== ratingValue;
    const hasStatusChanged = book.status !== status;
    return (hasRatingChanged || hasStatusChanged) && !savingMeta;
  }, [book, status, rating, savingMeta]);

  const saveMeta = async () => {
    if (!book || !canSaveMeta) return;
    setSavingMeta(true);

    try {
      const { data } = await api.patch(`/books/${bookId}`, {
        status,
        rating: rating ? Number(rating) : null,
      });
      setBook(data.book);
    } finally {
      setSavingMeta(false);
    }
  };

  const saveNotes = async () => {
    if (!book) return;
    setSavingNotes(true);

    try {
      const { data } = await api.patch(`/books/${bookId}`, { notes });
      setBook(data.book);
    } finally {
      setSavingNotes(false);
    }
  };

  const setOutput = (kind: string, model: string, payload: any) => {
    setAiOutputs((current) => ({
      ...current,
      [kind]: {
        model,
        payload,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const generateSummary = async (kind: "tldr" | "concise" | "deep" | "skimmable") => {
    setGenerating(`summary_${kind}`);
    setGenError(null);

    try {
      const { data } = await api.post(`/books/${bookId}/ai/summary`, { kind });
      setOutput(data.kind, data.model, data.payload);
    } catch (err: any) {
      setGenError(err?.response?.data?.message || "Failed to generate summary");
    } finally {
      setGenerating(null);
    }
  };

  const generateSimple = async (endpoint: string, kind: string, body?: any) => {
    setGenerating(kind);
    setGenError(null);

    try {
      const { data } = await api.post(`/books/${bookId}${endpoint}`, body || {});
      setOutput(data.kind, data.model, data.payload);
    } catch (err: any) {
      setGenError(err?.response?.data?.message || "Failed to generate");
    } finally {
      setGenerating(null);
    }
  };

  const generateCompare = async () => {
    if (!compareWith) return;
    const kind = `compare_${compareWith}`;
    setGenerating(kind);
    setGenError(null);

    try {
      const { data } = await api.post(`/books/${bookId}/ai/compare`, {
        otherBookId: compareWith,
      });
      setOutput(data.kind, data.model, data.payload);
    } catch (err: any) {
      setGenError(err?.response?.data?.message || "Failed to compare books");
    } finally {
      setGenerating(null);
    }
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

  if (pageError || !book) {
    return (
      <div className="min-h-[calc(100vh-64px)] px-4 py-10">
        <div className="max-w-4xl mx-auto glow-card rounded-2xl p-6">
          <div className="text-destructive font-semibold">{pageError || "Book not found"}</div>
          <div className="mt-4">
            <Link href="/bookstore" className="text-primary hover:underline">
              Back to shelf
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const summaryKindKey = `summary_${activeSummary}`;
  const summary = aiOutputs[summaryKindKey]?.payload;
  const compareKindKey = compareWith ? `compare_${compareWith}` : null;
  const comparePayload = compareKindKey ? aiOutputs[compareKindKey]?.payload : null;

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="animate-fade-in-up flex items-center justify-between">
          <Link
            href="/bookstore"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>

        <div className="animate-fade-in-up delay-100 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center justify-between">
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">{book.title}</h1>
            <div
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs ${statusBadgeClasses(
                status
              )}`}
              title={formatStatus(status)}
            >
              <Flag className="w-3.5 h-3.5" />
              <span>{formatStatus(status)}</span>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1">
              <div className="aspect-[3/4]">
                <BookCover src={book.coverImageUrl} alt={`${book.title} cover`} />
              </div>
              {book.previewLink && (
                <a
                  href={book.previewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-sm text-primary hover:underline"
                >
                  Preview
                </a>
              )}
            </div>

            <div className="md:col-span-2 space-y-4">
              <div>
                <div className="text-sm text-muted-foreground">Author</div>
                <div className="text-lg font-semibold">{book.author}</div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as BookStatus)}
                    className="w-full p-3 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {formatStatus(s)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Rating
                  </label>
                  <select
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                    className="w-full p-3 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none"
                  >
                    <option value="">No rating</option>
                    {[1, 2, 3, 4, 5].map((r) => (
                      <option key={r} value={String(r)}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={saveMeta}
                  disabled={!canSaveMeta}
                  className="px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {savingMeta ? "Saving…" : "Save"}
                </button>
              </div>

              {(book.publisher || book.publishedDate || book.pageCount) && (
                <div className="pt-2 border-t border-border/60 text-sm text-muted-foreground grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <span className="text-muted-foreground">Publisher:</span>{" "}
                    <span className="text-foreground/90">{book.publisher || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Published:</span>{" "}
                    <span className="text-foreground/90">{book.publishedDate || "—"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pages:</span>{" "}
                    <span className="text-foreground/90">
                      {typeof book.pageCount === "number" ? book.pageCount : "—"}
                    </span>
                  </div>
                </div>
              )}

              {book.description && (
                <div className="pt-2">
                  <div className="text-sm text-muted-foreground">Description</div>
                  <div className="text-sm leading-relaxed mt-1 whitespace-pre-wrap">
                    {book.description}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div id="notes" className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Notes</h2>
          </div>
          <div className="p-6 space-y-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={8}
              className="w-full p-4 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none resize-y"
              placeholder="Paste highlights, your own summary, or key passages here. AI will use notes (or the Google Books description) when available; otherwise it generates from title/author (less accurate)."
            />

            <div className="flex items-center justify-end">
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className="px-5 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
              >
                {savingNotes ? "Saving…" : "Save notes"}
              </button>
            </div>
          </div>
        </div>

        {genError && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
            {genError}
          </div>
        )}

        <div className="animate-fade-in-up delay-300 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Summary suite</h2>
          </div>

          <div className="p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["tldr", "concise", "deep", "skimmable"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setActiveSummary(k)}
                  className={`px-4 py-2 rounded-lg border text-sm transition ${
                    activeSummary === k
                      ? "bg-primary/15 border-primary/30 text-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {k.toUpperCase()}
                </button>
              ))}

              <button
                onClick={() => generateSummary(activeSummary)}
                disabled={generating !== null}
                className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
              >
                {generating === summaryKindKey ? "Generating…" : "Generate"}
              </button>
            </div>

            {!summary ? (
              <div className="text-sm text-muted-foreground">
                No {activeSummary.toUpperCase()} summary yet.
              </div>
            ) : (
              <div className="space-y-3">
                {aiOutputs[summaryKindKey]?.model && (
                  <div className="text-xs text-muted-foreground">
                    Model: {aiOutputs[summaryKindKey]?.model}
                  </div>
                )}

                {activeSummary === "tldr" && (
                  <div className="space-y-3">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {summary.tldr}
                    </div>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {(summary.bullets || []).map((b: string, idx: number) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeSummary === "concise" && (
                  <div className="space-y-3">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {summary.summary}
                    </div>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {(summary.bullets || []).map((b: string, idx: number) => (
                        <li key={idx}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeSummary === "deep" && (
                  <div className="space-y-4">
                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                      {summary.overview}
                    </div>

                    <div className="space-y-3">
                      {(summary.sections || []).map((s: any, idx: number) => (
                        <div key={idx} className="rounded-xl border border-border/60 bg-card/40 p-4">
                          <div className="font-semibold text-sm">{s.heading}</div>
                          <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                            {s.summary}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="text-sm font-semibold">Key insights</div>
                      <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                        {(summary.keyInsights || []).map((b: string, idx: number) => (
                          <li key={idx}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {activeSummary === "skimmable" && (
                  <div className="space-y-4">
                    <div className="text-sm font-semibold">{summary.headline}</div>
                    <div className="space-y-3">
                      {(summary.sections || []).map((s: any, idx: number) => (
                        <div key={idx} className="rounded-xl border border-border/60 bg-card/40 p-4">
                          <div className="font-semibold text-sm">{s.heading}</div>
                          <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                            {(s.bullets || []).map((b: string, bIdx: number) => (
                              <li key={bIdx}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Takeaways & themes</h2>
            <button
              onClick={() => generateSimple("/ai/takeaways-themes", "takeaways_themes")}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "takeaways_themes" ? "Generating…" : "Generate"}
            </button>
          </div>
          <div className="p-6">
            {aiOutputs.takeaways_themes ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-semibold">Themes</div>
                  <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                    {(aiOutputs.takeaways_themes.payload.themes || []).map((t: string, idx: number) => (
                      <li key={idx}>{t}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-sm font-semibold">Key takeaways</div>
                  <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                    {(aiOutputs.takeaways_themes.payload.takeaways || []).map((t: string, idx: number) => (
                      <li key={idx}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No takeaways yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Philosophical angles</h2>
            <button
              onClick={() => generateSimple("/ai/philosophy", "philosophical_angles")}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "philosophical_angles" ? "Generating…" : "Generate"}
            </button>
          </div>
          <div className="p-6 space-y-6">
            {aiOutputs.philosophical_angles ? (
              <>
                <div className="space-y-3">
                  {(aiOutputs.philosophical_angles.payload.angles || []).map((a: any, idx: number) => (
                    <div key={idx} className="rounded-xl border border-border/60 bg-card/40 p-4">
                      <div className="font-semibold text-sm">{a.lens}</div>
                      <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.angle}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="text-sm font-semibold">Reflection questions</div>
                  <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                    {(aiOutputs.philosophical_angles.payload.questions || []).map((q: string, idx: number) => (
                      <li key={idx}>{q}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No philosophical angles yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Quote className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Quote extraction</h2>
            <button
              onClick={() => generateSimple("/ai/quotes", "quote_extraction")}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "quote_extraction" ? "Extracting…" : "Extract"}
            </button>
          </div>
          <div className="p-6 space-y-4">
            {aiOutputs.quote_extraction ? (
              <>
                {aiOutputs.quote_extraction.payload.note && (
                  <div className="text-sm text-muted-foreground">
                    {aiOutputs.quote_extraction.payload.note}
                  </div>
                )}

                {(aiOutputs.quote_extraction.payload.quotes || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground">No direct quotes found in the source text.</div>
                ) : (
                  <div className="space-y-3">
                    {(aiOutputs.quote_extraction.payload.quotes || []).map((q: any, idx: number) => (
                      <div key={idx} className="rounded-xl border border-border/60 bg-card/40 p-4">
                        <div className="text-sm font-semibold whitespace-pre-wrap">“{q.quote}”</div>
                        <div className="mt-2 text-xs text-muted-foreground">Context: {q.context}</div>
                        <div className="mt-1 text-xs text-muted-foreground">Why it matters: {q.whyItMatters}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No quotes yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">What should I apply first?</h2>
            <button
              onClick={() => generateSimple("/ai/apply-first", "apply_first", { goal: applyGoal || undefined })}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "apply_first" ? "Generating…" : "Generate"}
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Your goal (optional)
                </label>
                <input
                  value={applyGoal}
                  onChange={(e) => setApplyGoal(e.target.value)}
                  className="w-full p-3 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none"
                  placeholder="e.g. build better habits, reduce anxiety, improve focus"
                />
              </div>
            </div>

            {aiOutputs.apply_first ? (
              <div className="space-y-3">
                {(aiOutputs.apply_first.payload.topActions || []).map((a: any, idx: number) => (
                  <div key={idx} className="rounded-xl border border-border/60 bg-card/40 p-4">
                    <div className="font-semibold text-sm">{idx + 1}. {a.action}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{a.why}</div>
                    <div className="mt-2 text-sm">
                      <span className="text-muted-foreground">First step:</span>{" "}
                      <span className="text-foreground/90">{a.firstStep}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No apply-first advice yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Recommendations</h2>
            <button
              onClick={() => generateSimple("/ai/recommendations", "recommendations")}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "recommendations" ? "Generating…" : "Generate"}
            </button>
          </div>

          <div className="p-6 space-y-4">
            {aiOutputs.recommendations ? (
              <>
                {aiOutputs.recommendations.payload.note && (
                  <div className="text-sm text-muted-foreground">
                    {aiOutputs.recommendations.payload.note}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(aiOutputs.recommendations.payload.recommendations || []).map((r: any, idx: number) => (
                    <div
                      key={idx}
                      className="rounded-2xl border border-border/60 bg-card/40 p-4 flex gap-4"
                    >
                      <div className="w-20 shrink-0">
                        <div className="aspect-[3/4]">
                          <BookCover
                            src={r.coverImageUrl || null}
                            alt={`${r.title} cover`}
                          />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <div>
                          <div className="font-semibold text-sm leading-snug">{r.title}</div>
                          {r.author && (
                            <div className="text-xs text-muted-foreground truncate">{r.author}</div>
                          )}
                        </div>

                        <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {r.reason}
                        </div>

                        {Array.isArray(r.whatToCompare) && r.whatToCompare.length > 0 && (
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                              What to compare
                            </div>
                            <ul className="list-disc pl-5 text-sm space-y-1 mt-1">
                              {r.whatToCompare.slice(0, 6).map((t: string, tIdx: number) => (
                                <li key={tIdx}>{t}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {r.previewLink && (
                          <a
                            href={r.previewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-primary hover:underline"
                          >
                            Preview
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No recommendations yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Author background</h2>
            <button
              onClick={() => generateSimple("/ai/author-background", "author_background")}
              disabled={generating !== null}
              className="ml-auto px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
            >
              {generating === "author_background" ? "Generating…" : "Generate"}
            </button>
          </div>

          <div className="p-6 space-y-5">
            {aiOutputs.author_background ? (
              <>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {aiOutputs.author_background.payload.authorSnapshot}
                </div>

                <div>
                  <div className="text-sm font-semibold">Common themes</div>
                  <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                    {(aiOutputs.author_background.payload.commonThemes || []).map(
                      (t: string, idx: number) => (
                        <li key={idx}>{t}</li>
                      )
                    )}
                  </ul>
                </div>

                {Array.isArray(aiOutputs.author_background.payload.suggestedNextReads) &&
                  aiOutputs.author_background.payload.suggestedNextReads.length > 0 && (
                    <div>
                      <div className="text-sm font-semibold">Suggested next reads</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                        {aiOutputs.author_background.payload.suggestedNextReads.map(
                          (r: any, idx: number) => (
                            <div
                              key={idx}
                              className="rounded-2xl border border-border/60 bg-card/40 p-4 flex gap-4"
                            >
                              <div className="w-16 shrink-0">
                                <div className="aspect-[3/4]">
                                  <BookCover
                                    src={r.coverImageUrl || null}
                                    alt={`${r.title} cover`}
                                  />
                                </div>
                              </div>

                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="font-semibold text-sm leading-snug">{r.title}</div>
                                <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                                  {r.why}
                                </div>
                                {r.previewLink && (
                                  <a
                                    href={r.previewLink}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-primary hover:underline"
                                  >
                                    Preview
                                  </a>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                {aiOutputs.author_background.payload.note && (
                  <div className="text-sm text-muted-foreground">
                    {aiOutputs.author_background.payload.note}
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No author background yet.</div>
            )}
          </div>
        </div>

        <div className="animate-fade-in-up delay-400 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Compare</h2>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <select
                value={compareWith}
                onChange={(e) => setCompareWith(e.target.value)}
                className="px-3 py-2 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none text-sm"
                disabled={shelfBooks.filter((b) => b.id !== bookId).length === 0}
                aria-label="Compare with"
              >
                {shelfBooks
                  .filter((b) => b.id !== bookId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title} — {b.author}
                    </option>
                  ))}
              </select>

              <button
                onClick={generateCompare}
                disabled={generating !== null || !compareWith}
                className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
              >
                {generating === (compareKindKey || "") ? "Comparing…" : "Compare"}
              </button>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {shelfBooks.filter((b) => b.id !== bookId).length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Add at least one more book to compare.
              </div>
            ) : comparePayload ? (
              <>
                <div>
                  <div className="text-sm font-semibold">Similarities</div>
                  <ul className="list-disc pl-5 text-sm space-y-1 mt-2">
                    {(comparePayload.similarities || []).map((s: string, idx: number) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-sm font-semibold">Differences</div>
                  <div className="space-y-3 mt-3">
                    {(comparePayload.differences || []).map((d: any, idx: number) => (
                      <div key={idx} className="rounded-2xl border border-border/60 bg-card/40 p-4">
                        <div className="font-semibold text-sm">{d.dimension}</div>
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground">Book A</div>
                            <div className="mt-1 text-muted-foreground whitespace-pre-wrap">{d.bookA}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wider text-muted-foreground">Book B</div>
                            <div className="mt-1 text-muted-foreground whitespace-pre-wrap">{d.bookB}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold">Who should read which?</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                    {comparePayload.whoShouldReadWhich}
                  </div>
                </div>

                <div>
                  <div className="text-sm font-semibold">If reading both</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                    {comparePayload.ifReadingBoth}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No comparison yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
