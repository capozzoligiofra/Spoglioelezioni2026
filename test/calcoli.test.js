import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applicaBozze,
  calcolaElezione,
  controllaConfigurazione,
  controllaSezione,
  dhondt,
  intero,
  normalizzaRisultati,
  preparaConfigurazione,
  sezioneCanonica,
} from '../js/calcoli.js';
import { formattaJSON } from '../js/json.js';

const leggi = (percorso) => JSON.parse(readFileSync(new URL(`../${percorso}`, import.meta.url), 'utf8'));
const seggiPerLista = (risultato) => Object.fromEntries(risultato.perLista);

// Configurazione minima usata in molti test.
function configProva({ seggi = 2, maxPreferenze = 1, liste } = {}) {
  const { config, errori } = preparaConfigurazione({
    sezioni: [
      { id: '1A', aventiDiritto: 20 },
      { id: '1B', aventiDiritto: 20 },
      { id: '1C', aventiDiritto: 20 },
    ],
    elezioni: [
      {
        id: 'ci',
        nome: "Consiglio d'Istituto",
        seggi,
        maxPreferenze,
        liste: liste ?? [
          { numero: 'I', nome: 'Alfa', candidati: [{ nome: 'Anna' }, { nome: 'Bruno' }, { nome: 'Carla' }] },
          { numero: 'II', nome: 'Beta', candidati: [{ nome: 'Dario' }, { nome: 'Elena' }] },
        ],
      },
    ],
  });
  assert.deepEqual(errori, []);
  return config;
}

test('intero: valori vuoti, negativi o non numerici valgono 0', () => {
  assert.equal(intero('12'), 12);
  assert.equal(intero(7.9), 7);
  assert.equal(intero(''), 0);
  assert.equal(intero(null), 0);
  assert.equal(intero(undefined), 0);
  assert.equal(intero(-3), 0);
  assert.equal(intero('abc'), 0);
});

test("D'Hondt: esempio classico", () => {
  // A: 100 50 33,3 25 · B: 80 40 26,7 20 · C: 30 15 …  → i 4 quozienti più alti: 100, 80, 50, 40
  const r = dhondt(
    [
      { id: 'A', voti: 100 },
      { id: 'B', voti: 80 },
      { id: 'C', voti: 30 },
    ],
    4,
  );
  assert.deepEqual(seggiPerLista(r), { A: 2, B: 2, C: 0 });
  assert.deepEqual(
    r.vincitori.map((q) => `${q.id}/${q.divisore}`),
    ['A/1', 'B/1', 'A/2', 'B/2'],
  );
  assert.equal(r.nonAssegnati, 0);
  assert.equal(r.sorteggio, null);
});

test("D'Hondt: a parità di quoziente vince la lista con più voti", () => {
  // A/2 = 30 e B/1 = 30: il secondo seggio va ad A, che ha più voti in totale.
  const r = dhondt(
    [
      { id: 'A', voti: 60 },
      { id: 'B', voti: 30 },
    ],
    2,
  );
  assert.deepEqual(seggiPerLista(r), { A: 2, B: 0 });
  assert.equal(r.sorteggio, null);
});

test("D'Hondt: parità perfetta all'ultimo seggio → sorteggio", () => {
  const r = dhondt(
    [
      { id: 'A', voti: 50 },
      { id: 'B', voti: 50 },
      { id: 'C', voti: 10 },
    ],
    1,
  );
  assert.deepEqual(r.sorteggio, { liste: ['A', 'B'], seggi: 1 });
});

test("D'Hondt: nessun sorteggio se la parità non è all'ultimo seggio", () => {
  const r = dhondt(
    [
      { id: 'A', voti: 50 },
      { id: 'B', voti: 50 },
    ],
    2,
  );
  assert.deepEqual(seggiPerLista(r), { A: 1, B: 1 });
  assert.equal(r.sorteggio, null);
});

test("D'Hondt: una lista senza più candidati cede i seggi alle altre", () => {
  const r = dhondt(
    [
      { id: 'A', voti: 100, maxSeggi: 1 },
      { id: 'B', voti: 10, maxSeggi: 5 },
    ],
    3,
  );
  assert.deepEqual(seggiPerLista(r), { A: 1, B: 2 });
  assert.equal(r.nonAssegnati, 0);
});

