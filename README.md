# Mon Budget

Application web de gestion de budget personnelle, inspirée des applis les plus populaires (YNAB, Monarch, Copilot, Bankin', Linxo). Elle s'installe sur téléphone et sur ordinateur, fonctionne hors ligne et **garde toutes les données sur ton appareil** : rien n'est envoyé sur internet.

## Fonctions

- **Tableau de bord** : argent disponible (comptes courants) et épargne totale séparés avec le détail par compte, disponible prévu en fin de mois, récap du mois (revenus, dépenses, budgets), dépenses par catégorie, objectifs d'épargne, prochaines échéances.
- **Ajout express** : bouton « + » (ou touche `N`), pavé numérique, catégories triées de la plus utilisée à la moins utilisée, option « Répéter ».
- **Opérations** : recherche, filtres (période, type, catégorie, compte, montant), modification, suppression avec annulation.
- **Budgets par catégorie et par mois** : chaque mois a ses propres plafonds, avec une case « Dupliquer le budget du mois précédent », des alertes à 80 % et 100 %, le report du reste et le montant « reste à répartir ».
- **Épargne** : objectifs avec montant visé et date, versements et retraits, rythme mensuel conseillé.
- **Opérations récurrentes** : loyer, salaire, abonnements, avec ajout automatique à chaque échéance, coût annuel des abonnements, mise en pause.
- **Statistiques** : revenus et dépenses sur 6 ou 12 mois, évolution du solde, taux d'épargne, comparaison par catégorie, prévision de fin de mois.
- **Import CSV** des relevés bancaires (détection des colonnes, catégorisation automatique, doublons repérés) et **export CSV** pour Excel.
- **Sauvegarde** JSON (export et restauration), **code PIN** optionnel, thème clair, sombre ou automatique.
- Interface adaptée au **mobile** (barre d'onglets en bas) et au **PC** (barre latérale, tableau de bord en colonnes).

## Utilisation

### Sur ton PC
Double-clique sur `Lancer Mon Budget.bat`. Il faut que Python soit installé. L'appli s'ouvre sur `http://localhost:8765`. Dans Chrome ou Edge, tu peux ensuite l'installer comme une application (icône d'installation dans la barre d'adresse).

### En ligne (téléphone et PC)
L'appli est publiée avec GitHub Pages : **https://plenitudestudio.github.io/MonBudget/**

- **iPhone (Safari)** : ouvre l'adresse, touche *Partager* puis *Sur l'écran d'accueil*.
- **Android (Chrome)** : ouvre l'adresse, menu ⋮ puis *Installer l'application* (ou *Ajouter à l'écran d'accueil*).

Chaque `git push` sur `main` met le site à jour en 1 à 2 minutes. Les données restent sur l'appareil, même quand l'appli est en ligne.

> Les données sont propres à chaque appareil et à chaque navigateur. Utilise **Réglages → Exporter la sauvegarde** puis **Restaurer** pour passer de l'un à l'autre.

## Tests

Ouvre `tests/index.html` via le serveur local (`http://localhost:8765/tests/`) et clique sur **Lancer les tests**. La suite contient 56 tests de bout en bout : ajout, historique, comptes (solde négatif compris), catégories, budgets mensuels et duplication, épargne, récurrences, statistiques, import et export CSV, sauvegarde, code PIN, thèmes, et affichage en 320, 375, 768 et 1280 px. Elle utilise un profil séparé (`?profil=test`) et ne touche jamais aux vraies données.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css` | Page et styles (mobile, tablette, PC, clair et sombre) |
| `app.js` | Données, écrans principaux, ajout express, comptes, catégories |
| `plan.js` | Budgets, épargne, opérations récurrentes |
| `stats.js` | Statistiques, graphiques, solde prévisionnel |
| `csv.js` | Import et export CSV |
| `lock.js` | Code PIN |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation et fonctionnement hors ligne |
| `tests/` | Suite de tests automatiques |

Aucune dépendance et aucune étape de compilation : du HTML, du CSS et du JavaScript.
