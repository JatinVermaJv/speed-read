"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag, BookOpen, StickyNote, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import type { Book, BookStatus } from "@/types";

const STATUSES: BookStatus[] = ["to_read", "reading", "finished", "abandoned"];

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

function BookCover({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-secondary/40">
        <BookOpen className="w-10 h-10 text-muted-foreground" />
      </div>
    );
  }

  return (
    // Using plain img keeps it simple (no Next image domain config).
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function BookStorePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState<BookStatus>("to_read");
  const [rating, setRating] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  const fetchBooks = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data } = await api.get("/books");
      setBooks(data.books || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const canSubmit = useMemo(() => {
    return title.trim().length > 0 && author.trim().length > 0 && !submitting;
  }, [title, author, submitting]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    try {
      await api.post("/books", {
        title,
        author,
        status,
        rating: rating ? Number(rating) : undefined,
      });

      setTitle("");
      setAuthor("");
      setStatus("to_read");
      setRating("");

      await fetchBooks();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to add book");
    } finally {
      setSubmitting(false);
    }
  };

  const updateBookStatus = async (bookId: string, next: BookStatus) => {
    const prev = books;
    setBooks((current) =>
      current.map((b) => (b.id === bookId ? { ...b, status: next } : b))
    );

    try {
      await api.patch(`/books/${bookId}`, { status: next });
    } catch {
      setBooks(prev);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-10">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-extrabold tracking-tight">Book Store</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Add books, track status, and generate summaries.
          </p>
        </div>

        <div className="animate-fade-in-up delay-100 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60">
            <h2 className="text-lg font-semibold">Add a book</h2>
          </div>

          <form onSubmit={handleCreate} className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-3 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none"
                placeholder="e.g. Meditations"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
                Author
              </label>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full p-3 rounded-lg bg-card border border-border focus:ring-2 focus:ring-ring outline-none"
                placeholder="e.g. Marcus Aurelius"
              />
            </div>

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

            {error && (
              <div className="md:col-span-4 bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div className="md:col-span-4 flex items-center justify-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className="px-6 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow-lg shadow-primary/20 hover:brightness-110 transition-all disabled:opacity-50"
              >
                {submitting ? "Adding…" : "Add book"}
              </button>
            </div>
          </form>
        </div>

        <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-border/60 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your shelf</h2>
            <span className="text-sm text-muted-foreground">{books.length} books</span>
          </div>

          {loading ? (
            <div className="p-10 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : books.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No books yet — add your first one above.
            </div>
          ) : (
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {books.map((book) => (
                  <div
                    key={book.id}
                    className="group glow-card rounded-2xl overflow-hidden relative"
                  >
                    <div className="relative aspect-[3/4]">
                      <BookCover
                        src={book.coverImageUrl}
                        alt={`${book.title} cover`}
                      />

                      <div
                        className={`absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${statusBadgeClasses(
                          book.status
                        )}`}
                        title={formatStatus(book.status)}
                      >
                        <Flag className="w-3 h-3" />
                        <span className="hidden sm:inline">{formatStatus(book.status)}</span>
                      </div>

                      {/* Hover quick actions */}
                      <div className="absolute inset-x-0 bottom-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/bookstore/${book.id}`}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-background/70 border border-border/60 text-xs hover:bg-background transition"
                          >
                            <Sparkles className="w-3 h-3" />
                            Summary
                          </Link>
                          <Link
                            href={`/bookstore/${book.id}#notes`}
                            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-background/70 border border-border/60 text-xs hover:bg-background transition"
                          >
                            <StickyNote className="w-3 h-3" />
                            Notes
                          </Link>
                          <select
                            value={book.status}
                            onChange={(e) =>
                              updateBookStatus(book.id, e.target.value as BookStatus)
                            }
                            className="ml-auto px-2 py-2 rounded-lg bg-background/70 border border-border/60 text-xs outline-none"
                            aria-label="Change status"
                          >
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {formatStatus(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 space-y-1">
                      <div className="font-semibold text-sm leading-snug">{book.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{book.author}</div>
                      {typeof book.rating === "number" && (
                        <div className="text-xs text-muted-foreground">Rating: {book.rating}/5</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
