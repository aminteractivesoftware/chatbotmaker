# Chatbot Maker

AI-powered tool to generate character cards and lorebooks from book files or summaries.

## Features

- 📖 Upload EPUB files or paste book summaries
- 🤖 AI-powered character extraction using OpenRouter
- 📝 Generates detailed character cards with personality and dialogue
- 🌍 Creates detailed lorebooks with world information
- 💾 Easy JSON export for all characters and lorebook

## Setup

### Prerequisites

- Node.js 18+ installed
- OpenRouter API key (get one at [openrouter.ai](https://openrouter.ai))

### Installation

1. Install dependencies:
```bash
npm run install:all
```

2. Start the development servers:
```bash
npm run dev
```

This will start:
- Backend API on `http://localhost:3001`
- Frontend on `http://localhost:3000`

## Usage

1. Open `http://localhost:3000` in your browser
2. Enter your OpenRouter API key
3. Choose to either:
   - Upload an EPUB file, OR
   - Paste a book summary
4. Click "Process" and wait for AI analysis
5. Download generated character cards and lorebook
6. Import into your chatbot application

## Project Structure

```
chatbot-maker/
├── backend/              # Express API server
│   ├── routes/          # API endpoints
│   ├── services/        # Business logic
│   │   ├── fileParser.js      # EPUB parsing
│   │   ├── aiService.js       # OpenRouter integration
│   │   └── cardGenerator.js   # Character card generation
│   └── server.js
├── frontend/            # React app
│   └── src/
│       ├── components/
│       └── App.jsx
└── package.json
```

## API Endpoints

### POST `/api/process/file`
Upload and process an EPUB file.

**Body:** FormData with `file` and `apiKey`

### POST `/api/process/summary`
Process a text summary.

**Body:** `{ summary: string, apiKey: string }`

## Technologies

- **Frontend:** React, Vite, Axios
- **Backend:** Node.js, Express, epub2
- **AI:** OpenRouter API (Claude 3.5 Sonnet)

## License

MIT
