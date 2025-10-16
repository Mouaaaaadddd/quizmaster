export enum SessionState {
  CONFIGURING_QUIZ,
  GENERATING_QUIZ,
  TAKING_QUIZ,
  SUBMITTING_QUIZ,
  REVIEWING_QUIZ,
  ERROR,
}

export enum QuizType {
  SINGLE = 'Réponse Unique',
  MULTIPLE = 'Réponses Multiples',
  MIXED = 'Mixte',
}

export interface Option {
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  questionText: string;
  options: Option[];
  type: 'single' | 'multiple';
}

export interface UserAnswers {
  [questionId: string]: string[];
}

export interface QuizResult {
  questionText: string;
  userAnswer: string[];
  correctAnswer: string[];
  isCorrect: boolean;
  feedbackFR: string;
  feedbackAR: string;
}

export interface CorrectionResponse {
    results: QuizResult[];
    weakTopics: string;
}

export interface DocumentSession {
  id: string;
  fileName: string;
  content: string;
  quizType: QuizType;
  numQuestions: number;
  questions: Question[];
  userAnswers: UserAnswers;
  correction: CorrectionResponse | null;
  weakTopics?: string;
  lastAccessed: number;
  state: SessionState;
  error?: string | null;
}
