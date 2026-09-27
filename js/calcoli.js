/**
 * Calcoli dello spoglio: somme delle sezioni, percentuali, seggi con il
 * metodo D'Hondt, eletti e controlli di coerenza dei dati.
 *
 * Questo modulo non usa il browser (niente DOM, niente fetch), così gira
 * anche in Node ed è coperto dai test in test/calcoli.test.js.
 */

/** Stati possibili di una sezione (seggio), nell'ordine in cui avvengono. */
export const STATI_SEZIONE = ['da-scrutinare', 'in-corso', 'scrutinata'];

export const ETICHETTE_STATO = {
  'da-scrutinare': 'Da scrutinare',
  'in-corso': 'Scrutinio in corso',
  scrutinata: 'Scrutinata',
};

/** Colori disponibili per le liste (vedi --serie-1 … --serie-8 in css/stile.css). */
export const NUMERO_COLORI = 8;

/** Converte in intero ≥ 0: valori vuoti, negativi o non numerici valgono 0. */
export function intero(valore) {
  const n = Number(valore);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Stato di una sezione nei risultati; se manca o non è valido è "da-scrutinare". */
export function statoSezione(datiSezione) {
  const stato = datiSezione?.stato;
  return STATI_SEZIONE.includes(stato) ? stato : 'da-scrutinare';
}

function haTesto(valore) {
  return (typeof valore === 'string' && valore.trim() !== '') || typeof valore === 'number';
}

function interoNonNegativo(valore) {
  return Number.isInteger(valore) && valore >= 0;
}

// ---------------------------------------------------------------------------
// Configurazione (data/elezioni.json)
// ---------------------------------------------------------------------------

/**
 * Controlla la configurazione. Gli errori impediscono di mostrare i
 * risultati; gli avvisi segnalano scelte probabilmente sbagliate.
 * @returns {{errori: string[], avvisi: string[]}}
 */
export function controllaConfigurazione(config) {
  const errori = [];
  const avvisi = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    errori.push('Il file deve contenere un oggetto JSON: { ... }.');
    return { errori, avvisi };
  }

  if (!Array.isArray(config.sezioni) || config.sezioni.length === 0) {
    errori.push('Manca l\'elenco "sezioni" (serve almeno una sezione).');
  } else {
    const idSezioni = new Set();
    config.sezioni.forEach((sezione, i) => {
      if (!haTesto(sezione?.id)) {
        errori.push(`sezioni[${i}]: manca "id".`);
        return;
      }
      const id = String(sezione.id);
      if (idSezioni.has(id)) errori.push(`La sezione "${id}" compare due volte.`);
      idSezioni.add(id);
      if (sezione.aventiDiritto !== undefined && !interoNonNegativo(sezione.aventiDiritto)) {
        errori.push(`Sezione "${id}": "aventiDiritto" deve essere un numero intero (0 o più).`);
      }
    });
  }

  if (!Array.isArray(config.elezioni) || config.elezioni.length === 0) {
    errori.push('Manca l\'elenco "elezioni" (serve almeno un\'elezione).');
    return { errori, avvisi };
  }

  const idElezioni = new Set();
  config.elezioni.forEach((elezione, i) => {
    const nome = haTesto(elezione?.nome) ? `"${elezione.nome}"` : `elezioni[${i}]`;
    if (!haTesto(elezione?.nome)) errori.push(`elezioni[${i}]: manca "nome".`);
    if (typeof elezione?.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(elezione.id)) {
      errori.push(`${nome}: "id" deve contenere solo lettere minuscole, numeri e trattini (es. "consiglio-istituto").`);
    } else if (idElezioni.has(elezione.id)) {
      errori.push(`L'elezione "${elezione.id}" compare due volte.`);
    } else {
      idElezioni.add(elezione.id);
    }
    if (!Number.isInteger(elezione?.seggi) || elezione.seggi < 1) {
      errori.push(`${nome}: "seggi" deve essere un numero intero, almeno 1.`);
    }
    if (elezione?.maxPreferenze !== undefined && !interoNonNegativo(elezione.maxPreferenze)) {
      errori.push(`${nome}: "maxPreferenze" deve essere un numero intero (0 o più).`);
    }
    if (!Array.isArray(elezione?.liste) || elezione.liste.length === 0) {
      errori.push(`${nome}: serve almeno una lista in "liste".`);
      return;
    }
    if (elezione.liste.length > NUMERO_COLORI) {
      avvisi.push(
        `${nome}: ci sono più di ${NUMERO_COLORI} liste, dalla ${NUMERO_COLORI + 1}ª in poi verranno mostrate in grigio.`,
      );
    }

    const numeri = new Set();
    elezione.liste.forEach((lista, j) => {
      if (!haTesto(lista?.numero)) {
        errori.push(`${nome}, liste[${j}]: manca "numero" (es. "I").`);
        return;
      }
      const numero = String(lista.numero);
      const etichetta = `${nome}, lista ${numero}`;
      if (numeri.has(numero)) errori.push(`${nome}: la lista "${numero}" compare due volte.`);
      numeri.add(numero);
      if (!haTesto(lista.nome)) errori.push(`${etichetta}: manca "nome" (il motto della lista).`);
      if (!Array.isArray(lista.candidati)) {
        errori.push(`${etichetta}: manca l'elenco "candidati".`);
        return;
      }
      if (lista.candidati.length === 0) {
        avvisi.push(`${etichetta}: non ha candidati, quindi non potrà ottenere seggi.`);
      }
      const nomi = new Set();
      lista.candidati.forEach((candidato, k) => {
        if (!haTesto(candidato?.nome)) {
          errori.push(`${etichetta}, candidati[${k}]: manca "nome".`);
          return;
        }
        const nomeCandidato = String(candidato.nome);
        if (nomi.has(nomeCandidato)) errori.push(`${etichetta}: "${nomeCandidato}" compare due volte.`);
        nomi.add(nomeCandidato);
      });
    });
  });

  return { errori, avvisi };
}

