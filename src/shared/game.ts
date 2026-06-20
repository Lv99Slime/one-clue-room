export type GamePhase =
  | "lobby"
  | "clue-submit"
  | "clue-review"
  | "guessing"
  | "round-result"
  | "game-over";

export type GuessOutcome = "correct" | "wrong" | "pass";

export type PlayerRole = "player" | "spectator";

export interface WordItem {
  answer: string;
  category?: string;
}

export interface Wordbank {
  id: string;
  name: string;
  language: string;
  words: WordItem[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  connected: boolean;
  isHost: boolean;
  isGuesser: boolean;
  hasSubmittedClue: boolean;
}

export interface PublicClue {
  playerId: string;
  playerName: string;
  text: string;
  hidden: boolean;
  duplicate: boolean;
}

export interface RoundResult {
  answer: string;
  guess: string;
  outcome: GuessOutcome;
}

export interface RoomView {
  code: string;
  phase: GamePhase;
  players: PublicPlayer[];
  viewerId: string | null;
  hostId: string | null;
  guesserId: string | null;
  roundNumber: number;
  totalRounds: number;
  score: number;
  submittedClues: number;
  expectedClues: number;
  wordbankId: string;
  wordbanks: Array<Pick<Wordbank, "id" | "name" | "language"> & { count: number }>;
  currentWordbank?: Wordbank;
  category?: string;
  answer?: string;
  clues: PublicClue[];
  removedDuplicateClues: number;
  result?: RoundResult;
  message?: string;
}

export interface JoinPayload {
  code?: string;
  name: string;
  role: PlayerRole;
  wordbankId?: string;
}

export interface JoinResult {
  ok: boolean;
  code?: string;
  playerId?: string;
  error?: string;
}

const punctuationPattern = /[\p{P}\p{S}\s]/gu;

export function normalizeClue(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(punctuationPattern, "");
}

export function findDuplicateClueKeys(clues: Array<{ text: string }>): Set<string> {
  const counts = new Map<string, number>();

  for (const clue of clues) {
    const key = normalizeClue(clue.text);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
  );
}

export function scoreLabel(score: number, totalRounds: number): string {
  if (score === totalRounds) return "Perfect table. Zero nonsense, full teamwork.";
  if (score >= Math.ceil(totalRounds * 0.75)) return "Strong room. Some clues were too mainstream, but it worked.";
  if (score >= Math.ceil(totalRounds * 0.45)) return "Playable, but the clue discipline needs homework.";
  return "The room understood the assignment eventually. Maybe.";
}

export function cleanPlayerName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 24);
}

export function cleanRoomCode(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function cleanClue(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 40);
}

export function cleanGuess(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 80);
}