test("D'Hondt: seggi non assegnati se mancano candidati", () => {
  const r = dhondt([{ id: 'A', voti: 100, maxSeggi: 1 }], 3);
  assert.deepEqual(seggiPerLista(r), { A: 1 });
  assert.equal(r.nonAssegnati, 2);
});

test("D'Hondt: senza voti nessun seggio", () => {
  const r = dhondt([{ id: 'A', voti: 0 }], 2);
  assert.equal(r.vincitori.length, 0);
});

test('calcolaElezione: somma solo le sezioni scrutinate o in corso', () => {
  const config = configProva();
  const risultati = {
    sezioni: {
      '1A': {
        stato: 'scrutinata',
        elezioni: {
          ci: {
            votanti: 18,
            bianche: 1,
            nulle: 1,
            liste: { I: { voti: 10, preferenze: { Anna: 3, Bruno: 5 } }, II: { voti: 6, preferenze: { Dario: 4 } } },
          },
        },
      },
      '1B': {
        stato: 'in-corso',
        elezioni: { ci: { votanti: 15, liste: { I: { voti: 2 }, II: { voti: 4, preferenze: { Elena: 1 } } } } },
      },
      // Dati di una sezione non ancora scrutinata: vanno ignorati.
      '1C': { stato: 'da-scrutinare', elezioni: { ci: { votanti: 20, liste: { I: { voti: 20 } } } } },
    },
  };
  const r = calcolaElezione(config, config.elezioni[0], risultati);

  assert.deepEqual(
    { scrutinate: r.sezioni.scrutinata, inCorso: r.sezioni['in-corso'], totale: r.sezioni.totale },
    { scrutinate: 1, inCorso: 1, totale: 3 },
  );
  assert.equal(r.iniziato, true);
  assert.equal(r.completo, false);
  assert.equal(r.validi, 22);
  assert.equal(r.bianche, 1);
  assert.equal(r.nulle, 1);
  assert.equal(r.schede, 24);
  assert.equal(r.votanti, 33);
  assert.equal(r.aventiDirittoConDati, 40);
  assert.equal(r.affluenza, 33 / 40);
  assert.equal(r.aventiDiritto, 60);

  const [alfa, beta] = r.liste;
  assert.equal(alfa.voti, 12);
  assert.equal(beta.voti, 10);
  assert.equal(alfa.percentuale, 12 / 22);
  // 12, 10, 6, 5 → un seggio per lista
  assert.equal(alfa.seggi, 1);
  assert.equal(beta.seggi, 1);
  assert.deepEqual(
    r.seggi.assegnati.map((s) => [s.numero, s.lista.numero, s.candidato.nome]),
    [
      [1, 'I', 'Bruno'],
      [2, 'II', 'Dario'],
    ],
  );
  assert.deepEqual(
    alfa.candidati.map((c) => [c.nome, c.preferenze, c.eletto]),
    [
      ['Bruno', 5, true],
      ['Anna', 3, false],
      ['Carla', 0, false],
    ],
  );
});

test("calcolaElezione: a parità di preferenze vale l'ordine di lista", () => {
  const config = configProva({ seggi: 1 });
  const risultati = {
    sezioni: {
      '1A': {
        stato: 'scrutinata',
        elezioni: { ci: { votanti: 10, liste: { I: { voti: 10, preferenze: { Anna: 4, Bruno: 4 } } } } },
      },
    },
  };
  const r = calcolaElezione(config, config.elezioni[0], risultati);
  const alfa = r.liste[0];
  assert.equal(alfa.candidati[0].nome, 'Anna');
  assert.equal(alfa.candidati[0].eletto, true);
  assert.equal(alfa.paritaDecisaDallOrdine, true);
});

test('calcolaElezione: prima dello spoglio è tutto a zero', () => {
  const config = configProva();
  const r = calcolaElezione(config, config.elezioni[0], {});
  assert.equal(r.iniziato, false);
  assert.equal(r.validi, 0);
  assert.equal(r.affluenza, null);
  assert.equal(r.seggi.assegnati.length, 0);
  assert.equal(r.seggi.nonAssegnati, 0);
  assert.ok(r.liste.every((l) => l.percentuale === null));
});

