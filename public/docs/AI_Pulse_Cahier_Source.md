# AI Pulse - Cahier source de la présentation interactive

**Version consolidée v4 - septembre 2026**  
**Usage : atelier interne Removall Carbon**

> Ce document consolide le brief initial et l'ensemble des arbitrages exprimés pendant l'élaboration de la présentation. La version affichée dans le site AI Pulse v4 est construite à partir de ce cahier. Quand deux demandes se contredisent, l'arbitrage le plus récent prévaut ; l'ancienne demande reste tracée dans la section « Historique des arbitrages ».

## 1. Intention

Créer un site interne qui se comporte visuellement comme une présentation PowerPoint premium, tout en intégrant des interactions live sur smartphone. L'expérience doit servir à la fois de présentation plein écran, support pédagogique sur l'IA, sondage live, dashboard collectif et démonstration concrète de ce que l'on peut construire avec l'IA.

Sentiment recherché : **« Nous ne sommes pas simplement en train de regarder une présentation sur l'IA : nous utilisons une expérience construite avec l'IA. »**

Priorité produit : une expérience **fluide, premium, pédagogique, UX friendly et crédible**, avec un rendu aligné à la charte graphique Removall Carbon.

## 2. Expériences utilisateur

### Mode présentateur
- écran 16:9, lisible sur vidéoprojecteur ;
- navigation clavier gauche/droite, boutons précédent/suivant, numéro de slide et progression ;
- contrôles privés : ouvrir/fermer une interaction, afficher/masquer les résultats, timer 30/60 s, plein écran, vue participant, données de démonstration, export, nouvelle session et reset ;
- résultats live sans rechargement manuel ;
- possibilité d'utiliser la présentation comme un vrai support d'animation.

### Mode participant
- mobile-first ;
- accès via QR code ou URL de session ;
- la personne voit uniquement la question active ;
- réponses anonymes par défaut ;
- aucune collecte de nom, e-mail ou donnée personnelle non nécessaire ;
- mention claire sur l'usage interne des réponses.

## 3. Architecture de session

- identifiant de session, ex. `AI-2026-09` ;
- QR code contenant le lien de la session active ;
- présentateur = contrôle de la slide, de l'ouverture des interactions et de la visibilité des résultats ;
- synchro live par flux serveur / rafraîchissement court ;
- conservation des réponses pendant la session ;
- possibilité de créer une nouvelle session sans effacer les précédentes ;
- export CSV ;
- mode démo clairement marqué comme fictif ;
- reset avec confirmation.

## 4. Parcours v4 retenu

### 0 - Introduction
**L'IA chez nous : où en sommes-nous et jusqu'où peut-on aller ?**  
Sous-titre : **Une session interactive pour comprendre, tester et imaginer.**  
QR code + bouton « Commencer ».

### 1 - Pourquoi sommes-nous ici ?
Trois objectifs :
1. **Prendre le pouls** - comprendre comment l'équipe utilise déjà l'IA ;
2. **Apprendre** - découvrir les bonnes pratiques et les nouvelles possibilités ;
3. **Imaginer** - identifier ensemble les automatisations et cas d'usage les plus intéressants.

### 2 à 5 - Les 4 questions aux collaborateurs
Les **4 questions** sont conservées car elles sont jugées « bien dans l'idée ». La présentation de ces slides doit être plus soignée visuellement qu'une simple page de sondage : mise en avant de la question, visualisation premium des options, rendu plus UX friendly.

#### 2 - Question 1 : fréquence d'usage
**À quelle fréquence utilisez-vous l'IA ?**
- Rarement
- Environ 1 fois par jour
- Environ 5 fois par jour
- Plus de 10 fois par jour

Résultats : histogramme live.

#### 3 - Question 2 : temps gagné
**Combien de temps avez-vous l'impression que l'IA vous fait gagner chaque jour ?**
- Environ 10 min / jour
- Environ 30 min / jour
- Environ 1 h / jour
- Plusieurs heures / jour

