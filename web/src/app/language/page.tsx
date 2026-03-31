"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type {
  LanguageCourse,
  LanguageExercise,
  LanguageLessonSummary,
  LanguageVocabItem,
  LanguageAttemptState,
} from "@/types";
import { Loader2, Play, CircleCheck, CircleX } from "lucide-react";

type Stage = "catalog" | "lessons" | "flashcards" | "practice" | "result";

type LanguageCourseTemplate = {
  id: string;
  title: string;
  targetLanguageCode: string;
  level: string;
  lessonCount: number;
  createdAt?: string;
  updatedAt?: string;
};

type StartLessonResponse = {
  attempt: {
    id: string;
    status: string;
    attemptNumber: number;
    startedAt: string;
  };
  course: {
    id: string;
    title: string;
    targetLanguageCode: string;
    level: string;
  };
  lesson: {
    id: string;
    title: string;
    objective: string;
    status: string;
    orderIndex: number;
  };
  vocab: LanguageVocabItem[];
  exercises: LanguageExercise[];
};

type AttemptResultResponse = {
  attempt: LanguageAttemptState;
  course: {
    id: string;
    title: string;
    targetLanguageCode: string;
    level: string;
  };
  lesson: {
    id: string;
    title: string;
    objective: string;
    orderIndex: number;
  };
  exercises: LanguageExercise[];
};

type CatalogResponse = {
  templates: LanguageCourseTemplate[];
  courses: LanguageCourse[];
};

type CourseDetailResponse = {
  course: LanguageCourse;
  lessons: LanguageLessonSummary[];
};

type EnrollResponse = {
  enrolled: boolean;
  course: LanguageCourse;
  lessons: LanguageLessonSummary[];
};