test('controllaSezione: segnala dati impossibili e somme che non tornano', () => {
  const config = configProva({ maxPreferenze: 1 });
  const sezione = config.sezioni[0];
  const messaggi = (dati) => controllaSezione(config, sezione, dati).map((p) => p.livello);

  const corretta = {
    stato: 'scrutinata',
    elezioni: {
      ci: { votanti: 18, bianche: 1, nulle: 1, liste: { I: { voti: 10, preferenze: { Anna: 6 } }, II: { voti: 6 } } },
    },
  };
  assert.deepEqual(messaggi(corretta), []);

  // Le schede contate (17) non tornano con i votanti (18).
  const somme = structuredClone(corretta);
  somme.elezioni.ci.nulle = 0;
  assert.deepEqual(messaggi(somme), ['avviso']);

  // Più preferenze a un candidato che voti alla sua lista, e più del massimo.
  const preferenze = structuredClone(corretta);
  preferenze.elezioni.ci.liste.II.preferenze = { Dario: 7 };
  assert.deepEqual(messaggi(preferenze), ['errore', 'errore']);

  // Più votanti che aventi diritto.
  const votanti = structuredClone(corretta);
  votanti.elezioni.ci.votanti = 25;
  assert.ok(messaggi(votanti).includes('errore'));

  // Una sezione da scrutinare non viene controllata.
  assert.deepEqual(messaggi({ stato: 'da-scrutinare', elezioni: somme.elezioni }), []);
});

test('controllaConfigurazione: trova i doppioni e i campi mancanti', () => {
  const { errori } = controllaConfigurazione({
    sezioni: [{ id: '1A' }, { id: '1A' }],
    elezioni: [
      {
        id: 'Consiglio Istituto',
        nome: 'Consiglio',
        seggi: 0,
        liste: [
          { numero: 'I', nome: 'Alfa', candidati: [{ nome: 'Anna' }, { nome: 'Anna' }] },
          { numero: 'I', candidati: [] },
        ],
      },
    ],
  });
  assert.equal(errori.length, 6, errori.join('\n'));
  assert.deepEqual(controllaConfigurazione([]).errori.length, 1);
});