Résultats : histogramme live. Cette donnée alimente une estimation moyenne de la salle et une projection annuelle clairement présentée comme une extrapolation interne.

#### 4 - Question 3 : appétit pour l'automatisation
**J'aimerais automatiser davantage certaines tâches avec l'IA.**
- Pas spécialement
- Oui, quelques tâches
- Beaucoup plus
- Absolument

Résultats : **diagramme circulaire / anneau segmenté**, avec un **dégradé de couleur selon l'envie** allant du niveau le plus faible au plus fort. Le rendu doit rester immédiatement lisible.

#### 5 - Question 4 : priorités d'automatisation
**Qu'aimeriez-vous automatiser en priorité ?** - choix multiples :
- Comptes-rendus de réunions
- Emails
- Recherche documentaire
- Excel / reporting
- Création de présentations
- Analyse de documents
- Chatbot interne
- Préparation de réunions
- Tâches répétitives
- Autre

Résultats : barres live.

### 6 - Dashboard collectif live
Afficher uniquement les données de la session :
- % utilisant l'IA quotidiennement ;
- distribution de fréquence ;
- temps gagné moyen perçu ;
- % souhaitant plus d'automatisation ;
- visuel spécifique sur l'appétit pour l'automatisation ;
- top 3 des catégories à automatiser ;
- indicateur de maturité IA.

Le bloc **temps gagné** comporte une **petite loupe cliquable**. Le clic doit ouvrir **une autre slide** plus détaillée, pas une simple info-bulle.

### 7 - Loupe : temps gagné
Contenu :
- distribution détaillée des réponses de la salle ;
- moyenne pondérée et projection annuelle ;
- mise en regard avec des recherches externes datées ;
- différence explicite entre **temps perçu**, **mesure expérimentale** et **potentiel économique**.

Repères affichés :
- **Microsoft & LinkedIn, Work Trend Index, 8 mai 2024** : les « power users » déclarent économiser plus de 30 min/jour ; enquête auprès de 31 000 personnes dans 31 pays ;
- **Microsoft WorkLab, 2023 - premiers utilisateurs Copilot** : moyenne déclarée d'environ 14 min/jour ; chez 133 commerciaux Microsoft utilisant Copilot for Sales : environ 90 min/semaine ;
- **NBER, Shifting Work Patterns with Generative AI, mai 2025, révision novembre 2025** : expérimentation sur 7 137 knowledge workers dans 66 entreprises ; les utilisateurs actifs ont passé environ 2 h/semaine de moins sur les e-mails ;
- **McKinsey, juin 2023** : potentiel estimé de +3 à +5 % de productivité commerciale ; il s'agit d'un potentiel économique, pas d'une mesure universelle en minutes.

Message à faire passer : **il n'existe pas un nombre universel de minutes gagnées**. Le gain dépend du métier, des tâches, de l'outil, du niveau d'adoption et de la qualité des workflows.

### 8 - Comment fonctionne une IA dans un cas documentaire ?
Chaîne visuelle cliquable :  
**Vous -> Prompt -> Contexte / documents -> Recherche / récupération -> Modèle IA -> Résultat -> Vérification**

Le niveau de détail doit être poussé plus loin que dans les versions précédentes.

Explications à faire passer :
- **Prompt** : instruction donnée au modèle ;
- **Contexte / documents** : seuls les contenus réellement transmis au modèle peuvent influencer sa réponse ;
- **Recherche / récupération** : selon l'outil, recherche par mots-clés, recherche sémantique par **embeddings / vectorisation**, recherche hybride, filtres métadonnées, reranking ;
- **Chunking** : un long document peut être découpé en blocs ; seuls certains blocs peuvent être récupérés ;
- **Modèle IA** : réseau neuronal entraîné par **machine learning** ; le machine learning consiste à apprendre des régularités statistiques à partir de nombreux exemples ;
- **Boîte noire** : le fonctionnement interne exact reste difficile à expliquer dans le détail, même si l'on connaît l'architecture générale ;
- **Résultat** : la réponse est probabiliste, donc plausible ne veut pas dire automatiquement exacte ;
- **Vérification** : revenir à la source, contrôler chiffres, citations, dates, obligations et décisions.

