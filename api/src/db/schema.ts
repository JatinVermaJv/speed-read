import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
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
  theme: varchar("theme", { length: 200 }).notNull(),
  keywords: text("keywords"),
  model: varchar("model", { length: 120 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("success"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