test("sezioneCanonica: stesso contenuto → stesso testo, qualunque sia l'ordine", () => {
  const config = configProva();
  const a = sezioneCanonica(config, {
    stato: 'in-corso',
    elezioni: { ci: { liste: { II: { voti: '4' }, I: { preferenze: { Bruno: 2 }, voti: 3 } }, votanti: 9 } },
  });
  const b = sezioneCanonica(config, {
    elezioni: {
      ci: { votanti: 9, bianche: 0, liste: { I: { voti: 3, preferenze: { Anna: 0, Bruno: 2 } }, II: { voti: 4 } } },
    },
    stato: 'in-corso',
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.elezioni.ci.liste.II, { voti: 4, preferenze: { Dario: 0, Elena: 0 } });
  assert.deepEqual(sezioneCanonica(config, undefined), { stato: 'da-scrutinare' });
});

test('applicaBozze: sostituisce solo le sezioni modificate e le ordina', () => {
  const config = configProva();
  const pubblicati = {
    aggiornato: '2026-10-22T09:00:00.000Z',
    definitivi: false,
    avviso: 'Prima comunicazione',
    sezioni: {
      '1C': { stato: 'scrutinata', aggiornato: '2026-10-22T09:00:00.000Z', elezioni: {} },
      '1A': { stato: 'in-corso', aggiornato: '2026-10-22T08:00:00.000Z' },
    },
  };
  const adesso = '2026-10-22T10:00:00.000Z';
  const nuovi = applicaBozze(config, pubblicati, { sezioni: { '1B': { stato: 'scrutinata' } }, avviso: '' }, adesso);
  assert.deepEqual(Object.keys(nuovi.sezioni), ['1A', '1B', '1C']);
  assert.deepEqual(nuovi.sezioni['1B'], { stato: 'scrutinata', aggiornato: adesso });
  assert.equal(nuovi.sezioni['1C'].aggiornato, '2026-10-22T09:00:00.000Z');
  assert.equal(nuovi.aggiornato, adesso);
  assert.equal(nuovi.avviso, '');
  assert.equal(nuovi.definitivi, false);
});

test("seggio unico: l'avanzamento si misura in schede scrutinate su votanti", () => {
  const { config } = preparaConfigurazione({
    sezioni: [{ id: 'seggio', nome: 'Seggio unico', aventiDiritto: 600 }],
    elezioni: [
      {
        id: 'ci',
        nome: 'Consiglio',
        seggi: 4,
        maxPreferenze: 2,
        liste: [
          { numero: 'I', nome: 'Alfa', candidati: [{ nome: 'Anna' }] },
          { numero: 'II', nome: 'Beta', candidati: [{ nome: 'Bruno' }] },
        ],
      },
    ],
  });
  const elezione = config.elezioni[0];

  const prima = calcolaElezione(config, elezione, {});
  assert.equal(prima.seggioUnico, true);
  assert.equal(prima.quotaSchede, null);

  const inCorso = calcolaElezione(config, elezione, {
    sezioni: {
      seggio: {
        stato: 'in-corso',
        elezioni: { ci: { votanti: 480, bianche: 2, nulle: 1, liste: { I: { voti: 70 }, II: { voti: 47 } } } },
      },
    },
  });
  assert.equal(inCorso.schede, 120);
  assert.equal(inCorso.votantiTotali, 480);
  assert.equal(inCorso.quotaSchede, 0.25);
  assert.equal(inCorso.affluenza, 0.8);
  assert.equal(inCorso.completo, false);
});

test('aggiornamento automatico: 10 secondi se non indicato, mai meno di 5', () => {
  const base = {
    sezioni: [{ id: 'seggio' }],
    elezioni: [{ id: 'ci', nome: 'C', seggi: 1, liste: [{ numero: 'I', nome: 'A', candidati: [{ nome: 'X' }] }] }],
  };
  assert.equal(preparaConfigurazione(base).config.aggiornamentoSecondi, 10);
  assert.equal(preparaConfigurazione({ ...base, aggiornamentoSecondi: 2 }).config.aggiornamentoSecondi, 5);
  assert.equal(preparaConfigurazione({ ...base, aggiornamentoSecondi: 20 }).config.aggiornamentoSecondi, 20);
});

test('formattaJSON: oggetti semplici su una riga e risultato rileggibile', () => {
  const dati = { a: 1, b: [{ id: '1A', n: 2 }], c: { d: { e: 'x' } }, f: [], g: {} };
  const testo = formattaJSON(dati);
  assert.deepEqual(JSON.parse(testo), dati);
  assert.match(testo, /\{ "id": "1A", "n": 2 \}/);
});

// --- I file di dati del sito ---------------------------------------------------
// Questi test girano anche su GitHub a ogni modifica: se data/elezioni.json
// contiene un errore (una virgola di troppo, una lista doppia…) lo segnalano.

test('data/elezioni.json è valido e data/risultati.json usa solo sezioni esistenti', () => {
  const { config, errori } = preparaConfigurazione(leggi('data/elezioni.json'));
  assert.deepEqual(errori, [], 'Errori in data/elezioni.json');
  const risultati = normalizzaRisultati(leggi('data/risultati.json'));
  const idSezioni = new Set(config.sezioni.map((s) => s.id));
  for (const id of Object.keys(risultati.sezioni)) {
    assert.ok(idSezioni.has(id), `La sezione "${id}" di data/risultati.json non esiste in data/elezioni.json`);
  }
});

test('data/demo: dati di esempio coerenti, spoglio completo, tutti i seggi assegnati', () => {
  const { config, errori, avvisi } = preparaConfigurazione(leggi('data/demo/elezioni.json'));
  assert.deepEqual([...errori, ...avvisi], []);
  const risultati = normalizzaRisultati(leggi('data/demo/risultati.json'));
  for (const sezione of config.sezioni) {
    assert.deepEqual(controllaSezione(config, sezione, risultati.sezioni[sezione.id]), [], `Sezione ${sezione.id}`);
  }
  for (const elezione of config.elezioni) {
    const r = calcolaElezione(config, elezione, risultati);
    assert.equal(r.completo, true);
    assert.equal(r.seggi.assegnati.length, elezione.seggi);
    assert.equal(r.seggi.sorteggio, null);
  }

  // Le tappe dello spoglio simulato: numeri coerenti e schede che crescono sempre.
  const { passi } = leggi('data/demo/spoglio.json');
  assert.ok(passi.length > 5);
  const precedenti = {};
  for (const [i, passo] of passi.entries()) {
    for (const sezione of config.sezioni) {
      assert.deepEqual(controllaSezione(config, sezione, passo.sezioni[sezione.id]), [], `Tappa ${i}`);
    }
    for (const elezione of config.elezioni) {
      const { schede } = calcolaElezione(config, elezione, passo);
      assert.ok(schede >= (precedenti[elezione.id] ?? 0), `Tappa ${i}: le schede scrutinate non possono diminuire`);
      precedenti[elezione.id] = schede;
    }
  }
});
