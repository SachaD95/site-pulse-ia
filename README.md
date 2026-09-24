# AI Pulse — présentation interactive + questionnaire live

MVP autonome basé sur le brief fourni : présentation 16:9 côté animateur, expérience mobile côté participants, interactions synchronisées en direct et stockage des sessions sur le serveur.

## Démarrage

Pré-requis : **Node.js 18+**.

```bash
npm start
```

Le terminal affiche :

- une URL **Présentateur** contenant une clé privée de contrôle ;
- une URL **Participant** ;
- les adresses réseau local détectées.

La slide d'introduction affiche un QR code vers l'URL courte :

```text
http://VOTRE-HOTE:4173/join/AI-2026-09
```

Pour les participants sur smartphone, utilisez l'adresse IP ou le nom DNS de la machine qui héberge AI Pulse, par exemple :

```text
http://192.168.1.42:4173/join/AI-2026-09
```

Le port `4173` doit être autorisé par le pare-feu local.

## Fonctionnalités incluses

- 20 écrans au format présentation avec navigation clavier, boutons et plein écran.
- Vue séparée **Presenter controls** et mode participant mobile.
- Sondage fréquence IA avec histogramme live.
- Sondage appétit pour l'automatisation avec jauge collective.
- Sondage multi-choix sur les tâches à automatiser avec classement dynamique.
- Dashboard calculé uniquement depuis les réponses de la session.
- Slides pédagogiques : fonctionnement IA, Prompt Lab, espace de travail, assistant spécialisé, agents et Meeting Notes.
- Mur d'idées anonymes limité à 200 caractères.
- Regroupement assisté déterministe par mots-clés + nuage de mots. Il est explicitement présenté comme non-IA pour ne pas simuler une analyse dynamique.
- Shortlist d'idées puis vote collectif à **3 voix par participant**.
- Deux mini-quiz avec explication immédiate.
- Arbre de décision « Quel outil IA pour mon besoin ? ».
- Interaction finale sur ce que les participants veulent tester.
- Réactions live 👍 ❤️ 💡 🤯.
- Timer 30/60 secondes.
- Compteur de participants actifs.
- Mode démo clairement identifié comme fictif.
- Export CSV des réponses, idées et votes.
- Réinitialisation avec confirmation.
- Création d'une nouvelle session sans supprimer les précédentes.
- Persistance locale dans `data/sessions.json`.
- Synchronisation push via **Server-Sent Events (SSE)**, sans rechargement manuel.
- QR code généré localement, sans dépendance CDN.

## Confidentialité

Aucun nom, e-mail ou autre donnée personnelle n'est demandé. Le navigateur génère uniquement un identifiant anonyme local afin d'éviter les doubles réponses et de gérer les votes.

Les données restent dans le fichier `data/sessions.json` du serveur jusqu'à réinitialisation ou suppression manuelle.

## Raccourcis présentateur

- `←` / `→` : slide précédente / suivante
- `Espace` : slide suivante
- `F` : plein écran

## Mise en production interne recommandée

Le MVP fonctionne sur un réseau interne. Pour une utilisation d'entreprise durable, ajoutez idéalement :

- HTTPS via reverse proxy ;
- SSO ou authentification forte pour le rôle présentateur ;
- base de données managée à la place du fichier JSON ;
- politique de conservation / suppression des sessions ;
- sauvegardes et journalisation adaptées.

## Structure

```text
ai-pulse-site/
├── server.js
├── package.json
├── README.md
├── data/
│   └── sessions.json
├── lib/
│   ├── QR-LICENSE.txt
│   └── qrcode/
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

# Research benchmarks added to dashboard
- Microsoft & LinkedIn Work Trend Index, 8 May 2024: power users report saving more than 30 minutes/day.
- NBER Working Paper 33795, May 2025, revised Nov 2025: among active treated users, two fewer hours/week on email across 7,137 knowledge workers in 66 firms.
- Harvard Business School / BCG, Sept 2023: 758 consultants completed in-frontier tasks more than 25% faster with GPT-4.
- McKinsey, June 2023 / Sept 2024: estimated 3-5% sales productivity potential; later B2B sales work emphasizes shifting time from back-office activities toward customer-facing work.
