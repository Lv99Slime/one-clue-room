import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  cleanClue,
  cleanGuess,
  cleanPlayerName,
  cleanRoomCode,
  findDuplicateClueKeys,
  normalizeClue,
  scoreLabel,
  type GamePhase,
  type GuessOutcome,
  type JoinPayload,
  type JoinResult,
  type PlayerRole,
  type PublicClue,
  type PublicPlayer,
  type RoomView,
  type Wordbank,
  type WordItem
} from "../src/shared/game.js";

interface Player {
  id: string;
  socketId: string | null;
  name: string;
  role: PlayerRole;
  connected: boolean;
  isHost: boolean;
}

interface ClueEntry {
  playerId: string;
  text: string;
  hidden: boolean;
  duplicate: boolean;
}

interface Round {
  answer: WordItem;
  guesserId: string;
  clues: Map<string, ClueEntry>;
  result?: {
    answer: string;
    guess: string;
    outcome: GuessOutcome;
  };
}

interface Room {
  code: string;
  players: Map<string, Player>;
  phase: GamePhase;
  hostId: string | null;
  wordbankId: string;
  deck: WordItem[];
  usedAnswers: Set<string>;
  roundNumber: number;
  totalRounds: number;
  score: number;
  guesserCursor: number;
  currentRound?: Round;
  createdAt: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173"
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const wordbanks = loadWordbanks();
const rooms = new Map<string, Room>();
const socketRooms = new Map<string, { code: string; playerId: string }>();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("/api/wordbanks", (_req, res) => {
  res.json(wordbanks.map(({ id, name, language, words }) => ({ id, name, language, count: words.length })));
});

app.get("/api/wordbanks/:id", (req, res) => {
  const bank = wordbanks.find((item) => item.id === req.params.id);
  if (!bank) return res.status(404).json({ error: "Wordbank not found." });
  return res.json(bank);
});

const distPath = join(process.cwd(), "dist");
app.use(express.static(distPath));
app.get(/.*/, (_req, res) => {
  res.sendFile(join(distPath, "index.html"), (error) => {
    if (error) res.status(404).send("One Clue Room development server is running.");
  });
});

io.on("connection", (socket) => {
  socket.on("room:create", (payload: JoinPayload, ack?: (result: JoinResult) => void) => {
    const name = cleanPlayerName(payload.name);
    if (!name && payload.role === "player") return ack?.({ ok: false, error: "Name is required." });

    const code = createUniqueCode();
    const playerId = createId();
    const room = createRoom(code, payload.wordbankId);
    const player = createPlayer(playerId, socket.id, name || "Spectator", payload.role, true);
    room.players.set(player.id, player);
    room.hostId = player.id;
    rooms.set(code, room);
    bindSocket(socket.id, code, player.id);
    ack?.({ ok: true, code, playerId });
    emitRoom(room);
  });

  socket.on("room:join", (payload: JoinPayload, ack?: (result: JoinResult) => void) => {
    const code = cleanRoomCode(payload.code ?? "");
    const room = rooms.get(code);
    if (!room) return ack?.({ ok: false, error: "Room not found." });

    const name = cleanPlayerName(payload.name);
    if (!name && payload.role === "player") return ack?.({ ok: false, error: "Name is required." });

    const existing = findPlayerByName(room, name || "Spectator", payload.role);
    const player = existing ?? createPlayer(createId(), null, name || "Spectator", payload.role, false);
    player.socketId = socket.id;
    player.connected = true;
    player.role = payload.role;
    if (!room.hostId && player.role === "player") {
      player.isHost = true;
      room.hostId = player.id;
    }
    room.players.set(player.id, player);
    bindSocket(socket.id, code, player.id);
    ack?.({ ok: true, code, playerId: player.id });
    emitRoom(room);
  });

  socket.on("wordbank:set", (payload: { wordbankId: string }) => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room || room.phase !== "lobby" || !isHost(room, context.playerId)) return;
    if (!wordbanks.some((bank) => bank.id === payload.wordbankId)) return;
    room.wordbankId = payload.wordbankId;
    room.deck = shuffledDeck(payload.wordbankId);
    emitRoom(room);
  });

