// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (the connection status). Every text is an
// { en, fr } object: Gladys picks the user's language. Dates and times are
// those of Paris.
// -----------------------------------------------------------------------------

import { parisTime } from './time.js';

const LANGS = ['en', 'fr'];

export const DAY_LABELS = {
  eco: { en: 'Éco day', fr: 'jour Éco' },
  sobriete: {
    en: 'Sobriété day (expensive peak hours)',
    fr: 'jour Sobriété (heures pleines chères)',
  },
  bonus: { en: 'Bonus day (an Éco day)', fr: 'jour Bonus (un jour Éco)' },
};

const reasons = {
  rate_limited: {
    en: 'the website asked to slow down (429)',
    fr: 'le site demande de ralentir (429)',
  },
  blocked: { en: 'the website refused the request (403)', fr: 'le site refuse la requête (403)' },
  server: { en: 'the website is unavailable (5xx)', fr: 'le site est indisponible (5xx)' },
  http: { en: 'unexpected HTTP answer', fr: 'réponse HTTP inattendue' },
  network: { en: 'network error', fr: 'erreur réseau' },
  timeout: { en: 'no answer in time', fr: 'pas de réponse à temps' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  invalid: {
    en: 'answer of an unexpected form (EDF may have changed it)',
    fr: 'réponse de forme inattendue (EDF a pu la changer)',
  },
};
const reason = (code, lang) => (reasons[code] ?? reasons.invalid)[lang];

/** `DD/MM` of a `YYYY-MM-DD` date. */
const short = (date) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

function dayText(type, lang) {
  if (type) return DAY_LABELS[type][lang];
  return { en: 'not announced yet', fr: 'pas encore annoncé' }[lang];
}

export const T = {
  starting: {
    en: 'Reading the EDF Zen Flex days…',
    fr: 'Lecture des jours EDF Zen Flex…',
  },
  storeUnreadable: {
    en: 'The saved data in /data cannot be read: read again every 10 seconds, nothing asked to EDF meanwhile (check the volume of the integration).',
    fr: 'Les données gardées dans /data sont illisibles : relues toutes les 10 secondes, rien n’est demandé à EDF en attendant (vérifiez le volume de l’intégration).',
  },

  /**
   * The status: today and tomorrow, the Sobriété days known this year, the
   * last reading, and what went wrong if anything.
   */
  status({
    today,
    tomorrow,
    todayType,
    tomorrowType,
    year,
    sobriete,
    bonus,
    checkedAt,
    error,
    retryAt,
    calendar,
    dataError,
    sceneError,
  }) {
    const out = {};
    for (const lang of LANGS) {
      const parts = [];
      if (error) {
        parts.push(
          lang === 'en'
            ? `EDF cannot be read: ${reason(error, lang)}.`
            : `Lecture EDF impossible : ${reason(error, lang)}.`,
        );
        if (retryAt !== undefined) {
          parts.push(
            lang === 'en'
              ? `Next try at ${parisTime(retryAt)}.`
              : `Nouvel essai à ${parisTime(retryAt)}.`,
          );
        }
      }
      parts.push(
        lang === 'en'
          ? `Today (${short(today)}): ${dayText(todayType, lang)}. Tomorrow (${short(tomorrow)}): ${dayText(tomorrowType, lang)}.`
          : `Aujourd’hui (${short(today)}) : ${dayText(todayType, lang)}. Demain (${short(tomorrow)}) : ${dayText(tomorrowType, lang)}.`,
      );
      if (!tomorrowType && !error) {
        parts.push(
          lang === 'en'
            ? 'EDF announces it by 16:00 at the latest.'
            : 'EDF l’annonce au plus tard à 16 h.',
        );
      }
      parts.push(
        lang === 'en'
          ? `${year}: ${sobriete} Sobriété day(s) of 20 and ${bonus} Bonus day(s) seen by the module.`
          : `${year} : ${sobriete} jour(s) Sobriété sur 20 et ${bonus} jour(s) Bonus vus par le module.`,
      );
      if (checkedAt !== undefined) {
        parts.push(
          lang === 'en'
            ? `Last EDF reading: ${parisTime(checkedAt)}${error ? ' (older data)' : ''}.`
            : `Dernière lecture EDF : ${parisTime(checkedAt)}${error ? ' (données plus anciennes)' : ''}.`,
        );
      }
      if (calendar === 'refused') {
        parts.push(
          lang === 'en'
            ? 'Gladys refused the zen-flex calendar: another integration provides it, its values are used.'
            : 'Gladys a refusé le calendrier zen-flex : une autre intégration le fournit, ses valeurs servent.',
        );
      } else if (calendar === 'failed') {
        parts.push(
          lang === 'en'
            ? 'The days could not be sent to the Gladys calendar yet: tried again shortly.'
            : 'Les jours n’ont pas encore pu être envoyés au calendrier de Gladys : nouvel essai sous peu.',
        );
      }
      if (sceneError) {
        parts.push(
          lang === 'en'
            ? 'The announcement could not be sent to the scenes yet: tried again until midnight.'
            : 'L’annonce n’a pas encore pu être envoyée aux scènes : nouvel essai jusqu’à minuit.',
        );
      }
      if (dataError) {
        parts.push(
          lang === 'en'
            ? '/data cannot be written: the days are kept in memory only.'
            : '/data n’est pas inscriptible : les jours sont gardés en mémoire seulement.',
        );
      }
      out[lang] = parts.join(' ');
    }
    return out;
  },
};
