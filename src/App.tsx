import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Socket } from "socket.io-client";
import {
  Check,
  Copy,
  Crown,
  DoorOpen,
  Link2,
  Eye,
  EyeOff,
  Play,
  RefreshCcw,
  Send,
  Shield,
  Users,
  X
} from "lucide-react";
import {
  cleanRoomCode,
  scoreLabel,
  type GamePhase,
  type GuessOutcome,
  type JoinResult,
  type PlayerRole,
  type RoomView
} from "./shared/game";

interface AppProps {
  socket: Socket;
}

const storedName = localStorage.getItem("ocr:name") ?? "";
const storedRole = (localStorage.getItem("ocr:role") as PlayerRole | null) ?? "player";

export function App({ socket }: AppProps) {
  const pathRoomCode = useMemo(() => cleanRoomCode(window.location.pathname.split("/room/")[1] ?? ""), []);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState(storedName);
  const [code, setCode] = useState(pathRoomCode);
  const [role, setRole] = useState<PlayerRole>(storedRole);
  const [wordbankId, setWordbankId] = useState("sample-en");
  const [error, setError] = useState("");
  const [clue, setClue] = useState("");
  const [guess, setGuess] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onState = (state: RoomView) => {
      setRoom(state);
      setWordbankId(state.wordbankId);
      setError("");
      if (state.phase === "clue-submit") setGuess("");
      if (state.phase === "round-result") setClue("");
    };
    const onError = (message: string) => setError(message);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("room:error", onError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("room:error", onError);
    };
  }, [socket]);

  const viewer = room?.players.find((player) => player.id === room.viewerId);
  const isHost = Boolean(viewer?.isHost);
  const isGuesser = Boolean(viewer?.isGuesser);
  const activePlayers = room?.players.filter((player) => player.role === "player") ?? [];
  const canStart = isHost && activePlayers.length >= 3 && room?.phase === "lobby";

  function persistIdentity(nextName = name, nextRole = role) {
    localStorage.setItem("ocr:name", nextName);
    localStorage.setItem("ocr:role", nextRole);
  }

  function createRoom() {
    setError("");
    persistIdentity();
    socket.emit("room:create", { name, role, wordbankId }, (result: JoinResult) => handleJoinResult(result));
  }

  function joinRoom() {
    setError("");
    persistIdentity();
    socket.emit("room:join", { code, name, role }, (result: JoinResult) => handleJoinResult(result));
  }

  function handleJoinResult(result: JoinResult) {
    if (!result.ok) {
      setError(result.error ?? "Cannot join room.");
      return;
    }
    if (result.code) {
      setCode(result.code);
      window.history.replaceState({}, "", `/room/${result.code}`);
    }
  }

  async function copyRoomCode() {
    if (!room) return;
    const copied = await copyText(room.code);
    setCopyStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyStatus("idle"), 1800);
  }

  function submitClue() {
    if (!clue.trim()) return;
    socket.emit("clue:submit", { clue });
    setClue("");
  }

  function submitGuess(outcome?: GuessOutcome) {
    socket.emit("guess:submit", { guess, outcome });
    setGuess("");
  }

  return (
    <main className="app-shell">
      <section className="masthead">
        <div>
          <p className="eyebrow">Private classroom word game</p>
          <h1>One Clue Room</h1>
        </div>
        <div className="status-strip" aria-live="polite">
          <span className={`signal ${connected ? "signal-on" : ""}`} />
          {connected ? "Live" : "Connecting"}
        </div>
      </section>

      {!room ? (
        <JoinPanel
          code={code}
          error={error}
          name={name}
          role={role}
          setCode={setCode}
          setName={setName}
          setRole={setRole}
          createRoom={createRoom}
          joinRoom={joinRoom}
        />
      ) : (
        <section className="game-grid">
          <aside className="side-panel">
            <RoomHeader room={room} copyStatus={copyStatus} copyRoomCode={copyRoomCode} />
            <ScoreBoard room={room} />
            <PlayerList room={room} socket={socket} isHost={isHost} />
            {isHost && <HostControls room={room} socket={socket} canStart={canStart} />}
          </aside>

          <section className="stage-panel">
            {room.message && <p className="room-message">{room.message}</p>}
            {room.phase === "lobby" && (
              <Lobby
                room={room}
                canStart={canStart}
                wordbankId={wordbankId}
                setWordbankId={setWordbankId}
                socket={socket}
              />
            )}
            {room.phase === "clue-submit" && (
              <ClueSubmit room={room} isGuesser={isGuesser} clue={clue} setClue={setClue} submitClue={submitClue} />
            )}
            {room.phase === "clue-review" && (
              <ClueReview room={room} isGuesser={isGuesser} socket={socket} />
            )}
            {room.phase === "guessing" && (
              <Guessing
                room={room}
                isGuesser={isGuesser}
                guess={guess}
                setGuess={setGuess}
                submitGuess={submitGuess}
              />
            )}
            {room.phase === "round-result" && <RoundResultPanel room={room} isHost={isHost} socket={socket} />}
            {room.phase === "game-over" && <GameOver room={room} isHost={isHost} socket={socket} />}
          </section>
        </section>
      )}
    </main>
  );
}

