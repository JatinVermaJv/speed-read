export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface Passage {
  id: string;
  title: string;
  content: string;
  wordCount: number;
  category: string;
  isDefault: boolean;
  userId: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  passageId: string | null;
  passageTitle?: string;
  startWpm: number;
  endWpm: number;
  wpmIncrement: number;
  incrementIntervalSec: number;
  totalWordsRead: number;
  durationSec: number;
  stoppedByUser: boolean;
  createdAt: string;
}

export interface SessionStats {
  totalSessions: number;
  totalWordsRead: number;
  bestWpm: number;
  averageWpm: number;
  wpmOverTime: { date: string; wpm: number }[];
}

export interface AuthTokens {
  accessToken: string;
  user: User;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface UnseenPassageSummary {
  id: string;
  title: string;
  theme: string;
  wordCount: number;
  difficultyKey: string;
  timeLimitSec: number;
  sourceType: string;
  isPublished: boolean;
  isOwnedByUser?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface UnseenAttemptState {
  id: string;
  status: string;
  attemptNumber: number;
  startedAt: string;
  passageExpiresAt: string;
  submittedAt: string | null;
  scorePercent: number | null;
  totalQuestions: number | null;
  correctAnswers: number | null;
  durationSec: number | null;
}

export interface UnseenAttemptLog {
  id: string;
  unseenPassageId: string;
  title: string;
  theme: string;
  difficultyKey: string;
  sourceType: string;
  attemptNumber: number;
  status: string;
  scorePercent: number | null;
  totalQuestions: number | null;
  correctAnswers: number | null;
  durationSec: number | null;
  startedAt: string;
  passageExpiresAt: string;
  submittedAt: string | null;
  createdAt: string;
}

export interface UnseenQuestionOption {
  id: string;
  text: string;
  orderIndex: number;
  isCorrect?: boolean;
}

export interface UnseenQuestion {
  id: string;
  prompt: string;
  explanation: string | null;
  orderIndex: number;
  selectedOptionId?: string | null;
  correctOptionId?: string | null;
  isCorrect?: boolean;
  options: UnseenQuestionOption[];
}

// ─── Language Learning (Duolingo-MVP) ───────────────────────────────────────

export interface LanguageCourse {
  id: string;
  templateId?: string | null;
  userId: string;
  targetLanguageCode: string;
  level: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LanguageLessonSummary {
  id: string;
  courseId: string;
  orderIndex: number;
  title: string;
  objective: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface LanguageVocabItem {
  id: string;
  orderIndex: number;
  term: string;
  translation: string;
  partOfSpeech: string | null;
  targetExample: string | null;
  nativeExample: string | null;
}

export interface LanguageExerciseOption {
  id: string;
  text: string;
  orderIndex: number;
  isCorrect?: boolean;
}

export interface LanguageExercise {
  id: string;
  type: string;
  orderIndex: number;
  prompt: string;
  options: LanguageExerciseOption[];
  selectedOptionId?: string | null;
  typedText?: string | null;
  correctOptionId?: string | null;
  correctTerm?: string;
  correctTranslation?: string;
  isCorrect?: boolean;
}

export interface LanguageAttemptState {
  id: string;
  status: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  scorePercent: number | null;
  totalQuestions: number | null;
  correctAnswers: number | null;
  durationSec: number | null;
}

export interface LanguageAttemptLog {
  id: string;
  lessonId: string;
  attemptNumber: number;
  status: string;
  scorePercent: number | null;
  totalQuestions: number | null;
  correctAnswers: number | null;
  durationSec: number | null;
  startedAt: string;
  submittedAt: string | null;
  createdAt: string;
  lessonTitle: string;
  courseTitle: string;
  targetLanguageCode: string;
  level: string;
}

// ─── Book Store ───────────────────────────────────────────────────────────

export type BookStatus = "to_read" | "reading" | "finished" | "abandoned";

export interface Book {
  id: string;
  userId: string;
  title: string;
  author: string;
  status: BookStatus;
  rating: number | null;
  notes: string | null;

  googleVolumeId: string | null;
  coverImageUrl: string | null;
  description: string | null;
  categories: string | null;
  publishedDate: string | null;
  pageCount: number | null;
  publisher: string | null;
  language: string | null;
  previewLink: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface BookAiOutput {
  kind: string;
  payload: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}
