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

## Chapter analysis

"Find the biggest deviations" (`app/api/analyze/route.ts`) runs Jev over every sentence and ranks the places where the writer used a beat Jev doubted would work there, when another beat would have:

1. **Would it work**: for each sentence, Jev sees only the text before it (up to ~4k tokens) and answers a yes/no question per beat: would a sentence of this kind work well here? Each beat is judged on its own, so several can work at once, unlike a single "which comes next" pick where good options split one 100%. Each question is asked two ways and averaged. The same call also asks for Jev's single most likely pick, shown as "Likely".
2. **Label**: Jev labels what each sentence actually does, 20 sentences per call over a numbered passage with context.
3. **Score**: (1 − how likely the beat used would work) × how well the best other beat would work × agreement between the two phrasings.
4. **Check**: the top 15 get a yes/no check: does this sentence break momentum, or does it work as a deliberate choice? Mistakes and risky choices that work are listed separately, and answers too close to call go in neither.

It also finds stretches of 3+ sentences in a row whose beat Jev doubted would work. Results are highlighted in the text and drawn as a beat timeline; click any sentence for its per-beat breakdown. A 25-sentence passage takes about 32 calls and 43k input tokens, a fraction of a cent.

## Deploying

Railway runs `npm run build` and `npm start`. Set `TYPESAFE_API_KEY` in the service's variables.
