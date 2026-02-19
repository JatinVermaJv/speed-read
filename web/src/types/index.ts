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
  passageId: string;
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