function JoinPanel(props: {
  code: string;
  error: string;
  name: string;
  role: PlayerRole;
  setCode: (value: string) => void;
  setName: (value: string) => void;
  setRole: (value: PlayerRole) => void;
  createRoom: () => void;
  joinRoom: () => void;
}) {
  return (
    <section className="join-layout">
      <div className="join-copy">
        <p className="round-kicker">No login. Room link. One-word clues.</p>
        <h2>一分鐘開局，成班即刻玩。</h2>
        <p>
          私人房間模式，適合課堂、班會、補習小組或者朋友局。猜題者睇唔到答案，提示撞字會自動消失。
        </p>
      </div>

      <form className="join-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Display name
          <input value={props.name} maxLength={24} onChange={(event) => props.setName(event.target.value)} />
        </label>

        <div className="segmented" role="group" aria-label="Role">
          <button
            className={props.role === "player" ? "active" : ""}
            type="button"
            onClick={() => props.setRole("player")}
          >
            <Users size={18} /> Player
          </button>
          <button
            className={props.role === "spectator" ? "active" : ""}
            type="button"
            onClick={() => props.setRole("spectator")}
          >
            <Shield size={18} /> Spectator
          </button>
        </div>

        <button className="primary-command" type="button" onClick={props.createRoom}>
          <Play size={20} /> Create room
        </button>

        <div className="join-code-row">
          <label>
            Room code
            <input
              value={props.code}
              maxLength={8}
              onChange={(event) => props.setCode(cleanRoomCode(event.target.value))}
            />
          </label>
          <button className="icon-command" type="button" title="Join room" onClick={props.joinRoom}>
            <DoorOpen size={20} />
          </button>
        </div>

        {props.error && <p className="error-text">{props.error}</p>}
      </form>
    </section>
  );
}

