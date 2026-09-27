/** Caricamento dei file di dati e modalità dimostrativa. */

import { normalizzaRisultati, risultatiVuoti } from './calcoli.js';

/** true se l'indirizzo contiene ?demo: si usano i dati inventati di data/demo/. */
export const modalitaDemo = () => new URLSearchParams(window.location.search).has('demo');

export function percorsi(demo) {
  const cartella = demo ? 'data/demo' : 'data';
  return {
    config: `${cartella}/elezioni.json`,
    risultati: `${cartella}/risultati.json`,
    // Solo per la demo: le tappe intermedie dello spoglio simulato.
    spoglio: `${cartella}/spoglio.json`,
  };
}

export class ErroreDati extends Error {}

/**
 * Scarica e interpreta un file JSON del sito.
 * Con fresco = true salta la cache del browser, per vedere subito i dati nuovi.
 */
export async function caricaJSON(url, { fresco = false } = {}) {
  // Il parametro cambia ogni 5 secondi: i dati restano freschi ma chi apre
  // la pagina nello stesso momento condivide la stessa copia in cache.
  const indirizzo = fresco ? `${url}?v=${Math.floor(Date.now() / 5000)}` : url;
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
 * Simula uno spoglio in diretta con i dati di esempio: a ogni lettura mostra
 * la tappa successiva di data/demo/spoglio.json (i conteggi parziali man mano
 * che le schede vengono scrutinate), fino ai risultati finali.
 */
export async function sorgenteDemo(file) {
  const finali = normalizzaRisultati(await caricaJSON(file.risultati));
  const { passi = [] } = await caricaJSON(file.spoglio);
  const tappe = [...passi.map((passo) => ({ ...risultatiVuoti(), sezioni: passo.sezioni ?? {} })), finali];
  let prossima = 0;

  return {
    demo: true,
    intervalloMs: 2500,
    get finita() {
      return prossima >= tappe.length;
    },
    async leggi() {
      const tappa = tappe[Math.min(prossima, tappe.length - 1)];
      prossima += 1;
      return { ...tappa, aggiornato: new Date().toISOString() };
    },
    saltaAllaFine() {
      prossima = tappe.length - 1;
    },
    ricomincia() {
      prossima = 0;
    },
  };
}
