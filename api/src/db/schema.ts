import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 255 }).notNull(),
  googleId: varchar("google_id", { length: 255 }).unique(),
  avatarUrl: text("avatar_url"),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const passages = pgTable("passages", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count").notNull(),
  category: varchar("category", { length: 100 }).notNull().default("General"),
  isDefault: boolean("is_default").notNull().default(false),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  passageId: uuid("passage_id").references(() => passages.id, {
    onDelete: "set null",
  }),
  startWpm: integer("start_wpm").notNull().default(200),
  endWpm: integer("end_wpm").notNull(),
  wpmIncrement: integer("wpm_increment").notNull().default(25),
  incrementIntervalSec: integer("increment_interval_sec").notNull().default(30),
  totalWordsRead: integer("total_words_read").notNull(),
  durationSec: integer("duration_sec").notNull(),
  stoppedByUser: boolean("stopped_by_user").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const difficultyLevels = pgTable("difficulty_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  defaultTimeLimitSec: integer("default_time_limit_sec").notNull().default(180),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const unseenPassages = pgTable("unseen_passages", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count").notNull(),
  theme: varchar("theme", { length: 200 }).notNull().default("General"),
  keywords: text("keywords"),
  difficultyKey: varchar("difficulty_key", { length: 50 })
    .notNull()
    .references(() => difficultyLevels.key, { onDelete: "restrict" }),
  timeLimitSec: integer("time_limit_sec").notNull().default(180),
  isPublished: boolean("is_published").notNull().default(true),
  sourceType: varchar("source_type", { length: 20 }).notNull().default("manual"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const unseenQuestions = pgTable("unseen_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  unseenPassageId: uuid("unseen_passage_id")
    .notNull()
    .references(() => unseenPassages.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  explanation: text("explanation"),
  orderIndex: integer("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const unseenQuestionOptions = pgTable("unseen_question_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => unseenQuestions.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  isCorrect: boolean("is_correct").notNull().default(false),
  orderIndex: integer("order_index").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const unseenAttempts = pgTable("unseen_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  unseenPassageId: uuid("unseen_passage_id")
    .notNull()
    .references(() => unseenPassages.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  isRetry: boolean("is_retry").notNull().default(false),
  status: varchar("status", { length: 30 }).notNull().default("in_progress"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  passageExpiresAt: timestamp("passage_expires_at").notNull(),
  submittedAt: timestamp("submitted_at"),
  scorePercent: integer("score_percent"),
  totalQuestions: integer("total_questions"),
  correctAnswers: integer("correct_answers"),
  durationSec: integer("duration_sec"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const unseenAttemptAnswers = pgTable("unseen_attempt_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => unseenAttempts.id, { onDelete: "cascade" }),
  questionId: uuid("question_id")
    .notNull()
    .references(() => unseenQuestions.id, { onDelete: "cascade" }),
  selectedOptionId: uuid("selected_option_id").references(() => unseenQuestionOptions.id, {
    onDelete: "set null",
  }),
  isCorrect: boolean("is_correct").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiGenerationUsage = pgTable("ai_generation_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  feature: varchar("feature", { length: 40 }).notNull().default("unseen"),
  theme: varchar("theme", { length: 200 }).notNull(),
  keywords: text("keywords"),
  model: varchar("model", { length: 120 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("success"),
  errorMessage: text("error_message"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Book Store ───────────────────────────────────────────────────────────

export const books = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  author: varchar("author", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("to_read"),
  rating: integer("rating"),
  notes: text("notes"),

  // Google Books metadata (optional; safe-fail)
  googleVolumeId: varchar("google_volume_id", { length: 120 }),
  coverImageUrl: text("cover_image_url"),
  description: text("description"),
  categories: text("categories"),
  publishedDate: varchar("published_date", { length: 40 }),
  pageCount: integer("page_count"),
  publisher: varchar("publisher", { length: 255 }),
  language: varchar("language", { length: 20 }),
  previewLink: text("preview_link"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const bookAiOutputs = pgTable(
  "book_ai_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 60 }).notNull(),
    payload: text("payload").notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    bookKindUnique: uniqueIndex("book_ai_outputs_book_kind_unique").on(t.bookId, t.kind),
  })
);

// ─── Language Learning (Duolingo-MVP) ───────────────────────────────────────

// Admin-created global templates (published to all users)

export const languageCourseTemplates = pgTable("language_course_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  targetLanguageCode: varchar("target_language_code", { length: 20 }).notNull(),
  level: varchar("level", { length: 20 }).notNull().default("A1"),
  title: varchar("title", { length: 255 }).notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const languageLessonTemplates = pgTable("language_lesson_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseTemplateId: uuid("course_template_id")
    .notNull()
    .references(() => languageCourseTemplates.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  title: varchar("title", { length: 255 }).notNull(),
  objective: text("objective").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const languageVocabTemplateItems = pgTable("language_vocab_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonTemplateId: uuid("lesson_template_id")
    .notNull()
    .references(() => languageLessonTemplates.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  term: varchar("term", { length: 255 }).notNull(),
  translation: varchar("translation", { length: 255 }).notNull(),
  partOfSpeech: varchar("part_of_speech", { length: 60 }),
  targetExample: text("target_example"),
  nativeExample: text("native_example"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const languageCourses = pgTable("language_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").references(() => languageCourseTemplates.id, {
    onDelete: "set null",
  }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  targetLanguageCode: varchar("target_language_code", { length: 20 }).notNull(),
  level: varchar("level", { length: 20 }).notNull().default("A1"),
  title: varchar("title", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const languageLessons = pgTable("language_lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => languageCourses.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  title: varchar("title", { length: 255 }).notNull(),
  objective: text("objective").notNull(),
  status: varchar("status", { length: 30 }).notNull().default("locked"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const languageVocabItems = pgTable("language_vocab_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => languageLessons.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  term: varchar("term", { length: 255 }).notNull(),
  translation: varchar("translation", { length: 255 }).notNull(),
  partOfSpeech: varchar("part_of_speech", { length: 60 }),
  targetExample: text("target_example"),
  nativeExample: text("native_example"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const languageExercises = pgTable("language_exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => languageLessons.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  prompt: text("prompt").notNull(),
  vocabItemId: uuid("vocab_item_id")
    .notNull()
    .references(() => languageVocabItems.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const languageExerciseOptions = pgTable("language_exercise_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => languageExercises.id, { onDelete: "cascade" }),
  vocabItemId: uuid("vocab_item_id")
    .notNull()
    .references(() => languageVocabItems.id, { onDelete: "cascade" }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const languageAttempts = pgTable("language_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => languageLessons.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: varchar("status", { length: 30 }).notNull().default("in_progress"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  submittedAt: timestamp("submitted_at"),
  scorePercent: integer("score_percent"),
  totalQuestions: integer("total_questions"),
  correctAnswers: integer("correct_answers"),
  durationSec: integer("duration_sec"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const languageAttemptAnswers = pgTable("language_attempt_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => languageAttempts.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id")
    .notNull()
    .references(() => languageExercises.id, { onDelete: "cascade" }),
  selectedOptionId: uuid("selected_option_id").references(() => languageExerciseOptions.id, {
    onDelete: "set null",
  }),
  typedText: text("typed_text"),
  isCorrect: boolean("is_correct").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