Message clé : **plus un sujet est critique, plus il faut vérifier**.

### 9 - Démonstration crédible : l'IA verra-t-elle cette information ?
Afficher un faux document réaliste. Une information importante est volontairement placée dans une rubrique a priori secondaire, par exemple une annexe ou une section peu regardée.

Question live :  
**« Dans un assistant documentaire basé sur la recherche de passages, cette information sera-t-elle forcément retrouvée ? »**
- Oui, forcément
- Non, pas forcément

Résultats : **petit diagramme circulaire**.

Révélation : **Non, pas forcément.**  
Un système RAG peut découper le document puis sélectionner seulement quelques passages. Si la requête, le découpage ou le classement ne font pas remonter le bon bloc, l'information peut être manquée.

Important : le discours doit rester crédible. Il ne faut pas dire que l'IA « ne lit jamais le document ». Certains systèmes injectent le document entier si sa taille le permet ; d'autres ne transmettent qu'une sélection de passages.

Référence pédagogique utile : **« Lost in the Middle » (2023)** pour illustrer que la position d'une information dans un long contexte peut affecter la performance.

### 10 - Prompt Lab avancé
Construire un prompt progressivement avec une structure courte inspirée d'un system prompt :
- **Rôle** ;
- **Objectif** ;
- **Contexte** ;
- **Détails** ;
- **Format attendu** ;
- **Contraintes**.

Le rendu doit montrer qu'**un bon prompt ressemble à un mini cahier des charges**.

### 11 - Quel outil IA pour quel besoin ?
Une **seule slide consolidée** remplace les anciennes slides « training / folder / projet / GPT spécialisé / quel outil IA ».

Objectif : répertorier les usages de l'IA, **sans classement par métiers** (pas de découpage commercial / RH / etc.), mais en expliquant **dans quel cas il vaut mieux utiliser telle ou telle forme d'IA**.

Usages à couvrir :
- **Chat** ;
- **Recherche web / deep research** ;
- **Espace de travail / folder / projet** ;
- **Assistant spécialisé / GPT** ;
- **Chatbot documentaire** ;
- **Agent** ;
- **Meeting Notes** ;
- **Workflow / automatisation**.

Pour chaque outil :
- **À privilégier quand…**
- **À éviter quand…**

Pour **Chatbot documentaire**, inclure explicitement les exemples :
- **Supplier Quote**
- **méthodologie cookstove**

### 12 - Agents
Animation : **Demande -> Recherche -> Analyse -> Action -> Vérification -> Résultat**.

Exemple : **« Prépare ma réunion client de demain. »**
- récupérer les informations pertinentes ;
- analyser les derniers échanges ;
- préparer un briefing ;
- identifier les points à traiter ;
- proposer les prochaines actions.

### 13 - Meeting Notes
Avant / après : transcription réaliste d'une réunion de 45 min -> IA -> Résumé / Décisions / Actions / Responsables / Deadlines. Onglets cliquables.

### 14 - Prochaines priorités
La logique retenue est la suivante :
- le présentateur propose **8 choix** ;
- chaque collaborateur choisit **son préféré** ;
- le système affiche ensuite **3 priorités retenues** ;
- **pas de classement symbolique** : pas de podium, pas de médaille, pas de 1er / 2e / 3e.

Valeurs par défaut :
1. Supplier Quote
2. Assistant méthodologie cookstove
3. Meeting Notes automatiques
4. Recherche documentaire interne
5. Reporting / Excel
6. Préparation de réunions / rendez-vous
7. Brouillons d'e-mails / communications
8. Workflow opérationnel répétitif