/**
 * Controlla la configurazione e, se è valida, la restituisce "pulita":
 * valori predefiniti applicati, numeri di lista come stringhe, colore e
 * posizione in lista calcolati.
 */
export function preparaConfigurazione(grezza) {
  const { errori, avvisi } = controllaConfigurazione(grezza);
  if (errori.length > 0) return { config: null, errori, avvisi };

  const config = {
    ...grezza,
    aggiornamentoSecondi: intero(grezza.aggiornamentoSecondi) || 30,
    sezioni: grezza.sezioni.map((sezione) => ({
      id: String(sezione.id),
      nome: haTesto(sezione.nome) ? String(sezione.nome) : String(sezione.id),
      aventiDiritto: sezione.aventiDiritto === undefined ? null : sezione.aventiDiritto,
    })),
    elezioni: grezza.elezioni.map((elezione) => ({
      id: elezione.id,
      nome: String(elezione.nome),
      descrizione: haTesto(elezione.descrizione) ? String(elezione.descrizione) : '',
      seggi: elezione.seggi,
      maxPreferenze: elezione.maxPreferenze ?? 1,
      liste: elezione.liste.map((lista, indice) => ({
        numero: String(lista.numero),
        nome: String(lista.nome),
        colore: indice < NUMERO_COLORI ? indice + 1 : null,
        candidati: lista.candidati.map((candidato, posizione) => ({
          nome: String(candidato.nome),
          classe: haTesto(candidato.classe) ? String(candidato.classe) : '',
          posizione: posizione + 1,
        })),
      })),
    })),
  };
  return { config, errori, avvisi };
}

// ---------------------------------------------------------------------------
// Risultati (data/risultati.json)
// ---------------------------------------------------------------------------

/** Risultati vuoti: nessuna sezione scrutinata. */
export function risultatiVuoti() {
  return { aggiornato: null, definitivi: false, avviso: '', sezioni: {} };
}

/** Rende utilizzabile un oggetto risultati anche se incompleto. */
export function normalizzaRisultati(risultati) {
  const r = risultati && typeof risultati === 'object' ? risultati : {};
  return {
    aggiornato: typeof r.aggiornato === 'string' ? r.aggiornato : null,
    definitivi: r.definitivi === true,
    avviso: typeof r.avviso === 'string' ? r.avviso : '',
    sezioni: r.sezioni && typeof r.sezioni === 'object' ? r.sezioni : {},
  };
}

/** Conta le sezioni per stato (lo stato vale per tutte le elezioni). */
export function contaSezioni(config, risultati) {
  const conteggio = { totale: config.sezioni.length, 'da-scrutinare': 0, 'in-corso': 0, scrutinata: 0 };
  for (const sezione of config.sezioni) {
    conteggio[statoSezione(risultati.sezioni[sezione.id])] += 1;
  }
  return conteggio;
}

