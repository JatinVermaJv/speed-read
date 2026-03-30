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
