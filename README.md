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
- **API** (`app/api/next-beat/route.ts`): sends the text before the cursor, the text after it and your story notes to [Jev](https://docs.typesafe.ai/) (TypeSafe AI's System One model, `jev-latest`). For each beat it asks, separately, whether a sentence of that kind would work next, so several beats can be good at once; faded beats probably won't fit. It also asks for Jev's single most likely pick, shown as "Likely".
- **Categories** are defined in `lib/beats.ts`; their definitions are sent to Jev as the choice criteria. Edit them there to change how Jev classifies.

## Chapter analysis

"Analyze chapter" (`app/api/analyze/route.ts`) colors every sentence green, yellow or red and says what to do about the weak ones. It combines two checks:

1. **Forward, would each beat work**: for each sentence, Jev sees only the text before it (up to ~4k tokens) and answers a yes/no question per beat: would a sentence of this kind work well here? Each is asked two ways and averaged.
2. **Hindsight, does it work as written**: Jev reads a numbered passage and, for 20 sentences per call, labels what each one does and judges whether it works at its point in the story, asked two ways and averaged. This sets the color: green at 60%+, yellow at 40–60%, red below 40% (`lib/analysis.ts`).

Together they give the advice for each sentence:

| Hindsight | The beat used (forward) | Advice |
|---|---|---|
| Doesn't work | wouldn't work there either | Wrong kind of sentence: try the best-working beat instead |
| Doesn't work | would work | Right idea, rewrite it |
| Works | was doubted | Risky choice that works |

The panel lists sentences to fix (weakest first), weak stretches of 3+ in a row, and risky choices that work. Click any sentence for its breakdown. A 25-sentence passage takes about 26 calls and 40k input tokens, a fraction of a cent.

## Deploying

Railway runs `npm run build` and `npm start`. Set `TYPESAFE_API_KEY` in the service's variables.