function formatDuration(totalSec: number | null): string {
  if (!totalSec || totalSec <= 0) return "0s";
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

function speak(text: string, lang: string) {
  if (typeof window === "undefined") return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  try {
    synth.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;

    const voices = synth.getVoices();
    const normalizedLang = lang.trim().toLowerCase();
    const baseLang = normalizedLang.split("-")[0];

    const voice =
      voices.find((v) => v.lang?.toLowerCase() === normalizedLang) ||
      voices.find((v) => v.lang?.toLowerCase().startsWith(`${baseLang}-`)) ||
      null;

    if (voice) {
      utter.voice = voice;
    }

    synth.speak(utter);
  } catch {
    // no-op
  }
}

export default function LanguagePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>("catalog");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [startingLessonId, setStartingLessonId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [templates, setTemplates] = useState<LanguageCourseTemplate[]>([]);
  const [courses, setCourses] = useState<LanguageCourse[]>([]);

  const [course, setCourse] = useState<LanguageCourse | null>(null);
  const [lessons, setLessons] = useState<LanguageLessonSummary[]>([]);

  const [activeLesson, setActiveLesson] = useState<StartLessonResponse["lesson"] | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [lessonVocab, setLessonVocab] = useState<LanguageVocabItem[]>([]);
  const [lessonExercises, setLessonExercises] = useState<LanguageExercise[]>([]);

  const [cardIndex, setCardIndex] = useState(0);
  const [showMeaning, setShowMeaning] = useState(false);

  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [answers, setAnswers] = useState<
    Record<string, { selectedOptionId?: string | null; typedText?: string | null }>
  >({});

  const [result, setResult] = useState<AttemptResultResponse | null>(null);
  const activeCourseTargetLang = useMemo(
    () => result?.course.targetLanguageCode || course?.targetLanguageCode || "es-ES",
    [result, course]
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  const refreshCatalog = async () => {
    try {
      const { data } = await api.get("/language");
      const payload = data as CatalogResponse;

      setTemplates((payload.templates || []) as LanguageCourseTemplate[]);
      setCourses((payload.courses || []) as LanguageCourse[]);
    } catch {
      setError("Failed to load language courses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void refreshCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const startLongNotice = (message: string) => {
    setNotice(message);
    const timer = window.setTimeout(() => {
      setNotice("Still working…");
    }, 10_000);
    return () => window.clearTimeout(timer);
  };

  const refreshSelectedCourse = async () => {
    if (!course) return;

    try {
      const { data } = await api.get(`/language/courses/${course.id}`);
      const payload = data as CourseDetailResponse;
      setCourse(payload.course);
      setLessons((payload.lessons || []) as LanguageLessonSummary[]);
    } catch {
      setError("Failed to refresh course");
    }
  };

  const loadCourse = async (courseId: string) => {
    setBusy(`loadCourse:${courseId}`);
    setError("");
    setNotice("");
    setStartingLessonId(null);

    try {
      const { data } = await api.get(`/language/courses/${courseId}`);
      const payload = data as CourseDetailResponse;

      setCourse(payload.course);
      setLessons((payload.lessons || []) as LanguageLessonSummary[]);
      setStage("lessons");
    } catch {
      setError("Failed to load course");
    } finally {
      setBusy(null);
    }
  };

  const enrollTemplate = async (templateId: string) => {
    setBusy(`enroll:${templateId}`);
    setError("");
    setStartingLessonId(null);

    const stopTimer = startLongNotice("Enrolling… it’ll be ready shortly.");

    try {
      const { data } = await api.post("/language/enroll", {
        templateId,
      });
      const payload = data as EnrollResponse;

      setCourse(payload.course);
      setLessons((payload.lessons || []) as LanguageLessonSummary[]);
      setStage("lessons");
      setNotice("");

      await refreshCatalog();
    } catch {
      setError("Unable to enroll right now. Please retry.");
    } finally {
      stopTimer();
      setBusy(null);
    }
  };

  const backToCatalog = async () => {
    setStage("catalog");
    setCourse(null);
    setLessons([]);
    setActiveLesson(null);
    setAttemptId(null);
    setLessonVocab([]);
    setLessonExercises([]);
    setCardIndex(0);
    setExerciseIndex(0);
    setAnswers({});
    setResult(null);
    setNotice("");
    setError("");
    setStartingLessonId(null);

    await refreshCatalog();
  };

  const startLesson = async (lessonId: string) => {
    setBusy("startLesson");
    setStartingLessonId(lessonId);
    setError("");

    const stopTimer = startLongNotice("Preparing your lesson… it’ll be ready shortly.");

    try {
      const { data } = await api.post(`/language/lessons/${lessonId}/start`);
      const payload = data as StartLessonResponse;

      setActiveLesson(payload.lesson);
      setAttemptId(payload.attempt.id);
      setLessonVocab(payload.vocab || []);
      setLessonExercises(payload.exercises || []);

      setCardIndex(0);
      setShowMeaning(false);
      setExerciseIndex(0);
      setAnswers({});
      setResult(null);

      setNotice("");
      setStage("flashcards");
    } catch {
      setError("Unable to start lesson. Please retry shortly.");
    } finally {
      stopTimer();
      setStartingLessonId(null);
      setBusy(null);
    }
  };

  const submitAttempt = async () => {
    if (!attemptId) return;

    setBusy("submit");
    setError("");
    setNotice("Grading your answers…");

    try {
      await api.post(`/language/attempts/${attemptId}/submit`, {
        answers: lessonExercises.map((ex) => ({
          exerciseId: ex.id,
          selectedOptionId: answers[ex.id]?.selectedOptionId ?? null,
          typedText: answers[ex.id]?.typedText ?? null,
        })),
      });

      const { data } = await api.get(`/language/attempts/${attemptId}/result`);
      setResult(data as AttemptResultResponse);
      setStage("result");

      // Refresh lesson statuses (unlock next lesson)
      await refreshSelectedCourse();
      await refreshCatalog();
      setNotice("");
    } catch {
      setError("Unable to submit answers. Please retry.");
    } finally {
      setBusy(null);
    }
  };

  const resetToLessons = async () => {
    setActiveLesson(null);
    setAttemptId(null);
    setLessonVocab([]);
    setLessonExercises([]);
    setCardIndex(0);
    setExerciseIndex(0);
    setAnswers({});
    setResult(null);
    setNotice("");
    setError("");
    setStartingLessonId(null);
    setStage("lessons");

    await refreshSelectedCourse();
  };

  const activeCard = lessonVocab[cardIndex] || null;
  const currentExercise = lessonExercises[exerciseIndex] || null;

  const canProceedFlashcards = Boolean(lessonVocab.length > 0);

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
          <h1 className="text-3xl font-extrabold tracking-tight">Language Learning</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Minimal Duolingo-style drills powered by AI
          </p>
        </div>

        {(error || notice) && (
          <div className="animate-fade-in-up delay-100 glow-card rounded-2xl p-4">
            {notice && <div className="text-sm text-foreground">{notice}</div>}
            {error && <div className="text-sm text-destructive mt-2">{error}</div>}
          </div>
        )}

        {stage === "catalog" && (
          <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60">
              <h2 className="text-lg font-semibold">Choose a language</h2>
              <p className="text-muted-foreground text-sm mt-1">
                Courses are created and published by admins.
              </p>
            </div>

            <div className="p-6 space-y-8">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">Available languages</div>
                  <div className="text-xs text-muted-foreground">
                    {templates.length} course{templates.length === 1 ? "" : "s"}
                  </div>
                </div>

                {templates.length === 0 ? (
                  <div className="text-center text-muted-foreground py-10">
                    No published language courses yet.
                  </div>
                ) : (
                  templates.map((tpl) => {
                    const alreadyEnrolled = courses.some((c) => c.templateId === tpl.id);
                    const busyKey = `enroll:${tpl.id}`;

                    return (
                      <div
                        key={tpl.id}
                        className="rounded-2xl border border-border/60 bg-background/20 p-4 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground truncate">{tpl.title}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {tpl.targetLanguageCode} • {tpl.level} • {tpl.lessonCount} lessons
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => enrollTemplate(tpl.id)}
                          disabled={busy !== null || alreadyEnrolled}
                          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                        >
                          {busy === busyKey ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Enrolling…
                            </>
                          ) : alreadyEnrolled ? (
                            "Enrolled"
                          ) : (
                            "Enroll"
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">My courses</div>
                  <div className="text-xs text-muted-foreground">
                    {courses.length} enrolled
                  </div>
                </div>

                {courses.length === 0 ? (
                  <div className="text-center text-muted-foreground py-10">
                    You haven’t enrolled in any course yet.
                  </div>
                ) : (
                  courses.map((c) => {
                    const busyKey = `loadCourse:${c.id}`;

                    return (
                      <div
                        key={c.id}
                        className="rounded-2xl border border-border/60 bg-background/20 p-4 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-foreground truncate">{c.title}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {c.targetLanguageCode} • {c.level}
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Status: {c.status}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => loadCourse(c.id)}
                          disabled={busy !== null}
                          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                        >
                          {busy === busyKey ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading…
                            </>
                          ) : (
                            "Open"
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {stage === "lessons" && (
          <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{course?.title || "Your course"}</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Pick a lesson to start.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void backToCatalog()}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={busy !== null}
                >
                  Back to languages
                </button>
              </div>
            </div>

            <div className="p-6 space-y-3">
              {lessons.length === 0 ? (
                <div className="text-center text-muted-foreground py-10">
                  No lessons yet.
                </div>
              ) : (
                lessons.map((lesson) => {
                  const isLocked = lesson.status === "locked";
                  const isCompleted = lesson.status === "completed";

                  return (
                    <div
                      key={lesson.id}
                      className="rounded-2xl border border-border/60 bg-background/20 p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-foreground truncate">
                          {lesson.orderIndex}. {lesson.title}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {lesson.objective}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Status: {lesson.status}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => startLesson(lesson.id)}
                        disabled={busy !== null || isLocked}
                        className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                      >
                        {busy === "startLesson" && startingLessonId === lesson.id ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading…
                          </>
                        ) : isCompleted ? (
                          "Redo"
                        ) : (
                          "Start"
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {stage === "flashcards" && activeLesson && (
          <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">
                    Lesson {activeLesson.orderIndex}: {activeLesson.title}
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1">Flashcards</p>
                </div>
                <button
                  type="button"
                  onClick={resetToLessons}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={busy !== null}
                >
                  Back
                </button>
              </div>
            </div>

            <div className="p-6">
              {!canProceedFlashcards || !activeCard ? (
                <div className="text-center text-muted-foreground py-10">
                  No vocabulary found.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="text-xs text-muted-foreground">
                    {cardIndex + 1} / {lessonVocab.length}
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-background/20 p-6 text-center space-y-3">
                    <div className="text-4xl font-extrabold tracking-tight">
                      {activeCard.term}
                    </div>
                    {activeCard.partOfSpeech && (
                      <div className="text-xs text-muted-foreground">
                        {activeCard.partOfSpeech}
                      </div>
                    )}

                    {showMeaning ? (
                      <div className="text-lg text-foreground">{activeCard.translation}</div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowMeaning(true)}
                        className="text-sm text-primary hover:underline"
                      >
                        Show meaning
                      </button>
                    )}

                    <div className="pt-2 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => speak(activeCard.term, activeCourseTargetLang)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        <Play className="w-4 h-4" />
                        Play
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMeaning(false);
                        setCardIndex((prev) => Math.max(0, prev - 1));
                      }}
                      className="px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                      disabled={cardIndex === 0}
                    >
                      Prev
                    </button>

                    {cardIndex < lessonVocab.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setShowMeaning(false);
                          setCardIndex((prev) => {
                            const lastIndex = Math.max(0, lessonVocab.length - 1);
                            return Math.min(lastIndex, prev + 1);
                          });
                        }}
                        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setExerciseIndex(0);
                          setStage("practice");
                        }}
                        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        Start practice
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "practice" && activeLesson && (
          <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Practice</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Exercise {exerciseIndex + 1} / {lessonExercises.length}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetToLessons}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  disabled={busy !== null}
                >
                  Quit
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {!currentExercise ? (
                <div className="text-center text-muted-foreground py-10">
                  No exercises found.
                </div>
              ) : (
                <div className="space-y-5">
                  {currentExercise.type === "mcq" && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">Choose the meaning of:</div>
                      <div className="text-3xl font-extrabold tracking-tight">{currentExercise.prompt}</div>

                      <div className="grid gap-3">
                        {currentExercise.options.map((opt) => {
                          const selected = answers[currentExercise.id]?.selectedOptionId === opt.id;
                          return (
                            <button
                              type="button"
                              key={opt.id}
                              onClick={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [currentExercise.id]: {
                                    selectedOptionId: opt.id,
                                  },
                                }))
                              }
                              className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                                selected
                                  ? "border-primary bg-primary/10"
                                  : "border-border/60 bg-background/20 hover:bg-white/[0.02]"
                              }`}
                            >
                              {opt.text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {currentExercise.type === "listening" && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">Listen and choose the meaning:</div>

                      <button
                        type="button"
                        onClick={() => speak(currentExercise.prompt, activeCourseTargetLang)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        <Play className="w-4 h-4" />
                        Play audio
                      </button>

                      <div className="grid gap-3">
                        {currentExercise.options.map((opt) => {
                          const selected = answers[currentExercise.id]?.selectedOptionId === opt.id;
                          return (
                            <button
                              type="button"
                              key={opt.id}
                              onClick={() =>
                                setAnswers((prev) => ({
                                  ...prev,
                                  [currentExercise.id]: {
                                    selectedOptionId: opt.id,
                                  },
                                }))
                              }
                              className={`text-left px-4 py-3 rounded-xl border transition-colors ${
                                selected
                                  ? "border-primary bg-primary/10"
                                  : "border-border/60 bg-background/20 hover:bg-white/[0.02]"
                              }`}
                            >
                              {opt.text}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {currentExercise.type === "typing" && (
                    <div className="space-y-4">
                      <div className="text-sm text-muted-foreground">Type the word/phrase for:</div>
                      <div className="text-2xl font-bold">{currentExercise.prompt}</div>

                      <input
                        value={answers[currentExercise.id]?.typedText || ""}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [currentExercise.id]: {
                              typedText: e.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-xl bg-secondary border border-border px-4 py-3 text-sm"
                        placeholder="Type here…"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setExerciseIndex((prev) => Math.max(0, prev - 1))}
                      className="px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                      disabled={exerciseIndex === 0}
                    >
                      Prev
                    </button>

                    {exerciseIndex < lessonExercises.length - 1 ? (
                      <button
                        type="button"
                        onClick={() => setExerciseIndex((prev) => Math.min(lessonExercises.length - 1, prev + 1))}
                        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={submitAttempt}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all disabled:opacity-60"
                      >
                        {busy === "submit" ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Submitting…
                          </>
                        ) : (
                          "Submit"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "result" && result && (
          <div className="animate-fade-in-up delay-200 glow-card rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-border/60">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Result</h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    {result.course.title} • Lesson {result.lesson.orderIndex}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetToLessons}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to lessons
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="rounded-2xl border border-border/60 bg-background/20 p-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-3xl font-extrabold">
                    {result.attempt.scorePercent ?? 0}%
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {result.attempt.correctAnswers ?? 0} / {result.attempt.totalQuestions ?? 0} correct • {formatDuration(result.attempt.durationSec)}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  Attempt #{result.attempt.attemptNumber}
                </div>
              </div>

              <div className="space-y-3">
                {result.exercises.map((ex) => {
                  const selectedText =
                    ex.selectedOptionId && ex.options
                      ? ex.options.find((o) => o.id === ex.selectedOptionId)?.text || "-"
                      : "-";
                  const correctText = ex.correctTranslation || "-";

                  return (
                    <div
                      key={ex.id}
                      className="rounded-2xl border border-border/60 bg-background/20 p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold">
                            {ex.type.toUpperCase()} • {ex.prompt}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {ex.type === "typing" ? "Type the target word" : "Choose the correct meaning"}
                          </div>
                        </div>
                        <div className="shrink-0">
                          {ex.isCorrect ? (
                            <CircleCheck className="w-6 h-6 text-green-400" />
                          ) : (
                            <CircleX className="w-6 h-6 text-accent" />
                          )}
                        </div>
                      </div>

                      <div className="mt-4 text-sm">
                        {ex.type === "typing" ? (
                          <>
                            <div className="text-muted-foreground">Your answer</div>
                            <div className="font-mono text-foreground mt-1">
                              {ex.typedText || "-"}
                            </div>
                            <div className="text-muted-foreground mt-3">Correct</div>
                            <div className="font-mono text-primary mt-1">{ex.correctTerm}</div>
                          </>
                        ) : (
                          <>
                            <div className="text-muted-foreground">Your answer</div>
                            <div className="font-mono text-foreground mt-1">{selectedText}</div>
                            <div className="text-muted-foreground mt-3">Correct</div>
                            <div className="font-mono text-primary mt-1">{correctText}</div>
                          </>
                        )}
                      </div>

                      {ex.type === "listening" && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => speak(ex.correctTerm || ex.prompt, activeCourseTargetLang)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                          >
                            <Play className="w-4 h-4" />
                            Play
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
