# Petit dej IA v13 - Removall & AI

Interactive five-slide workshop for Removall Carbon with live audience participation.

## Run locally

Requires Node.js 18+.

```bash
npm start
```

The terminal prints:
- the presenter URL with its private key;
- the participant URL for the current session;
- a stable read-only display URL: `/?mode=display`.

## Active presenter session

The display view is no longer tied to a session ID in its URL. Opening a valid presenter view marks that presenter session as the active session. Every display opened at `/?mode=display` immediately follows that active session.

If a new presenter session becomes active, display pages that are already open automatically switch to it through the server's live active-session event stream. Participant links remain tied to their specific session so audience members are never moved unexpectedly.

## Five-slide flow

1. Title + QR code - unchanged.
2. Live word cloud with fixed logical layout, collision detection, progressive term growth and x2 / x3 occurrence badges. The layout scales as one composition across browser zoom levels.
3. Weekly time-saved poll - unchanged.
4. Carbon-market document retrieval example - unchanged.
5. Source resources with the subtitle “Here are the resources in the format you want:” and resources labelled Petit dej IA.

## Live PDF

`/api/session/<SESSION_ID>/live-results.pdf` is generated on demand from the current session data and is served as `Petit-dej-IA-Live.pdf`.

## Privacy

No name or email address is requested. Responses are associated only with a local anonymous session identifier.