function RoomHeader({
  room,
  copyStatus,
  copyRoomCode
}: {
  room: RoomView;
  copyStatus: "idle" | "copied" | "failed";
  copyRoomCode: () => void;
}) {
  const roomUrl = new URL(`/room/${room.code}`, window.location.href).href;
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [linkStatus, setLinkStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(roomUrl, { margin: 1, width: 148, color: { dark: "#171717", light: "#fffaf0" } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [roomUrl]);

  async function copyRoomLink() {
    const copied = await copyText(roomUrl);
    setLinkStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setLinkStatus("idle"), 1800);
  }

  return (
    <div className="room-header">
      <p>Room</p>
      <div>
        <strong>{room.code}</strong>
        <button className="icon-command small" type="button" title="Copy room code" onClick={copyRoomCode}>
          {copyStatus === "copied" ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <span className={`copy-status ${copyStatus === "failed" ? "copy-failed" : ""}`}>
        {copyStatus === "copied" ? "Room code copied" : copyStatus === "failed" ? "Copy failed" : `Room code: ${room.code}`}
      </span>

      <div className="share-tools">
        {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for room ${room.code}`} /> : <div className="qr-placeholder">QR</div>}
        <div>
          <span>Join link</span>
          <strong>{roomUrl}</strong>
          <button className="secondary-command compact" type="button" onClick={copyRoomLink}>
            <Link2 size={16} /> {linkStatus === "copied" ? "Link copied" : linkStatus === "failed" ? "Copy failed" : "Copy link"}
          </button>
        </div>
      </div>
    </div>
  );
}
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return fallbackCopyText(text);
  }
}

function fallbackCopyText(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function ScoreBoard({ room }: { room: RoomView }) {
  return (
    <div className="score-board">
      <div>
        <span>Round</span>
        <strong>
          {room.roundNumber || 0}/{room.totalRounds}
        </strong>
      </div>
      <ScoreMeter room={room} />
      <div>
        <span>Phase</span>
        <strong>{phaseLabel(room.phase)}</strong>
      </div>
    </div>
  );
}

function ScoreMeter({ room }: { room: RoomView }) {
  const percent = room.totalRounds === 0 ? 0 : Math.min(100, Math.max(0, (room.score / room.totalRounds) * 100));

  return (
    <div className="score-meter" aria-label={`Score ${room.score} out of ${room.totalRounds}`}>
      <span>Score</span>
      <div className="score-scale">
        <b>{room.totalRounds}</b>
        <div className="score-arrow" aria-hidden="true">
          <i />
          <strong className="score-marker" style={{ bottom: `calc(${percent}% - 15px)` }}>
            {room.score}
          </strong>
        </div>
        <b>0</b>
      </div>
    </div>
  );
}

function PlayerList({ room, socket, isHost }: { room: RoomView; socket: Socket; isHost: boolean }) {
  return (
    <div className="players-panel">
      <h2>Players</h2>
      <div className="player-list">
        {room.players.map((player) => (
          <div className={`player-row ${player.isHost ? "host-player" : ""}`} key={player.id}>
            <span className={`presence ${player.connected ? "online" : ""}`} />
            <span className="player-name">
              {player.name}
              {player.isHost && (
                <em className="host-badge">
                  <Crown size={13} /> host
                </em>
              )}
              {player.isGuesser && <em>guesser</em>}
              {player.role === "spectator" && <em>spectator</em>}
            </span>
            {player.hasSubmittedClue && <Check size={17} />}
            {isHost && !player.isHost && (
              <button
                className="icon-command tiny"
                title="Kick player"
                type="button"
                onClick={() => socket.emit("player:kick", { playerId: player.id })}
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HostControls({ room, socket, canStart }: { room: RoomView; socket: Socket; canStart: boolean }) {
  const waiting = Math.max(room.expectedClues - room.submittedClues, 0);

  return (
    <div className="host-controls">
      <h2>Host controls</h2>
      <p>{hostActionText(room.phase, waiting)}</p>
      <div className="host-button-grid">
        {room.phase === "lobby" && (
          <button className="primary-command compact" disabled={!canStart} type="button" onClick={() => socket.emit("game:start")}>
            <Play size={16} /> Start
          </button>
        )}
        {room.phase === "clue-review" && (
          <button className="primary-command compact" type="button" onClick={() => socket.emit("phase:reveal")}>
            <Eye size={16} /> Reveal clues
          </button>
        )}
        {room.phase === "guessing" && (
          <button className="secondary-command compact" type="button" onClick={() => socket.emit("guess:submit", { guess: "pass", outcome: "pass" })}>
            Force pass
          </button>
        )}
        {room.phase === "round-result" && (
          <button className="primary-command compact" type="button" onClick={() => socket.emit("round:next")}>
            <RefreshCcw size={16} /> Next
          </button>
        )}
        {room.phase === "game-over" && (
          <button className="primary-command compact" type="button" onClick={() => socket.emit("game:restart")}>
            <RefreshCcw size={16} /> Lobby
          </button>
        )}
      </div>
    </div>
  );
}

function hostActionText(phase: GamePhase, waiting: number): string {
  if (phase === "lobby") return "Share the QR/code, wait for 3 players, then start.";
  if (phase === "clue-submit") return waiting > 0 ? `Waiting for ${waiting} clue${waiting === 1 ? "" : "s"}.` : "All clues submitted.";
  if (phase === "clue-review") return "Duplicate clues are already removed. Check the remaining clues, then reveal.";
  if (phase === "guessing") return "The guesser is answering. Use Force pass only for testing or classroom flow control.";
  if (phase === "round-result") return "Show the result, then move to the next round.";
  return "Game finished. Return to lobby when ready.";
}
function Lobby({
  room,
  canStart,
  wordbankId,
  setWordbankId,
  socket
}: {
  room: RoomView;
  canStart: boolean;
  wordbankId: string;
  setWordbankId: (value: string) => void;
  socket: Socket;
}) {
  const isHost = room.viewerId === room.hostId;
  const playerCount = room.players.filter((player) => player.role === "player").length;

  return (
    <div className="phase-layout lobby-layout">
      <div>
        <p className="round-kicker">Lobby</p>
        <h2>等齊人就開波。</h2>
        <p className="muted">等猜題者出手。唔好爆答案，拜託。</p>
      </div>

      <div className="control-band">
        <label>
          Wordbank
          <select
            value={wordbankId}
            disabled={!isHost}
            onChange={(event) => {
              setWordbankId(event.target.value);
              socket.emit("wordbank:set", { wordbankId: event.target.value });
            }}
          >
            {room.wordbanks.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.name} · {bank.language} · {bank.count} words
              </option>
            ))}
          </select>
        </label>
        <button className="primary-command" disabled={!canStart} type="button" onClick={() => socket.emit("game:start")}>
          <Play size={20} /> Start game
        </button>
      </div>


      <WordbankPreview room={room} />
    </div>
  );
}

function WordbankPreview({ room }: { room: RoomView }) {
  const bank = room.currentWordbank;
  if (!bank) return null;

  return (
    <section className="wordbank-preview">
      <div>
        <p className="round-kicker">Wordbank</p>
        <h2>{bank.name}</h2>
        <p>{bank.language} · {bank.words.length} words · edit files in <code>server/wordbanks/*.json</code></p>
      </div>
      <div className="word-list">
        {bank.words.map((word) => (
          <span key={`${word.answer}-${word.category ?? "word"}`}>
            {word.answer}<small>{word.category ?? "General"}</small>
          </span>
        ))}
      </div>
    </section>
  );
}
function ClueSubmit({
  room,
  isGuesser,
  clue,
  setClue,
  submitClue
}: {
  room: RoomView;
  isGuesser: boolean;
  clue: string;
  setClue: (value: string) => void;
  submitClue: () => void;
}) {
  if (isGuesser) {
    return <BlindPanel room={room} title="你係今 round 猜題者。" />;
  }

  if (!room.answer) {
    return <BlindPanel room={room} title="Spectator view" />;
  }

  return (
    <div className="phase-layout">
      <AnswerPlate room={room} />
      <form
        className="clue-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitClue();
        }}
      >
        <label>
          Your one-word clue
          <input
            autoFocus
            value={clue}
            maxLength={40}
            placeholder="One clue only"
            onChange={(event) => setClue(event.target.value)}
          />
        </label>
        <button className="primary-command" type="submit">
          <Send size={19} /> Send clue
        </button>
      </form>
      <ProgressRail room={room} />
    </div>
  );
}

function ClueReview({ room, isGuesser, socket }: { room: RoomView; isGuesser: boolean; socket: Socket }) {
  if (isGuesser) {
    return <BlindPanel room={room} title="大家正在刪走撞字提示。" />;
  }

  return (
    <div className="phase-layout">
      <AnswerPlate room={room} />
      {room.removedDuplicateClues > 0 && (
        <p className="auto-removed-note">
          {room.removedDuplicateClues} duplicate clue{room.removedDuplicateClues === 1 ? "" : "s"} auto-deleted.
        </p>
      )}
      <ClueGrid
        room={room}
        review
        onToggle={(playerId, hidden) => socket.emit("clue:toggleHidden", { playerId, hidden })}
      />
      <button className="primary-command" type="button" onClick={() => socket.emit("phase:reveal")}>
        <Eye size={20} /> Reveal valid clues
      </button>
    </div>
  );
}

function Guessing({
  room,
  isGuesser,
  guess,
  setGuess,
  submitGuess
}: {
  room: RoomView;
  isGuesser: boolean;
  guess: string;
  setGuess: (value: string) => void;
  submitGuess: (outcome?: GuessOutcome) => void;
}) {
  return (
    <div className="phase-layout">
      <p className="round-kicker">Guessing</p>
      <ClueGrid room={room} />
      {isGuesser ? (
        <form
          className="guess-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitGuess();
          }}
        >
          <label>
            Your guess
            <input autoFocus value={guess} onChange={(event) => setGuess(event.target.value)} />
          </label>
          <div className="button-row">
            <button className="primary-command" type="submit">
              <Check size={19} /> Submit
            </button>
            <button className="secondary-command" type="button" onClick={() => submitGuess("pass")}>
              Pass
            </button>
          </div>
        </form>
      ) : (
        <p className="muted">等猜題者出手。唔好爆答案，拜託。</p>
      )}
    </div>
  );
}

function RoundResultPanel({ room, isHost, socket }: { room: RoomView; isHost: boolean; socket: Socket }) {
  return (
    <div className="phase-layout">
      <ResultBlock room={room} />
      {isHost && (
        <button className="primary-command" type="button" onClick={() => socket.emit("round:next")}>
          <RefreshCcw size={19} /> Next round
        </button>
      )}
    </div>
  );
}

function GameOver({ room, isHost, socket }: { room: RoomView; isHost: boolean; socket: Socket }) {
  return (
    <div className="phase-layout game-over">
      <p className="round-kicker">Game over</p>
      <h2>{room.score} points</h2>
      <p>{room.message ?? scoreLabel(room.score, room.totalRounds)}</p>
      <ResultBlock room={room} />
      {isHost && (
        <button className="primary-command" type="button" onClick={() => socket.emit("game:restart")}>
          <RefreshCcw size={19} /> Back to lobby
        </button>
      )}
    </div>
  );
}

function AnswerPlate({ room }: { room: RoomView }) {
  return (
    <div className="answer-plate">
      <span>{room.category ?? "Word"}</span>
      <strong>{room.answer}</strong>
    </div>
  );
}

function BlindPanel({ room, title }: { room: RoomView; title: string }) {
  return (
    <div className="blind-panel">
      <EyeOff size={38} />
      <h2>{title}</h2>
      <p>
        {room.submittedClues}/{room.expectedClues} clues submitted
      </p>
      <ProgressRail room={room} />
    </div>
  );
}

function ProgressRail({ room }: { room: RoomView }) {
  const percent = room.expectedClues === 0 ? 0 : Math.round((room.submittedClues / room.expectedClues) * 100);
  return (
    <div className="progress-rail" aria-label={`${percent}% clues submitted`}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function ClueGrid({
  room,
  review = false,
  onToggle
}: {
  room: RoomView;
  review?: boolean;
  onToggle?: (playerId: string, hidden: boolean) => void;
}) {
  return (
    <div className="clue-grid">
      {room.clues.map((clue) => (
        <article className={`clue-card ${clue.hidden ? "hidden-clue" : ""}`} key={clue.playerId}>
          <span>{clue.playerName}</span>
          <strong>{review || !clue.hidden ? clue.text : "Hidden"}</strong>
          {review && (
            <button
              className="icon-command small"
              title={clue.hidden ? "Restore clue" : "Hide clue"}
              type="button"
              onClick={() => onToggle?.(clue.playerId, !clue.hidden)}
            >
              {clue.hidden ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          )}
          {clue.duplicate && <em>duplicate</em>}
        </article>
      ))}
    </div>
  );
}

function ResultBlock({ room }: { room: RoomView }) {
  const result = room.result;
  if (!result) return null;
  return (
    <div className={`result-block ${result.outcome}`}>
      <p>{result.outcome === "correct" ? "Correct" : result.outcome === "pass" ? "Passed" : "Wrong"}</p>
      <h2>{result.answer}</h2>
      <span>Guess: {result.guess}</span>
    </div>
  );
}

function phaseLabel(phase: GamePhase): string {
  const labels: Record<GamePhase, string> = {
    lobby: "Lobby",
    "clue-submit": "Clues",
    "clue-review": "Review",
    guessing: "Guess",
    "round-result": "Result",
    "game-over": "Final"
  };
  return labels[phase];
}













