/** Caricamento dei file di dati e modalità dimostrativa. */

import { normalizzaRisultati } from './calcoli.js';

/** true se l'indirizzo contiene ?demo: si usano i dati inventati di data/demo/. */
export const modalitaDemo = () => new URLSearchParams(window.location.search).has('demo');

export function percorsi(demo) {
  const cartella = demo ? 'data/demo' : 'data';
  return { config: `${cartella}/elezioni.json`, risultati: `${cartella}/risultati.json` };
}

export class ErroreDati extends Error {}

/**
 * Scarica e interpreta un file JSON del sito.
 * Con fresco = true salta la cache del browser, per vedere subito i dati nuovi.
 */
export async function caricaJSON(url, { fresco = false } = {}) {
  // Il parametro cambia ogni 10 secondi: i dati restano freschi ma chi apre
  // la pagina nello stesso momento condivide la stessa copia in cache.
  const indirizzo = fresco ? `${url}?v=${Math.floor(Date.now() / 10000)}` : url;
  let risposta;
  try {
    risposta = await fetch(indirizzo, { cache: fresco ? 'no-store' : 'no-cache' });
  } catch {
    throw new ErroreDati('Connessione non disponibile.');
  }
  if (!risposta.ok) throw new ErroreDati(`Impossibile leggere ${url} (errore ${risposta.status}).`);
  const testo = await risposta.text();
  try {
    return JSON.parse(testo);
  } catch (errore) {
    throw new ErroreDati(`Il file ${url} non è un JSON valido: ${errore.message}`);
  }
}

/** Sorgente dei risultati pubblicati dagli scrutatori (data/risultati.json). */
export function sorgenteReale(url) {
  return {
    demo: false,
    leggi: async () => normalizzaRisultati(await caricaJSON(url, { fresco: true })),
  };
}

/**
 * Simula uno spoglio in diretta con i dati di esempio: a ogni lettura
 * compare una sezione scrutinata in più, in ordine sparso.
 */
export async function sorgenteDemo(url, config) {
  const completi = normalizzaRisultati(await caricaJSON(url));
  const ordine = mescola(config.sezioni.map((s) => s.id));
  let mostrate = 0;

  return {
    demo: true,
    intervalloMs: 2500,
    get finita() {
      return mostrate > ordine.length;
    },
    async leggi() {
      const n = Math.min(mostrate, ordine.length);
      const sezioni = {};
      for (const id of ordine.slice(0, n)) sezioni[id] = completi.sezioni[id];
      if (n < ordine.length) sezioni[ordine[n]] = { stato: 'in-corso' };
      mostrate += 1;
      return {
        aggiornato: new Date().toISOString(),
        definitivi: n === ordine.length && completi.definitivi,
        avviso: n === ordine.length ? completi.avviso : '',
        sezioni,
      };
    },
    saltaAllaFine() {
      mostrate = ordine.length;
    },
    ricomincia() {
      mostrate = 0;
    },
  };
}

/** Mescola sempre nello stesso modo (così la demo è ripetibile). */
function mescola(elementi) {
  const copia = [...elementi];
  let seme = 20261022;
  const casuale = () => {
    seme = (seme * 1103515245 + 12345) % 2147483648;
    return seme / 2147483648;
  };
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(casuale() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