/**
 * Metodo D'Hondt (O.M. 215/1991): i voti di ogni lista si dividono per
 * 1, 2, 3, … e i seggi vanno ai quozienti più alti. A parità di quoziente
 * vince la lista con più voti; se anche i voti sono pari serve un sorteggio.
 * Una lista non può avere più seggi dei suoi candidati: i seggi in più
 * passano ai quozienti successivi delle altre liste.
 *
 * @param {{id: string, voti: number, maxSeggi?: number}[]} liste nell'ordine della scheda
 * @param {number} seggi numero di seggi da assegnare
 */
export function dhondt(liste, seggi) {
  const quozienti = [];
  liste.forEach((lista, ordine) => {
    const voti = intero(lista.voti);
    if (voti === 0) return;
    for (let divisore = 1; divisore <= seggi; divisore += 1) {
      quozienti.push({ id: lista.id, voti, divisore, valore: voti / divisore, ordine, seggio: null, esaurita: false });
    }
  });
  // Confronto esatto di voti/divisore con la moltiplicazione incrociata
  // (niente errori di arrotondamento), poi voti totali, poi ordine di scheda.
  quozienti.sort((a, b) => b.voti * a.divisore - a.voti * b.divisore || b.voti - a.voti || a.ordine - b.ordine);

  const perLista = new Map(liste.map((lista) => [lista.id, 0]));
  const capienza = new Map(liste.map((lista) => [lista.id, lista.maxSeggi ?? Infinity]));
  const vincitori = [];
  for (const q of quozienti) {
    if (vincitori.length === seggi) break;
    const ottenuti = perLista.get(q.id);
    if (ottenuti >= capienza.get(q.id)) {
      q.esaurita = true;
      continue;
    }
    perLista.set(q.id, ottenuti + 1);
    q.seggio = vincitori.length + 1;
    q.posizioneNellaLista = ottenuti + 1;
    vincitori.push(q);
  }

  // Parità all'ultimo seggio: stesso quoziente e stessi voti di un
  // quoziente rimasto fuori, di una lista che avrebbe ancora candidati.
  let sorteggio = null;
  const ultimo = vincitori[vincitori.length - 1];
  if (ultimo && vincitori.length === seggi) {
    const pari = (q) => q.voti === ultimo.voti && q.divisore === ultimo.divisore;
    const esclusi = quozienti.filter((q) => q.seggio === null && pari(q) && perLista.get(q.id) < capienza.get(q.id));
    if (esclusi.length > 0) {
      const inGioco = vincitori.filter(pari);
      sorteggio = { liste: [...inGioco, ...esclusi].map((q) => q.id), seggi: inGioco.length };
    }
  }

  return { perLista, vincitori, quozienti, nonAssegnati: seggi - vincitori.length, sorteggio };
}

/**
 * Riassume i risultati di un'elezione sommando le sezioni già scrutinate
 * o in corso di scrutinio.
 */