  socket.on("game:start", () => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room || !isHost(room, context.playerId)) return;
    if (activePlayers(room).length < 3) {
      emitRoom(room, "Need at least 3 active players.");
      return;
    }
    resetGame(room);
    startRound(room);
    emitRoom(room);
  });

  socket.on("clue:submit", (payload: { clue: string }) => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room?.currentRound || room.phase !== "clue-submit") return;
    const player = room.players.get(context.playerId);
    if (!player || player.role !== "player" || player.id === room.currentRound.guesserId) return;

    const clue = cleanClue(payload.clue);
    if (!normalizeClue(clue)) return;
    room.currentRound.clues.set(player.id, {
      playerId: player.id,
      text: clue,
      hidden: false,
      duplicate: false
    });
    updateDuplicateFlags(room.currentRound);
    if (room.currentRound.clues.size >= expectedClues(room)) {
      room.phase = "clue-review";
    }
    emitRoom(room);
  });

  socket.on("clue:toggleHidden", (payload: { playerId: string; hidden: boolean }) => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room?.currentRound || room.phase !== "clue-review") return;
    const actor = room.players.get(context.playerId);
    if (!actor || actor.role !== "player" || actor.id === room.currentRound.guesserId) return;
    const clue = room.currentRound.clues.get(payload.playerId);
    if (!clue) return;
    clue.hidden = Boolean(payload.hidden);
    emitRoom(room);
  });

  socket.on("phase:reveal", () => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room?.currentRound || room.phase !== "clue-review") return;
    const actor = room.players.get(context.playerId);
    if (!actor || actor.role !== "player" || actor.id === room.currentRound.guesserId) return;
    room.phase = "guessing";
    emitRoom(room);
  });

  socket.on("guess:submit", (payload: { guess: string; outcome?: GuessOutcome }) => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room?.currentRound || room.phase !== "guessing") return;
    if (room.currentRound.guesserId !== context.playerId && !isHost(room, context.playerId)) return;

    const guess = cleanGuess(payload.guess);
    const outcome = payload.outcome ?? decideOutcome(guess, room.currentRound.answer.answer);
    if (outcome === "correct") room.score += 1;
    if (outcome === "wrong") burnPenaltyCard(room);
    room.currentRound.result = {
      answer: room.currentRound.answer.answer,
      guess: guess || outcome,
      outcome
    };
    room.phase = room.roundNumber >= room.totalRounds ? "game-over" : "round-result";
    emitRoom(room, room.phase === "game-over" ? scoreLabel(room.score, room.totalRounds) : undefined);
  });

  socket.on("round:next", () => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room || !isHost(room, context.playerId)) return;
    if (room.phase !== "round-result") return;
    startRound(room);
    emitRoom(room);
  });

  socket.on("game:restart", () => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room || !isHost(room, context.playerId)) return;
    room.phase = "lobby";
    resetGame(room);
    room.currentRound = undefined;
    emitRoom(room);
  });

  socket.on("player:kick", (payload: { playerId: string }) => {
    const context = getSocketContext(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    if (!room || !isHost(room, context.playerId)) return;
    const player = room.players.get(payload.playerId);
    if (!player || player.isHost) return;
    room.players.delete(payload.playerId);
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const context = socketRooms.get(socket.id);
    if (!context) return;
    const room = rooms.get(context.code);
    const player = room?.players.get(context.playerId);
    if (room && player && player.socketId === socket.id) {
      player.connected = false;
      player.socketId = null;
      maybeTransferHost(room);
      emitRoom(room);
    }
    socketRooms.delete(socket.id);
  });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, () => {
  console.log(`One Clue Room server listening on http://127.0.0.1:${port}`);
});

function loadWordbanks(): Wordbank[] {
  const wordbankDir = join(process.cwd(), "server", "wordbanks");
  const paths = readdirSync(wordbankDir).filter((file) => file.endsWith(".json")).sort();
  return paths.map((file) => {
    const raw = readFileSync(join(wordbankDir, file), "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw) as Wordbank;
  });
}

function createRoom(code: string, wordbankId = wordbanks[0]?.id ?? "sample-en"): Room {
  return {
    code,
    players: new Map(),
    phase: "lobby",
    hostId: null,
    wordbankId,
    deck: shuffledDeck(wordbankId),
    usedAnswers: new Set(),
    roundNumber: 0,
    totalRounds: 13,
    score: 0,
    guesserCursor: -1,
    createdAt: Date.now()
  };
}

function createPlayer(id: string, socketId: string | null, name: string, role: PlayerRole, isHost: boolean): Player {
  return {
    id,
    socketId,
    name,
    role,
    connected: true,
    isHost
  };
}

function createUniqueCode(): string {
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
  } while (rooms.has(code));
  return code;
}

function createId(): string {
  return crypto.randomUUID();
}

function bindSocket(socketId: string, code: string, playerId: string): void {
  socketRooms.set(socketId, { code, playerId });
  void io.sockets.sockets.get(socketId)?.join(code);
}

function getSocketContext(socketId: string): { code: string; playerId: string } | undefined {
  return socketRooms.get(socketId);
}

function findPlayerByName(room: Room, name: string, role: PlayerRole): Player | undefined {
  return Array.from(room.players.values()).find((player) => player.name === name && player.role === role);
}

function isHost(room: Room, playerId: string): boolean {
  return room.hostId === playerId;
}

function activePlayers(room: Room): Player[] {
  return Array.from(room.players.values()).filter((player) => player.role === "player");
}

function expectedClues(room: Room): number {
  if (!room.currentRound) return 0;
  return activePlayers(room).filter((player) => player.id !== room.currentRound?.guesserId).length;
}


function resetGame(room: Room): void {
  room.deck = shuffledDeck(room.wordbankId);
  room.usedAnswers = new Set();
  room.roundNumber = 0;
  room.score = 0;
  room.guesserCursor = -1;
  room.currentRound = undefined;
}