### 15 - Conclusion
**L'objectif n'est pas d'utiliser plus d'IA.**  
Révélation : **C'est de supprimer davantage de travail sans valeur.**

Boucle : **Tester -> Mesurer -> Garder ce qui fonctionne -> Automatiser**.

### 16 - Le document source
Afficher le cahier source de la présentation et la phrase :

**« Toute cette présentation a été construite à partir de ce document. »**

Le document doit réellement contenir les exigences et arbitrages utilisés pour construire la version présentée.

## 5. Design - Charte Removall Carbon

Référence : charte graphique transmise pendant la conception.

### Typographies
- **Montserrat** : titres / interface lorsque disponible ;
- **Chillax** : identité éditoriale lorsque disponible ;
- prévoir des polices système de secours pour ne pas dépendre d'un chargement externe.

### Palette principale
- Bleu nuit : `#24304F`
- Bleu : `#5F89F4`
- Bleu clair : `#B7CBFF`
- Bleu très clair : `#DFEAFB`
- Vert foncé : `#2B4A45`
- Vert : `#4BBA84`
- Vert clair : `#ABD3BD`
- Vert très clair : `#EDF8F2`
- Orange : `#FE6930`
- Orange clair : `#F5B297`
- Orange très clair : `#FFF2EC`
- Noir : `#1A1A1A`
- Gris : `#333333`, `#C0C0C0`, `#EDEDED`
- Blanc : `#FFFFFF`

Principes visuels :
- interface premium et très fluide ;
- grands titres ;
- cartes arrondies ;
- dégradés discrets ;
- lisibilité prioritaire ;
- rendu « IA » sans tomber dans l'effet gadget.

## 6. Confidentialité / RGPD / sécurité

- usage interne ;
- anonymat par défaut ;
- pas de données personnelles inutiles ;
- ne pas attribuer publiquement une réponse à une personne ;
- rappeler que la démonstration n'est pas une validation juridique ou documentaire.

## 7. Suppressions / remplacements demandés

Éléments explicitement retirés ou remplacés :
- suppression de la slide séparée « training / folder projet / GPT spécialisé » au profit d'une **slide unique sur les usages** ;
- suppression de la slide « automatiser une chose » déjà traitée ailleurs ;
- suppression du **mini quiz** en tant que mécanique de slide autonome ;
- conservation de la démonstration documentaire, mais comme **expérience pédagogique crédible**, pas comme quiz ludique.

## 8. Historique des arbitrages

### Arbitrages conservés des versions précédentes
- construire d'abord une base fonctionnelle avant d'ajouter des effets secondaires ;
- garder les 4 questions live en ouverture ;
- faire émerger un dashboard collectif synthétique ;
- montrer des cas d'usage concrets plutôt qu'un discours théorique sur l'IA.

### Dernières demandes intégrées dans la v4
- garder les 4 questions, mais retravailler leur présentation ;
- préciser l'appétit pour l'IA avec un visuel circulaire en dégradé ;
- faire de la loupe « temps gagné » une vraie slide détaillée ;
- détailler davantage le fonctionnement de l'IA documentaire, avec boîte noire, machine learning, mots-clés, vectorisation, etc. ;
- rendre la slide sur le document caché plus crédible ;
- pousser encore plus loin la slide « bon prompt » ;
- conserver une seule slide « quel outil IA pour mon besoin » ;
- faire apparaître 3 priorités finales sans classement ;
- générer un vrai document source récapitulatif et l'afficher en fin de présentation.

## 9. Livrables attendus dans le projet

Le projet final doit contenir :
- le site Node.js / front-end de la présentation interactive ;
- le questionnaire live ;
- le dashboard ;
- le document source en **Markdown**, **DOCX** et **PDF** ;
- un aperçu visuel du document source affichable dans la slide finale.

