# One Clue Room

A private classroom word game inspired by one-word clue party games. Built for small live groups, lesson warmups, and classroom projection.

## Features

- Room code and join link sharing
- Host controls for starting, revealing clues, next round, and restart
- Player and spectator modes
- Secret one-word clue submission
- Automatic duplicate clue removal
- Guessing, pass, wrong-answer penalty, and 13-card scoring
- Replaceable JSON wordbanks, including a 300-word Traditional Chinese classroom wordbank

## Wordbanks

Wordbanks live in `server/wordbanks/*.json`.

Each file uses this shape:

```json
{
  "id": "300Words-zh",
  "name": "中文題庫",
  "language": "zh-Hant",
  "words": [
    { "answer": "黑板", "category": "校園" }
  ]
}
```

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Production

```bash
npm install
npm run build
npm start
```

The Node server serves the built frontend and Socket.IO backend from the same origin.

## Deploy On Render

Use a Web Service, not a static site.

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: Node
- Health check path: `/api/health`

This app uses in-memory rooms, so restarting the service clears active games.