export function calcolaElezione(config, elezione, risultatiGrezzi) {
  const risultati = normalizzaRisultati(risultatiGrezzi);
  const liste = elezione.liste.map((lista) => ({
    numero: lista.numero,
    nome: lista.nome,
    colore: lista.colore,
    voti: 0,
    percentuale: null,
    seggi: 0,
    candidati: lista.candidati.map((c) => ({ ...c, preferenze: 0, eletto: false })),
    paritaDecisaDallOrdine: false,
  }));

  const totali = { votanti: 0, bianche: 0, nulle: 0, validi: 0, aventiDirittoConDati: 0 };
  const perSezione = [];
  let conDati = 0;

  for (const sezione of config.sezioni) {
    const datiSezione = risultati.sezioni[sezione.id];
    const stato = statoSezione(datiSezione);
    const riga = {
      id: sezione.id,
      nome: sezione.nome,
      stato,
      aventiDiritto: sezione.aventiDiritto,
      votanti: null,
      bianche: 0,
      nulle: 0,
      validi: 0,
      voti: {},
    };
    perSezione.push(riga);
    const dati = stato === 'da-scrutinare' ? null : datiSezione.elezioni?.[elezione.id];
    if (!dati) continue;

    conDati += 1;
    riga.votanti = intero(dati.votanti);
    riga.bianche = intero(dati.bianche);
    riga.nulle = intero(dati.nulle);
    for (const lista of liste) {
      const datiLista = dati.liste?.[lista.numero];
      const voti = intero(datiLista?.voti);
      riga.voti[lista.numero] = voti;
      riga.validi += voti;
      lista.voti += voti;
      for (const candidato of lista.candidati) {
        candidato.preferenze += intero(datiLista?.preferenze?.[candidato.nome]);
      }
    }
    totali.bianche += riga.bianche;
    totali.nulle += riga.nulle;
    totali.validi += riga.validi;
    if (riga.votanti > 0 && sezione.aventiDiritto !== null) {
      totali.votanti += riga.votanti;
      totali.aventiDirittoConDati += sezione.aventiDiritto;
    }
  }

  for (const lista of liste) {
    lista.percentuale = totali.validi > 0 ? lista.voti / totali.validi : null;
  }

  const assegnazione = dhondt(
    liste.map((l) => ({ id: l.numero, voti: l.voti, maxSeggi: l.candidati.length })),
    elezione.seggi,
  );
  const perNumero = new Map(liste.map((l) => [l.numero, l]));

  // Eletti di ogni lista: più preferenze; a parità, chi viene prima in lista.
  for (const lista of liste) {
    lista.seggi = assegnazione.perLista.get(lista.numero) ?? 0;
    lista.candidati.sort((a, b) => b.preferenze - a.preferenze || a.posizione - b.posizione);
    lista.candidati.forEach((candidato, i) => {
      candidato.eletto = i < lista.seggi;
    });
    const ultimoEletto = lista.candidati[lista.seggi - 1];
    const primoEscluso = lista.candidati[lista.seggi];
    lista.paritaDecisaDallOrdine = Boolean(
      ultimoEletto && primoEscluso && ultimoEletto.preferenze === primoEscluso.preferenze,
    );
  }

  // Il k-esimo seggio vinto da una lista va al suo k-esimo candidato più votato.
  const seggiAssegnati = assegnazione.vincitori.map((q) => {
    const lista = perNumero.get(q.id);
    return {
      numero: q.seggio,
      lista,
      candidato: lista.candidati[q.posizioneNellaLista - 1],
      quoziente: q,
    };
  });

  // Tabella dei quozienti per la spiegazione del metodo.
  const tabellaQuozienti = liste.map((lista) => ({
    lista,
    quozienti: assegnazione.quozienti.filter((q) => q.id === lista.numero),
  }));

  const conteggio = contaSezioni(config, risultati);
  const aventiDirittoNoti = config.sezioni.every((s) => s.aventiDiritto !== null);

  return {
    elezione,
    sezioni: conteggio,
    iniziato: conDati > 0,
    completo: conteggio.scrutinata === conteggio.totale,
    definitivi: risultati.definitivi,
    aventiDiritto: aventiDirittoNoti ? config.sezioni.reduce((s, x) => s + x.aventiDiritto, 0) : null,
    votanti: totali.votanti,
    aventiDirittoConDati: totali.aventiDirittoConDati,
    affluenza: totali.aventiDirittoConDati > 0 ? totali.votanti / totali.aventiDirittoConDati : null,
    bianche: totali.bianche,
    nulle: totali.nulle,
    validi: totali.validi,
    schede: totali.validi + totali.bianche + totali.nulle,
    liste,
    seggi: {
      assegnati: seggiAssegnati,
      nonAssegnati: totali.validi > 0 ? assegnazione.nonAssegnati : 0,
      sorteggio: assegnazione.sorteggio
        ? { liste: assegnazione.sorteggio.liste.map((id) => perNumero.get(id)), seggi: assegnazione.sorteggio.seggi }
        : null,
      tabellaQuozienti,
    },
    perSezione,
  };
}

// ---------------------------------------------------------------------------
// Dati inseriti dagli scrutatori
// ---------------------------------------------------------------------------

/**
 * Riscrive i dati di una sezione in forma "canonica": solo le elezioni,
 * liste e candidati della configurazione, tutti i numeri interi, sempre
 * nello stesso ordine. Così due versioni si confrontano con JSON.stringify.
 */
export function sezioneCanonica(config, datiSezione) {
  const canonica = { stato: statoSezione(datiSezione) };
  if (!datiSezione?.elezioni) return canonica;
  const elezioni = {};
  for (const elezione of config.elezioni) {
    const dati = datiSezione.elezioni[elezione.id];
    if (!dati) continue;
    const liste = {};
    for (const lista of elezione.liste) {
      const datiLista = dati.liste?.[lista.numero];
      liste[lista.numero] = { voti: intero(datiLista?.voti) };
      if (elezione.maxPreferenze > 0) {
        liste[lista.numero].preferenze = Object.fromEntries(
          lista.candidati.map((c) => [c.nome, intero(datiLista?.preferenze?.[c.nome])]),
        );
      }
    }
    elezioni[elezione.id] = {
      votanti: intero(dati.votanti),
      bianche: intero(dati.bianche),
      nulle: intero(dati.nulle),
      liste,
    };
  }
  if (Object.keys(elezioni).length > 0) canonica.elezioni = elezioni;
  return canonica;
}

