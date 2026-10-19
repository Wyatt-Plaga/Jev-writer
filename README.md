# Jev Writer

A Google-Docs-style editor that uses [Jev](https://typesafe.ai), TypeSafe AI's decision model, to suggest what your writing should do next: Action, Dialogue, Characterization, World-building, Description, Exposition or Tension.

Jev looks ahead at three horizons at once:

| Horizon | Question Jev answers |
|---|---|
| Next sentence | What should the very next sentence do? |
| Rest of this paragraph | What should the rest of the current paragraph do? |
| Next paragraph | What should the next full paragraph do? |

Each horizon shows Jev's probability for every category, so you can see where it's confident and where the choice is open.

## Running it

```bash
npm install
cp .env.example .env.local   # then add your TYPESAFE_API_KEY
npm run dev                  # http://localhost:3000
```

## How it works

- **Editor**: TipTap (`components/Writer.tsx`). Your document autosaves to the browser's localStorage.
- **Trigger**: when the text before the cursor ends a sentence (`.`, `!`, `?` or `…`), Jev waits 900 ms and then asks. Ctrl/⌘+J asks immediately. A new request cancels any request still in flight.
- **API** (`app/api/next-beat/route.ts`): sends the full manuscript before and after the cursor, plus your story notes, to Jev's `POST /v1/systemone` endpoint. The three horizons are three `choice` questions in one request. Jev returns calibrated probabilities for each category; the route converts them to percentages.
- **Categories and horizons** are defined in `lib/beats.ts`. Each category's description is passed to Jev as its criterion, so editing the definitions changes how Jev classifies.
