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
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

## How it works

- **Editor**: TipTap (`components/Writer.tsx`). Your document autosaves to the browser's localStorage.
- **Trigger**: when the text before the cursor ends a sentence (`.`, `!`, `?` or `…`), Jev waits 900 ms and then asks. Ctrl/⌘+J asks immediately. A new request cancels any request still in flight.
- **API** (`app/api/next-beat/route.ts`): sends the full text before the cursor, the text after it and your story notes to Claude. A structured-output schema makes Claude return a percentage for every category, a reason and a short hint. Percentages are normalized to sum to 100.
- **Prompt caching**: the manuscript is sent in chunks of 20 paragraphs. Finished chunks stay byte-identical, so they're read from the cache, and typing at the end only re-processes the newest chunk. The panel shows how many tokens were cached. Editing an early chapter invalidates the cache from that point on for the next request.
- **Categories** are defined in `lib/beats.ts`. Edit the definitions there to change how Jev classifies.

The percentages are Claude's judgment written as numbers, not measured probabilities. Use them to rank options and see when Jev is unsure, not as exact figures.
