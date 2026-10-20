# Jev Writer

A Google-Docs-style editor where Jev, a pacing coach, reads your whole manuscript and suggests what your next sentence should do: Action, Dialogue, Characterization, World-building, Description, Exposition or Tension. It shows the suggestion as a distribution:

```
Characterization  45%  ███████████
Dialogue          25%  ██████
Tension           15%  ████
...
```

## Running it

```bash
npm install
cp .env.example .env.local   # then add your TYPESAFE_API_KEY
npm run dev                  # http://localhost:3000
```

## How it works

- **Editor**: TipTap (`components/Writer.tsx`). Your document autosaves to the browser's localStorage.
- **Trigger**: when the text before the cursor ends a sentence (`.`, `!`, `?` or `…`), Jev waits 900 ms and then asks. Ctrl/⌘+J asks immediately. A new request cancels any request still in flight.
- **API** (`app/api/next-beat/route.ts`): sends the text before the cursor, the text after it and your story notes to [Jev](https://docs.typesafe.ai/) (TypeSafe AI's System One model, `jev-latest`) as a single `choice` question over the beat categories. Jev returns a probability for each category plus a confidence, which the panel shows. Percentages are normalized to sum to 100.
- **Categories** are defined in `lib/beats.ts`; their definitions are sent to Jev as the choice criteria. Edit them there to change how Jev classifies.

## Deploying

Railway runs `npm run build` and `npm start`. Set `TYPESAFE_API_KEY` in the service's variables.