/**
 * Applica le bozze dello scrutatore ai risultati pubblicati e restituisce
 * il nuovo contenuto di data/risultati.json (sezioni nell'ordine della
 * configurazione, orario dell'aggiornamento su ogni sezione modificata).
 */
export function applicaBozze(config, risultati, bozze, adesso) {
  const base = normalizzaRisultati(risultati);
  const sezioni = { ...base.sezioni };
  for (const [id, dati] of Object.entries(bozze.sezioni ?? {})) {
    const { stato, ...resto } = sezioneCanonica(config, dati);
    sezioni[id] = { stato, aggiornato: adesso, ...resto };
  }
  const posizione = new Map(config.sezioni.map((s, i) => [s.id, i]));
  const ultimo = config.sezioni.length;
  return {
    aggiornato: adesso,
    definitivi: bozze.definitivi ?? base.definitivi,
    avviso: bozze.avviso ?? base.avviso,
    sezioni: Object.fromEntries(
      Object.entries(sezioni).sort(([a], [b]) => (posizione.get(a) ?? ultimo) - (posizione.get(b) ?? ultimo)),
    ),
  };
}

// ---------------------------------------------------------------------------
// Controlli sui dati inseriti dagli scrutatori
// ---------------------------------------------------------------------------

/**
 * Controlla i numeri di una sezione. Restituisce una lista di problemi:
 * "errore" per dati impossibili, "avviso" per dati da ricontrollare.
 * @returns {{livello: 'errore'|'avviso', elezione: string, messaggio: string}[]}
 */
export function controllaSezione(config, sezione, datiSezione) {
  const problemi = [];
  const stato = statoSezione(datiSezione);
  if (stato === 'da-scrutinare') return problemi;

  for (const elezione of config.elezioni) {
    const dati = datiSezione.elezioni?.[elezione.id] ?? {};
    const aggiungi = (livello, messaggio) => problemi.push({ livello, elezione: elezione.id, messaggio });
    const votanti = intero(dati.votanti);
    const bianche = intero(dati.bianche);
    const nulle = intero(dati.nulle);
    let validi = 0;

    for (const lista of elezione.liste) {
      const datiLista = dati.liste?.[lista.numero] ?? {};
      const voti = intero(datiLista.voti);
      validi += voti;
      let totalePreferenze = 0;
      for (const candidato of lista.candidati) {
        const preferenze = intero(datiLista.preferenze?.[candidato.nome]);
        totalePreferenze += preferenze;
        if (preferenze > voti) {
          aggiungi(
            'errore',
            `${candidato.nome} (lista ${lista.numero}) ha ${preferenze} preferenze ma la lista ha solo ${voti} voti.`,
          );
        }
      }
      if (elezione.maxPreferenze === 0 && totalePreferenze > 0) {
        aggiungi('errore', `Lista ${lista.numero}: in questa elezione non si esprimono preferenze.`);
      } else if (totalePreferenze > voti * elezione.maxPreferenze) {
        aggiungi(
          'errore',
          `Lista ${lista.numero}: ${totalePreferenze} preferenze sono troppe per ${voti} voti (massimo ${voti * elezione.maxPreferenze}, cioè ${elezione.maxPreferenze} per scheda).`,
        );
      }
    }

    const schede = validi + bianche + nulle;
    if (sezione.aventiDiritto !== null && votanti > sezione.aventiDiritto) {
      aggiungi('errore', `I votanti (${votanti}) sono più degli aventi diritto (${sezione.aventiDiritto}).`);
    }
    if (stato === 'scrutinata') {
      if (votanti === 0) {
        aggiungi('avviso', 'Manca il numero dei votanti.');
      } else if (schede !== votanti) {
        aggiungi(
          'avviso',
          `Voti di lista + bianche + nulle fanno ${schede}, ma i votanti sono ${votanti}: ricontrolla i numeri.`,
        );
      }
    } else if (votanti > 0 && schede > votanti) {
      aggiungi('avviso', `Le schede contate (${schede}) sono già più dei votanti (${votanti}).`);
    }
  }
  return problemi;
}
