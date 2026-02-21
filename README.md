VoiceStruct is a real-time structured thinking coach for mock interviews and high-pressure communication.
It listens to your question, classifies the type, and coaches your answer with frameworks, filler tracking, and feedback.

## What it does

- Real-time transcription via browser speech or Smallest streaming (PCM/Opus)
- Instant question-type detection with structured frameworks
- Practice mode flow: question → answer → quality feedback
- Filler word counter, input level meter, and latency tracking
- Demo prompts for rapid pitch mode

## Getting Started

### 1) Install

```bash
npm install
```

### 2) Run

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Environment (optional)

For Smallest streaming:

```bash
NEXT_PUBLIC_SMALLEST_WS_URL=wss://api.smallest.ai/stt/stream
NEXT_PUBLIC_SMALLEST_STREAM_MODE=pcm # or opus
```

Optional mic boost for low input:

```bash
NEXT_PUBLIC_INPUT_GAIN=1.5
```

## Demo flow (quick)

1. Click a demo prompt or ask a question.
2. The question locks and the framework appears.
3. Answer out loud and watch feedback update in real time.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Tech stack

- Next.js (App Router)
- Smallest.ai Streaming STT (optional)
- Lightweight API routes for analysis + evaluation

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy

Deploy on Vercel or any Node host. The app is client-heavy and runs well on free tiers.
