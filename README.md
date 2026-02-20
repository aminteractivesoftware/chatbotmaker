# Chatbot Maker

AI-powered desktop app to generate SillyTavern character cards and lorebooks from public domain books and text summaries.

## Features

- Desktop app — double-click to launch, no terminal needed
- Upload public domain EPUB files or paste book summaries
- AI-powered character extraction using any OpenAI-compatible provider
- Generates detailed character cards with personality, dialogue, and tags
- Creates lorebooks with world information
- Exports as JSON and PNG (SillyTavern v2 spec)
- Chapter-aware chunking for large books

## Download

Download the latest release for your platform from [GitHub Releases](../../releases).

- **macOS:** `Chatbot Maker.dmg`
- **Windows:** `Chatbot Maker Setup.exe`

## Quick Start

1. Download and install the app for your platform
2. Launch Chatbot Maker
3. Enter your API key and provider URL (defaults to OpenRouter)
4. Upload an EPUB file or paste a book summary
5. Click "Process" and wait for AI analysis
6. Download generated character cards and lorebook

> **Note:** Please only process content you have the rights to use, such as public domain works or your own writing.

## Content Sources

Free public domain books in EPUB format:

- [Project Gutenberg](https://www.gutenberg.org/) — 70,000+ free ebooks
- [Standard Ebooks](https://standardebooks.org/) — high-quality, carefully formatted public domain ebooks
- [Open Library](https://openlibrary.org/) — borrowable ebooks from the Internet Archive
- [ManyBooks](https://manybooks.net/) — free ebooks from the public domain

## Development Setup

### Prerequisites

- Node.js 18+
- An API key for an OpenAI-compatible provider (e.g., [OpenRouter](https://openrouter.ai))

### Clone and Install

```bash
git clone <your-repo-url>
cd chatbot-maker
npm install
```

### Run in Browser (Dev)

```bash
npm run dev
```

This starts the backend API on `http://localhost:3001` and the frontend on `http://localhost:3000` with hot-reload.

### Run as Electron App (Dev)

```bash
npm run electron:dev
```

This starts both servers and opens the app in an Electron window with DevTools.
`electron:dev` waits up to 60 seconds for the frontend URL before failing so startup issues surface quickly in local dev and CI.

### Run as Single Process (Web)

```bash
npm run build
npm start
```

Opens at `http://localhost:3001` — backend serves both API and the built frontend.

## Building the Desktop App

### macOS

```bash
npm run electron:build:mac
```

Produces `dist-electron/Chatbot Maker.dmg` (universal binary for Intel and Apple Silicon).

### Windows

```bash
npm run electron:build:win
```

Produces `dist-electron/Chatbot Maker Setup.exe` (NSIS installer).

### Unpacked Build (Testing)

```bash
npm run electron:build:dir
```

Produces an unpacked app in `dist-electron/` for quick testing without creating an installer.

## Project Structure

```
chatbot-maker/
├── electron/             # Electron main process
│   └── main.mjs
├── backend/              # Express API server
│   ├── config/           # Centralized constants
│   ├── routes/           # API endpoints
│   ├── services/         # Business logic
│   │   ├── fileParser.js       # EPUB/MOBI parsing
│   │   ├── aiService.js        # AI provider integration
│   │   └── cardGenerator.js    # Character card generation
│   ├── utils/            # Logger, progress tracking, PNG metadata
│   └── server.js
├── frontend/             # React + Vite app
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── utils/
│       └── App.jsx
├── build/                # Electron app icons
└── package.json
```

## API Endpoints

### POST `/api/process/file`
Upload and process an EPUB file.

**Body:** FormData with `file`, `apiKey`, `model`, `contextLength`, `apiBaseUrl`

### POST `/api/process/summary`
Process a text summary.

**Body:** `{ summary, apiKey, model, contextLength, apiBaseUrl }`

### POST `/api/process/test-connection`
Test an API provider connection.

**Body:** `{ apiBaseUrl, apiKey }`

### GET `/api/process/models`
Fetch available models from the configured provider.

**Headers:** `x-api-key`, `x-api-base-url`

## Technologies

- **Desktop:** Electron
- **Frontend:** React, Vite, Axios
- **Backend:** Node.js, Express, epub2, sharp
- **AI:** Any OpenAI-compatible API (OpenRouter, Ollama, LM Studio, etc.)

## License

MIT
