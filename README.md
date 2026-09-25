# AI Pulse v7 — Removall & IA

Présentation interactive + questionnaire live pour atelier interne Removall Carbon.

## Lancer en local

Node.js 18+ :

```bash
npm start
```

Le terminal affiche :
- l’URL Présentateur avec la clé privée ;
- l’URL Participant.

## Déploiement Render

Configuration recommandée :
- Runtime : Node
- Build command : `npm install`
- Start command : `npm start`
- Root Directory : laisser vide si `package.json` est à la racine du repository ; sinon indiquer le dossier qui contient `package.json`.

Le serveur utilise `process.env.PORT`, donc il est compatible Render.

## Parcours v5

La v5 suit strictement le script maître fourni :
- 17 slides, sans ajout de slide ;
- identité plus claire et lumineuse selon la charte Removall ;
- 4 questions live ;
- dashboard live ;
- loupe temps gagné plus visuelle ;
- fonctionnement de l’IA simplifié autour de la boîte noire, du machine learning et de la vérification ;
- démonstration documentaire adaptée à un rapport de crédits carbone ;
- Prompt Lab avec prompt naturel puis étape finale « Structure du prompt » ;
- slide outils IA plus lisible et plus grande ;
- vote final avec animation de révélation de 3 priorités, sans podium ;
- conclusion mise à jour ;
- vrai document source affiché à la fin.

## Documents source

Le dossier contient :
- `AI_Pulse_Cahier_Source.md`
- `AI_Pulse_Cahier_Source.docx`
- `AI_Pulse_Cahier_Source.pdf`

Les mêmes documents sont disponibles dans `public/docs/` afin d’être ouverts directement depuis la dernière slide.

## Confidentialité

Aucun nom ni e-mail n’est demandé. Les réponses sont associées uniquement à un identifiant anonyme local par session.