function startRound(room: Room): void {
  const players = activePlayers(room);
  room.roundNumber += 1;
  room.guesserCursor = (room.guesserCursor + 1) % players.length;
  const guesser = players[room.guesserCursor];
  const answer = nextAnswer(room);
  room.currentRound = {
    answer,
    guesserId: guesser.id,
    clues: new Map()
  };
  room.phase = "clue-submit";
}

function nextAnswer(room: Room): WordItem {
  if (room.deck.length === 0) {
    room.deck = shuffledDeck(room.wordbankId).filter((word) => !room.usedAnswers.has(word.answer));
  }
  const answer = room.deck.shift() ?? { answer: "mystery", category: "Fallback" };
  room.usedAnswers.add(answer.answer);
  return answer;
}

function burnPenaltyCard(room: Room): void {
  if (room.roundNumber >= room.totalRounds) return;
  room.roundNumber += 1;
  void nextAnswer(room);
}

function shuffledDeck(wordbankId: string): WordItem[] {
  const bank = wordbanks.find((item) => item.id === wordbankId) ?? wordbanks[0];
  const deck = [...bank.words];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function updateDuplicateFlags(round: Round): void {
  const duplicateKeys = findDuplicateClueKeys(Array.from(round.clues.values()));
  for (const clue of round.clues.values()) {
    const duplicate = duplicateKeys.has(normalizeClue(clue.text));
    clue.duplicate = duplicate;
    if (duplicate) clue.hidden = true;
  }
}

function decideOutcome(guess: string, answer: string): GuessOutcome {
  if (!guess) return "pass";
  return normalizeClue(guess) === normalizeClue(answer) ? "correct" : "wrong";
}

function maybeTransferHost(room?: Room): void {
  if (!room || room.hostId && room.players.get(room.hostId)?.connected) return;
  const nextHost = activePlayers(room).find((player) => player.connected);
  for (const player of room.players.values()) player.isHost = false;
  if (nextHost) {
    nextHost.isHost = true;
    room.hostId = nextHost.id;
  } else {
    room.hostId = null;
  }
}

function emitRoom(room: Room, message?: string): void {
  for (const player of room.players.values()) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("room:state", buildRoomView(room, player.id, message));
  }
}

function buildRoomView(room: Room, viewerId: string | null, message?: string): RoomView {
  const currentRound = room.currentRound;
  const viewer = viewerId ? room.players.get(viewerId) : undefined;
  const viewerIsGuesser = Boolean(currentRound && viewerId === currentRound.guesserId);
  const viewerCanSeeAnswer =
    Boolean(currentRound) &&
    !viewerIsGuesser &&
    viewer?.role === "player" &&
    (room.phase === "clue-submit" || room.phase === "clue-review");
  const answerRevealed = room.phase === "round-result" || room.phase === "game-over";
  const cluesVisible =
    room.phase === "clue-review" ||
    room.phase === "guessing" ||
    room.phase === "round-result" ||
    room.phase === "game-over";
  const reviewMode = room.phase === "clue-review";

  return {
    code: room.code,
    phase: room.phase,
    players: publicPlayers(room),
    viewerId,
    hostId: room.hostId,
    guesserId: currentRound?.guesserId ?? null,
    roundNumber: room.roundNumber,
    totalRounds: room.totalRounds,
    score: room.score,
    submittedClues: currentRound?.clues.size ?? 0,
    expectedClues: expectedClues(room),
    wordbankId: room.wordbankId,
    wordbanks: wordbanks.map(({ id, name, language, words }) => ({ id, name, language, count: words.length })),
    currentWordbank: wordbanks.find((bank) => bank.id === room.wordbankId),
    category: viewerCanSeeAnswer || answerRevealed ? currentRound?.answer.category : undefined,
    answer: viewerCanSeeAnswer || answerRevealed ? currentRound?.answer.answer : undefined,
    clues: cluesVisible && currentRound ? publicClues(room, currentRound, reviewMode) : [],
    removedDuplicateClues: currentRound ? removedDuplicateClues(currentRound) : 0,
    result: currentRound?.result,
    message
  };
}

function publicPlayers(room: Room): PublicPlayer[] {
  return Array.from(room.players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    role: player.role,
    connected: player.connected,
    isHost: player.isHost,
    isGuesser: room.currentRound?.guesserId === player.id,
    hasSubmittedClue: room.currentRound?.clues.has(player.id) ?? false
  }));
}

function publicClues(room: Room, round: Round, reviewMode: boolean): PublicClue[] {
  return Array.from(round.clues.values())
    .filter((clue) => !clue.duplicate)
    .filter((clue) => reviewMode || !clue.hidden)
    .map((clue) => {
      const player = room.players.get(clue.playerId);
      return {
        playerId: clue.playerId,
        playerName: player?.name ?? "Unknown",
        text: clue.text,
        hidden: clue.hidden,
        duplicate: clue.duplicate
      };
    });
}

function removedDuplicateClues(round: Round): number {
  return Array.from(round.clues.values()).filter((clue) => clue.duplicate).length;
}











