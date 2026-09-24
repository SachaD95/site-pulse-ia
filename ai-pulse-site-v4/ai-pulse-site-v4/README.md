# AI Pulse v4 — présentation interactive + questionnaire live

Version Node.js 18+ prête à lancer en local ou à déployer sur Render.

## Lancer

```bash
npm start
```

Le terminal affiche l'URL Présentateur avec sa clé privée et l'URL Participant.

## Ce qui change dans la v4

- identité visuelle renforcée et toujours alignée sur la charte Removall Carbon ;
- 4 questions d'ouverture conservées avec une présentation plus premium ;
- dashboard live enrichi ;
- appétit pour l'automatisation en visuel circulaire segmenté avec gradient d'intensité ;
- loupe « temps gagné » ouvrant une slide dédiée avec benchmark de recherche ;
- explication plus détaillée de l'IA documentaire : mots-clés, embeddings, RAG, chunking, machine learning, boîte noire, vérification ;
- interaction live crédible « l'IA verra-t-elle cette information ? » ;
- Prompt Lab renforcé : Rôle, Objectif, Contexte, Détails, Format, Contraintes ;
- une seule slide « Quel outil IA pour quel besoin ? » ;
- vote final sur 8 priorités, une voix par personne, puis trois pistes retenues sans podium ;
- slide finale montrant le vrai cahier source utilisé pour construire la présentation ;
- document source mis à jour en Markdown, DOCX et PDF.

## Déploiement Render

- Runtime : Node
- Build command : `npm install`
- Start command : `npm start`
- Le serveur utilise `process.env.PORT`, donc il est compatible Render.

## Confidentialité

Aucun nom ni e-mail n'est demandé. Les réponses sont associées uniquement à un identifiant anonyme local par session.

## Documents source

Le projet contient :

- `AI_Pulse_Cahier_Source.md`
- `AI_Pulse_Cahier_Source.docx`
- `public/docs/AI_Pulse_Cahier_Source.pdf`

Ces fichiers consolident le brief initial et les arbitrages v4.
