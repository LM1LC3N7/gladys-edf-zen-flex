# EDF Zen Flex

Intégration **non officielle**, sans lien avec EDF. Elle apporte à Gladys l’offre d’électricité EDF Zen Flex
(nom commercial : « Zen Week-End – Option Flex ») :

- le **type de chaque jour** (Éco, Sobriété, Bonus), lu la veille sur le site d’EDF, dans le calendrier tarifaire
  `zen-flex` de Gladys ;
- un **modèle de contrat** « EDF Zen Flex » dont Gladys calcule lui-même le coût à partir de ce calendrier ;
- un **déclencheur de scène** « Jour EDF Zen Flex annoncé », pour préparer la maison la veille d’un jour Sobriété.

Non testé sur une vraie installation Gladys avec un compteur sous contrat Zen Flex : la lecture du site EDF a été
vérifiée en vrai le 11 novembre 2026, le calcul du prix sur le moteur de tarifs de Gladys 5.3.

## La source : une page publique du site EDF, non documentée

L’intégration lit le point d’accès que la page Zen Flex du site d’EDF utilise elle-même
(`particulier.edf.fr/services/rest/opm/getOPMStatut`) : **sans compte, sans connexion**, avec son propre
User-Agent (`gladys-edf-zen-flex/<version>`), jamais celui d’un navigateur ni de l’application EDF. Il donne le
type du jour et celui du lendemain, ou « pas encore annoncé ».

EDF ne documente pas ce point d’accès et **peut le changer ou le fermer sans prévenir**. Toute réponse d’une
forme inattendue (un code inconnu, une clé manquante, une page HTML…) est refusée en bloc : le statut affiche
« Lecture EDF impossible : réponse de forme inattendue », rien n’est publié, et les jours déjà connus restent
tels quels. **Aucun jour n’est inventé** : un jour non annoncé reste inconnu.

EDF voit l’adresse IP de votre box et le User-Agent du module ; aucune autre donnée ne part.

## Quand le module interroge EDF

EDF annonce le lendemain au plus tard à 16 h. Le module lit aux heures de Paris suivantes, et seulement s’il lui
manque quelque chose :

| Heure               | Lu si                                       |
| ------------------- | ------------------------------------------- |
| 00:15               | le type du jour est inconnu                 |
| 10:15, 13:15, 16:15 | le type du jour ou du lendemain est inconnu |
| 17:15, 19:15, 22:15 | idem (annonce tardive)                      |

Une journée ordinaire fait donc 3 lectures (10:15, 13:15, 16:15), puis plus rien jusqu’au lendemain. Au premier
démarrage, une lecture part tout de suite. Deux lectures sont espacées d’au moins 10 minutes, redémarrages
compris (l’heure de la tentative est écrite dans `/data` avant la requête).

En cas d’échec : nouvel essai après 5 (relevé à 10), 15, 30 et 60 minutes, puis toutes les 2 heures. Une
réponse 429 met en pause le temps demandé par `Retry-After` (entre 1 minute et 6 heures, 30 minutes sans
en-tête) ; une réponse 403 (le site refuse le module) met en pause 6 heures. Le module n’essaie pas de
contourner un refus.

## Le contrat

Ouvrez **Intégrations → Suivi de l’énergie → Contrats**, créez un contrat à partir du modèle **EDF Zen Flex** et
vérifiez ses prix. Gladys calcule le coût de votre consommation avec son propre moteur de tarifs ; le module
fournit seulement le calendrier.

Prix pré-remplis : grille EDF « Zen Week-End », option Flex, TTC, **applicable au 15 septembre 2026 aux nouvelles
souscriptions** ([PDF](https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/grille-prix-zen-week-end.pdf)).
EDF peut les réviser deux fois par an : reprenez ceux de votre facture.

|                          | Heures creuses | Heures pleines |
| ------------------------ | -------------- | -------------- |
| Jour Éco (et jour Bonus) | 0,1595 €/kWh   | 0,2142 €/kWh   |
| Jour Sobriété            | 0,2142 €/kWh   | 0,7467 €/kWh   |

- **Heures pleines** : 8 h-13 h et 18 h-20 h, tous les jours (conditions générales EDF) ; le reste est en heures
  creuses. Le champ « Heures pleines » du contrat permet de suivre un changement d’horaires annoncé par EDF.
- **Abonnement** mensuel TTC selon la puissance : 6 kVA 15,86 € · 9 kVA 19,88 € · 12 kVA 23,76 € · 15 kVA
  27,40 € · 18 kVA 31,14 € · 24 kVA 39,14 € · 30 kVA 46,47 € · 36 kVA 53,88 € (6 kVA pré-rempli).
- **Jours Bonus** : facturés comme des jours Éco. La récompense versée par EDF quand vous suivez sa consigne
  n’est pas calculée.
- **Jour absent du calendrier** (pas encore annoncé, module arrêté) : compté comme un jour Éco, ce qu’est la
  grande majorité des jours. Dès que le jour arrive dans le calendrier, Gladys recalcule les coûts concernés.
- Un jour va de minuit à minuit (heure de Paris). Les changements d’heure sont gérés par Gladys.

## Les scènes

Déclencheur **« Jour EDF Zen Flex annoncé »** : il part quand le module lit pour la première fois le type du
lendemain (en général vers 16 h 15), avec le filtre « Type du lendemain » (Éco, Sobriété, Bonus ; vide : tous).
Variables : `day_type` (`eco`, `sobriete` ou `bonus`) et `date` (`AAAA-MM-JJ`).

- Une fois par jour annoncé ; de nouveau si EDF change ce type avant minuit.
- Si Gladys ne prend pas l’annonce, elle est renvoyée (après 1, 5, 15 minutes, puis toutes les 30 minutes)
  jusqu’à minuit, puis abandonnée : une annonce n’est plus envoyée une fois son jour commencé.
- Un module démarré après minuit ne déclenche rien pour le jour en cours.
- La consigne d’un jour Bonus (réduire ou décaler sa consommation) n’est pas donnée par ce point d’accès : EDF
  l’envoie par e-mail ou SMS.

Pour agir pendant les heures pleines d’un jour Sobriété, une scène peut aussi utiliser la condition « prix
actuel » du contrat.

## Le statut

L’écran de l’intégration affiche : le type d’aujourd’hui et de demain, le nombre de jours Sobriété (sur 20) et
Bonus vus par le module dans l’année, l’heure de la dernière lecture, et ce qui ne va pas (EDF illisible avec
la raison et l’heure du prochain essai, calendrier refusé, annonce non envoyée, `/data` non inscriptible). Les
compteurs ne voient que les jours lus depuis l’installation.

## Ce que garde `/data`

Les jours lus (400 jours au plus), ceux que Gladys a acceptés dans son calendrier, la dernière annonce envoyée,
l’heure de la dernière tentative et de la dernière lecture réussie, la pause en cours. Aucune donnée
personnelle, aucun secret. Si `/data` est illisible, le module le relit toutes les 10 secondes sans interroger
EDF ; s’il n’est pas inscriptible, les jours restent en mémoire et la première lecture attend 10 minutes après
le démarrage.

## Calendrier déjà fourni

La clé `zen-flex` appartient à la première intégration installée qui la déclare. Si une autre intégration la
fournit déjà, Gladys refuse celle-ci (le statut le dit) : le modèle lit alors les valeurs de l’autre intégration,
et le déclencheur de scène fonctionne quand même.
