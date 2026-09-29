# AI Pulse v11 - Removall & AI

Interactive five-slide workshop for Removall Carbon with live audience participation.

## Run locally

Requires Node.js 18+.

```bash
npm start
```

The terminal prints:
- the presenter URL with its private key;
- the participant URL.

## Deploy on Render

Recommended configuration:
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Root Directory: leave empty when `package.json` is at repository root.

The server uses `process.env.PORT`, so it is Render-ready.

## Five-slide flow

1. Title + QR code - Discussion / Strategy / Training.
2. Empty live word cloud. Participants can submit as many words or short phrases as they want. Basic case/plural normalization merges close variants and repeated terms grow visually.
3. Weekly time-saved poll - 1 / 2 / 4 / 8 hours per week - with live distribution and estimated average.
4. Carbon-market document retrieval example with two conflicting delivery dates and a debrief checklist.
5. "This presentation was generated with AI" - source-document preview, example prompt summary, live PDF link and static DOCX link.

## Live PDF

`/api/session/<SESSION_ID>/live-results.pdf` is generated on demand from the current session data. It inserts a live-results page after the source-document cover, then reproduces the remaining source-document pages visually.

The live page contains:
- participation rate;
- number of respondents;
- estimated average weekly time saved;
- weekly time-saved distribution;
- normalized live word cloud.

The DOCX remains static.

## Privacy

No name or email address is requested. Responses are associated only with a local anonymous session identifier.
