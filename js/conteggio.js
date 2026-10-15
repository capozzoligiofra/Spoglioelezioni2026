/**
 * Conteggio "scheda per scheda" dell'area scrutatori, pensato per il telefono.
 *
 * Un tocco sulla lista (solo voto di lista), su «Bianca» o su «Nulla» registra
 * subito una scheda. Dove si danno 2 preferenze, il tocco su un candidato apre
 * la scheda e il secondo nome la registra: se la scheda ha un solo nome si
 * preme «Solo 1 preferenza». (Si può anche scegliere di registrare subito al
 * primo nome e aggiungere l'altro con «+ preferenza».) I numeri vanno sul sito
 * pubblico in automatico ogni tot schede, per non pubblicare a ogni tocco.
 */

import { applicaScheda, elezioneCanonica, intero, schedeContate } from './calcoli.js';
import { classeColore, h, icona, simboloLista } from './dom.js';
import * as formato from './formato.js';

/** Ogni quante schede pubblicare in automatico (0 = solo a mano). */
export const OGNI_QUANTE_SCHEDE = [10, 20, 50, 0];
/** Se il conteggio si ferma, le schede ancora da pubblicare partono dopo questa pausa. */
const PAUSA_MS = 2 * 60_000;
/** Dopo una pubblicazione automatica non riuscita si riprova dopo questo tempo. */
const RIPROVA_MS = 30_000;
/** Se è già in corso un'altra pubblicazione (per esempio a mano) si riprova dopo questo tempo. */
const OCCUPATO_MS = 5_000;

/** Un secondo tocco sullo stesso tasto entro questo tempo è un doppio tocco involontario. */
const DOPPIO_TOCCO_MS = 600;

/** "Lista II · Rossi Mario, Bianchi Anna", "Scheda bianca", "Scheda nulla" */
export function descriviScheda(scheda) {
  if (scheda.tipo === 'bianca') return 'Scheda bianca';
  if (scheda.tipo === 'nulla') return 'Scheda nulla';
  if (scheda.tipo === 'lista') {
    return `Lista ${scheda.lista}${scheda.preferenze.length ? ` · ${scheda.preferenze.join(', ')}` : ''}`;
  }
  return '';
}

/** La scheda in corso salvata, se è ancora valida per questa elezione. */
function schedaInCorsoValida(elezione, salvata) {
  const lista = elezione.liste.find((l) => l.numero === salvata?.lista);
  if (!lista || !Array.isArray(salvata.preferenze)) return null;
  const preferenze = salvata.preferenze.filter((nome) => lista.candidati.some((c) => c.nome === nome));
  return preferenze.length > 0 && preferenze.length < elezione.maxPreferenze
    ? { lista: lista.numero, preferenze }
    : null;
}

/**
 * @param {object} opzioni
 * @param {object} opzioni.config configurazione delle elezioni
 * @param {object} opzioni.sezione la sezione (seggio) che si sta contando
 * @param {object} opzioni.memoria leggi/scrivi su localStorage
 * @param {string} opzioni.chiave chiave di localStorage per le impostazioni del conteggio
 * @param {(idElezione: string) => object} opzioni.dati numeri attuali (bozza compresa)
 * @param {(idElezione: string) => object} opzioni.datiPubblicati numeri già pubblicati
 * @param {(idElezione: string, dati: object) => void} opzioni.salva salva i numeri nuovi come bozza
 * @param {(opzioni: object) => Promise<boolean|null>} opzioni.pubblica pubblica le bozze
 * @param {() => boolean} opzioni.puoPubblicare vero se il dispositivo può pubblicare
 * @param {(testo: string) => void} opzioni.annuncia messaggio per i lettori di schermo
 */
export function creaConteggio({
  config,
  sezione,
  memoria,
  chiave,
  dati,
  datiPubblicati,
  salva,
  pubblica,
  puoPubblicare,
  annuncia,
}) {
  const salvate = memoria.leggi(chiave, {});
  const elezioneSalvata = config.elezioni.find((e) => e.id === salvate.elezione) ?? config.elezioni[0];
  const stato = {
    elezione: elezioneSalvata.id,
    ogni: OGNI_QUANTE_SCHEDE.includes(salvate.ogniSchede) ? salvate.ogniSchede : 10,
    // true (predefinito): con 2 preferenze la scheda si registra al secondo nome
    aspetta: salvate.aspettaSecondo !== false,
    // Scheda aperta dal primo nome e non ancora registrata: { lista, preferenze }
    inCorso: schedaInCorsoValida(elezioneSalvata, salvate.inCorso),
    storico: Array.isArray(salvate.storico) ? salvate.storico.slice(-200) : [],
    // true dopo «+ preferenza»: il prossimo candidato toccato va sull'ultima scheda
    aggiungi: false,
    ultimoTasto: null,
    ultimoTocco: 0,
    timer: null,
    inVolo: false,
    erroreAlle: 0,
    occupatoAlle: 0,
  };
  const el = { tasti: new Map() };

  const elezione = () => config.elezioni.find((e) => e.id === stato.elezione);
  const numeri = () => elezioneCanonica(elezione(), dati(stato.elezione));
  // Schede ancora da pubblicare, in tutte le elezioni del seggio. Una correzione che non
  // cambia il numero di schede (annulla, + preferenza, votanti) conta come una scheda.
  const daPubblicare = () =>
    config.elezioni.reduce((totale, e) => {
      const attuali = elezioneCanonica(e, dati(e.id));
      const pubblicati = elezioneCanonica(e, datiPubblicati(e.id));
      if (JSON.stringify(attuali) === JSON.stringify(pubblicati)) return totale;
      return totale + Math.max(1, Math.abs(schedeContate(e, attuali) - schedeContate(e, pubblicati)));
    }, 0);
  const persisti = () =>
    memoria.scrivi(chiave, {
      elezione: stato.elezione,
      ogniSchede: stato.ogni,
      aspettaSecondo: stato.aspetta,
      inCorso: stato.inCorso,
      storico: stato.storico.slice(-200),
    });
  /** Con questa elezione e questa lista la scheda aspetta il secondo nome? */
  const aspettaSecondo = (lista) =>
    stato.aspetta &&
    elezione().maxPreferenze >= 2 &&
    (elezione().liste.find((l) => l.numero === lista)?.candidati.length ?? 0) >= 2;
  const ultimaDellElezione = () => {
    for (let i = stato.storico.length - 1; i >= 0; i -= 1) {
      const voce = stato.storico[i];
      if (voce.sezione === sezione.id && voce.elezione === stato.elezione) return i;
    }
    return -1;
  };

  // ------------------------------------------------------------ Elementi fissi

  el.schedaCorrente = h('p', { class: 'scheda-corrente', 'aria-live': 'polite' });
  el.annullaUltima = h(
    'button',
    { type: 'button', class: 'bottone pericolo', onclick: annullaUltima },
    icona('sinistra'),
    'Annulla',
  );
  el.aggiungi = h('button', { type: 'button', class: 'bottone tasto-aggiungi', onclick: cambiaAggiungi });
  el.soloUna = h(
    'button',
    { type: 'button', class: 'bottone primario tasto-solo-una', onclick: registraInCorso },
    'Solo 1 preferenza',
  );
  const barra = h(
    'div',
    { class: 'riga-conteggio' },
    el.schedaCorrente,
    h('div', { class: 'riga-azioni' }, el.annullaUltima, el.aggiungi, el.soloUna),
  );

  el.schede = h('div', {
    class: 'scelta-modalita scelta-elezione',
    role: 'group',
    'aria-label': 'Elezione da contare',
  });
  el.contate = h('p', { class: 'riepilogo-conteggio' });
  el.votanti = h('input', {
    id: 'votanti-conteggio',
    class: 'input numero',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    maxlength: '5',
    autocomplete: 'off',
    'aria-describedby': 'votanti-conteggio-aiuto',
    oninput: cambiaVotanti,
  });
  el.griglia = h('div', { class: 'griglia-conteggio' });
  el.automatica = h(
    'select',
    { id: 'pubblica-ogni', class: 'input', onchange: cambiaAutomatica },
    OGNI_QUANTE_SCHEDE.map((n) =>
      h('option', { value: String(n) }, n ? `Ogni ${n} schede` : 'Solo quando premo «Pubblica»'),
    ),
  );
  el.statoAutomatica = h('p', { class: 'nota' });
  el.aspetta = h('input', { id: 'aspetta-secondo', type: 'checkbox', onchange: cambiaAspetta });

  const elemento = h(
    'div',
    { class: 'conteggio' },
    config.elezioni.length > 1 ? el.schede : null,
    h(
      'div',
      { class: 'testa-conteggio' },
      el.contate,
      h(
        'div',
        { class: 'campo campo-votanti' },
        h('label', { for: 'votanti-conteggio' }, 'Votanti'),
        el.votanti,
        h('span', { class: 'aiuto', id: 'votanti-conteggio-aiuto' }, 'Dal registro'),
      ),
    ),
    (el.spiegazione = h('p', { class: 'nota' })),
    el.griglia,
    h(
      'div',
      { class: 'campo pubblicazione-automatica' },
      h('label', { for: 'pubblica-ogni' }, 'Pubblica in automatico'),
      el.automatica,
      el.statoAutomatica,
    ),
    config.elezioni.some((e) => e.maxPreferenze >= 2)
      ? h(
          'div',
          { class: 'casella aspetta-secondo' },
          el.aspetta,
          h(
            'label',
            { for: 'aspetta-secondo' },
            'Con 2 preferenze aspetta il secondo nome prima di registrare la scheda',
          ),
        )
      : null,
  );

  costruisciGriglia();
  disegna();

  // ---------------------------------------------------------------- Disegno

  function costruisciGriglia() {
    const e = elezione();
    el.tasti.clear();
    // Ogni tasto ha un numero (voti o preferenze già contati) che si aggiorna da solo.
    const tasto = (chiaveTasto, classe, onclick, contenuto, conta = h('span', { class: 'conta' })) => {
      const bottone = h('button', { type: 'button', class: classe, onclick }, ...contenuto);
      if (!bottone.contains(conta)) bottone.append(conta);
      el.tasti.set(chiaveTasto, { bottone, conta });
      return bottone;
    };
    el.griglia.replaceChildren(
      ...e.liste.map((lista) =>
        h(
          'section',
          { class: `conteggio-lista ${classeColore(lista.colore)}`, 'aria-label': `Lista ${lista.numero}` },
          tasto(
            `lista:${lista.numero}`,
            'tasto-lista',
            () => tocca({ tipo: 'lista', lista: lista.numero }, `lista:${lista.numero}`),
            [
              simboloLista(lista, 'piccolo'),
              h(
                'span',
                { class: 'tasto-testo' },
                h('span', { class: 'tasto-nome' }, `Lista ${lista.numero} – ${lista.nome}`),
              ),
            ],
          ),
          e.maxPreferenze > 0 && lista.candidati.length
            ? h(
                'div',
                { class: 'griglia-candidati' },
                lista.candidati.map((candidato) => {
                  // Nei candidati il numero di preferenze sta sotto il nome, per lasciargli spazio.
                  const conta = h('span', { class: 'conta' });
                  return tasto(
                    `candidato:${lista.numero}:${candidato.nome}`,
                    'tasto-candidato',
                    () =>
                      tocca(
                        { tipo: 'candidato', lista: lista.numero, nome: candidato.nome },
                        `candidato:${lista.numero}:${candidato.nome}`,
                      ),
                    [
                      h(
                        'span',
                        { class: 'tasto-testo' },
                        h('span', { class: 'tasto-nome' }, candidato.nome),
                        h(
                          'span',
                          { class: 'tasto-dettaglio' },
                          candidato.classe ? `${candidato.classe} · ` : '',
                          conta,
                        ),
                      ),
                    ],
                    conta,
                  );
                }),
              )
            : null,
        ),
      ),
      h(
        'div',
        { class: 'tasti-speciali' },
        tasto('bianca', 'tasto-speciale', () => tocca({ tipo: 'bianca' }, 'bianca'), [
          h('span', { class: 'tasto-nome' }, 'Bianca'),
        ]),
        tasto('nulla', 'tasto-speciale', () => tocca({ tipo: 'nulla' }, 'nulla'), [
          h('span', { class: 'tasto-nome' }, 'Nulla'),
        ]),
      ),
    );
    el.schede.replaceChildren(
      ...config.elezioni.map((altra) =>
        h(
          'button',
          {
            type: 'button',
            class: 'bottone',
            'aria-pressed': String(altra.id === stato.elezione),
            onclick: () => cambiaElezione(altra.id),
          },
          altra.nome,
        ),
      ),
    );
  }

  function disegna() {
    const e = elezione();
    const n = numeri();
    const contate = schedeContate(e, n);
    const ultima = ultimaDellElezione();
    const voce = ultima < 0 ? null : stato.storico[ultima];
    if (!puoAggiungere(voce)) stato.aggiungi = false;
    const inCorso = stato.inCorso;

    // Numeri sui tasti
    for (const lista of e.liste) {
      const tastoLista = el.tasti.get(`lista:${lista.numero}`);
      tastoLista.conta.textContent = formato.conteggio(n.liste[lista.numero].voti, 'voto', 'voti');
      tastoLista.bottone.classList.toggle(
        'in-attesa',
        (stato.aggiungi && voce.scheda.lista === lista.numero) || inCorso?.lista === lista.numero,
      );
      for (const candidato of lista.candidati) {
        const tastoCandidato = el.tasti.get(`candidato:${lista.numero}:${candidato.nome}`);
        if (!tastoCandidato) continue;
        const scelto = inCorso?.lista === lista.numero && inCorso.preferenze.includes(candidato.nome);
        tastoCandidato.bottone.setAttribute('aria-pressed', String(scelto));
        tastoCandidato.conta.textContent = formato.conteggio(
          n.liste[lista.numero].preferenze[candidato.nome],
          'pref.',
          'pref.',
        );
      }
    }
    el.tasti.get('bianca').conta.textContent = formato.numero(n.bianche);
    el.tasti.get('nulla').conta.textContent = formato.numero(n.nulle);

    // Riepilogo e votanti
    el.contate.replaceChildren(
      h('strong', {}, formato.conteggio(contate, 'scheda contata', 'schede contate')),
      n.votanti ? ` su ${formato.numero(n.votanti)} votanti` : '',
    );
    if (document.activeElement !== el.votanti) el.votanti.value = n.votanti ? String(n.votanti) : '';

    // Spiegazione sopra i tasti
    el.spiegazione.textContent =
      e.maxPreferenze >= 2 && stato.aspetta
        ? 'Tocca i due nomi votati: la scheda si registra al secondo. Se la scheda ha un solo nome premi «Solo 1 preferenza» in basso. La lista (senza nomi), «Bianca» e «Nulla» registrano subito.'
        : e.maxPreferenze >= 2
          ? "Ogni tocco registra subito una scheda: sul candidato (vale anche come voto alla sua lista), sulla lista se non ci sono preferenze, oppure su «Bianca» o «Nulla». Se la scheda ha un'altra preferenza premi «+ preferenza» in basso e poi il secondo nome."
          : 'Ogni tocco registra subito una scheda: sul candidato (vale anche come voto alla sua lista), sulla lista se non ci sono preferenze, oppure su «Bianca» o «Nulla».';
    el.aspetta.checked = stato.aspetta;

    // Barra in basso: scheda in corso o ultima scheda registrata, annulla, + preferenza
    if (inCorso) {
      el.schedaCorrente.replaceChildren(
        h('strong', {}, `Scheda n. ${formato.numero(contate + 1)}: `),
        descriviScheda({ tipo: 'lista', ...inCorso }),
        h('br'),
        `Tocca il secondo nome della Lista ${inCorso.lista}, oppure «Solo 1 preferenza».`,
      );
    } else if (stato.aggiungi) {
      el.schedaCorrente.replaceChildren(
        h('strong', {}, `Tocca l'altro candidato della Lista ${voce.scheda.lista}`),
        ` (scheda n. ${formato.numero(contate)})`,
      );
    } else if (voce) {
      el.schedaCorrente.replaceChildren(
        icona('spunta'),
        ' ',
        h('strong', {}, `Scheda n. ${formato.numero(voce.numero ?? contate)}: `),
        descriviScheda(voce.scheda),
      );
    } else {
      el.schedaCorrente.replaceChildren('Tocca un candidato, una lista, «Bianca» o «Nulla»: ogni tocco è una scheda.');
    }
    el.annullaUltima.hidden = !inCorso && (!voce || stato.aggiungi);
    el.aggiungi.hidden = Boolean(inCorso) || !puoAggiungere(voce);
    el.soloUna.hidden = !inCorso;
    el.aggiungi.replaceChildren(stato.aggiungi ? 'Non aggiungere' : '+ preferenza');
    el.aggiungi.setAttribute('aria-pressed', String(stato.aggiungi));

    // Pubblicazione automatica
    el.automatica.value = String(stato.ogni);
    el.statoAutomatica.textContent = spiegazioneAutomatica();
  }

  /** Si può aggiungere una preferenza all'ultima scheda? (è di lista e non ha ancora il massimo) */
  function puoAggiungere(voce) {
    if (!voce || voce.scheda.tipo !== 'lista') return false;
    const lista = elezione().liste.find((l) => l.numero === voce.scheda.lista);
    return Boolean(lista?.candidati.length) && voce.scheda.preferenze.length < elezione().maxPreferenze;
  }

  /** Testo breve sullo stato della pubblicazione, per la barra in basso. */
  function testoStato() {
    const n = daPubblicare();
    const quante = n ? `${formato.conteggio(n, 'scheda', 'schede')} da pubblicare` : 'Tutto pubblicato';
    if (!puoPubblicare()) return `${quante} · non collegato a GitHub`;
    return `${quante} · ${stato.ogni ? `in automatico ogni ${stato.ogni}` : 'pubblicazione a mano'}`;
  }

  /** Spiegazione più lunga, sotto la scelta della pubblicazione automatica. */
  function spiegazioneAutomatica() {
    if (!puoPubblicare())
      return 'Questo dispositivo non è collegato a GitHub: le schede restano qui finché non lo colleghi.';
    if (!stato.ogni) return 'Le schede vanno online solo quando premi «Pubblica».';
    return `Ogni ${stato.ogni} schede contate (o dopo 2 minuti di pausa) i numeri vanno online da soli.`;
  }

  // ---------------------------------------------------------------- Azioni

  function tocca(azione, chiaveTasto) {
    // Doppio tocco involontario sullo stesso tasto: si conta una volta sola.
    const ora = Date.now();
    if (chiaveTasto === stato.ultimoTasto && ora - stato.ultimoTocco < DOPPIO_TOCCO_MS) return;
    stato.ultimoTasto = chiaveTasto;
    stato.ultimoTocco = ora;

    if (stato.inCorso) {
      if (azione.tipo === 'candidato') completaInCorso(azione, chiaveTasto);
      else errore('Prima completa la scheda in corso: tocca il secondo nome oppure «Solo 1 preferenza».');
      return;
    }
    if (stato.aggiungi && azione.tipo === 'candidato') {
      aggiungiPreferenza(azione, chiaveTasto);
      return;
    }
    stato.aggiungi = false;
    if (azione.tipo === 'bianca' || azione.tipo === 'nulla') {
      registra({ tipo: azione.tipo, lista: null, preferenze: [] }, chiaveTasto);
    } else if (azione.tipo === 'candidato' && aspettaSecondo(azione.lista)) {
      // Primo nome: la scheda resta aperta finché non arriva il secondo.
      stato.inCorso = { lista: azione.lista, preferenze: [azione.nome] };
      persisti();
      disegna();
      lampeggia(chiaveTasto);
      annuncia(`${azione.nome}: tocca il secondo nome oppure «Solo 1 preferenza».`);
    } else {
      // Una preferenza a un candidato vale anche come voto alla sua lista.
      registra({ tipo: 'lista', lista: azione.lista, preferenze: azione.nome ? [azione.nome] : [] }, chiaveTasto);
    }
  }

  /** Registra subito una scheda nuova. */
  function registra(scheda, chiaveTasto) {
    const e = elezione();
    const prima = dati(e.id);
    const numero = schedeContate(e, prima) + 1;
    salva(e.id, applicaScheda(e, prima, scheda, +1));
    stato.storico.push({ sezione: sezione.id, elezione: e.id, scheda, numero, ora: Date.now() });
    conferme(chiaveTasto, `Scheda ${numero}: ${descriviScheda(scheda)}.`);
  }

  /** Secondo nome sulla scheda in corso: se arriva al massimo di preferenze, la registra. */
  function completaInCorso(azione, chiaveTasto) {
    const { lista, preferenze } = stato.inCorso;
    if (azione.lista !== lista) {
      errore(`Il secondo nome deve essere della Lista ${lista}, come il primo. Per cambiare premi «Annulla».`);
      return;
    }
    if (preferenze.includes(azione.nome)) {
      errore(`${azione.nome} è già sulla scheda. Se ha un solo nome premi «Solo 1 preferenza».`);
      return;
    }
    stato.inCorso = { lista, preferenze: [...preferenze, azione.nome] };
    if (stato.inCorso.preferenze.length >= elezione().maxPreferenze) registraInCorso(chiaveTasto);
    else {
      persisti();
      disegna();
      lampeggia(chiaveTasto);
    }
  }

  /** Registra la scheda in corso con i nomi toccati finora («Solo 1 preferenza»). */
  function registraInCorso(chiaveTasto) {
    if (!stato.inCorso) return;
    const { lista, preferenze } = stato.inCorso;
    stato.inCorso = null;
    registra({ tipo: 'lista', lista, preferenze }, typeof chiaveTasto === 'string' ? chiaveTasto : null);
  }

  /** Aggiunge un'altra preferenza all'ultima scheda registrata. */
  function aggiungiPreferenza(azione, chiaveTasto) {
    const voce = stato.storico[ultimaDellElezione()];
    if (azione.lista !== voce.scheda.lista) {
      errore(`La preferenza deve essere per un candidato della Lista ${voce.scheda.lista}, come la scheda.`);
      return;
    }
    if (voce.scheda.preferenze.includes(azione.nome)) {
      errore(`${azione.nome} è già su questa scheda.`);
      return;
    }
    const e = elezione();
    const nuova = { ...voce.scheda, preferenze: [...voce.scheda.preferenze, azione.nome] };
    salva(e.id, applicaScheda(e, applicaScheda(e, dati(e.id), voce.scheda, -1), nuova, +1));
    voce.scheda = nuova;
    stato.aggiungi = false;
    conferme(chiaveTasto, `Scheda ${voce.numero ?? ''}: ${descriviScheda(nuova)}.`);
  }

  /** Dopo ogni scheda: salva, ridisegna, vibra e fa lampeggiare il tasto toccato. */
  function conferme(chiaveTasto, testo) {
    persisti();
    disegna();
    lampeggia(chiaveTasto, barra);
    annuncia(testo);
    controlla();
  }

  /** Vibra e fa lampeggiare il tasto toccato (e la barra, se indicata). */
  function lampeggia(chiaveTasto, ...altri) {
    navigator.vibrate?.(25);
    for (const elemento of [el.tasti.get(chiaveTasto)?.bottone, ...altri]) {
      if (!elemento) continue;
      elemento.classList.remove('lampeggia');
      void elemento.offsetWidth;
      elemento.classList.add('lampeggia');
    }
  }

  function errore(testo) {
    navigator.vibrate?.([40, 60, 40]);
    annuncia(testo);
    el.schedaCorrente.textContent = testo;
    el.schedaCorrente.classList.remove('lampeggia-errore');
    void el.schedaCorrente.offsetWidth;
    el.schedaCorrente.classList.add('lampeggia-errore');
  }

  function cambiaAggiungi() {
    stato.aggiungi = !stato.aggiungi;
    disegna();
  }

  function annullaUltima() {
    if (stato.inCorso) {
      // La scheda in corso non è ancora registrata: si toglie senza chiedere.
      stato.inCorso = null;
      persisti();
      disegna();
      annuncia('Scheda in corso annullata.');
      return;
    }
    const indice = ultimaDellElezione();
    if (indice < 0) return;
    const { scheda } = stato.storico[indice];
    if (!window.confirm(`Annullare l'ultima scheda registrata?\n\n${descriviScheda(scheda)}`)) return;
    stato.storico.splice(indice, 1);
    const e = elezione();
    salva(e.id, applicaScheda(e, dati(e.id), scheda, -1));
    persisti();
    disegna();
    annuncia(`Annullata: ${descriviScheda(scheda)}.`);
    controlla();
  }

  function cambiaVotanti() {
    const pulito = el.votanti.value.replace(/\D/g, '').slice(0, 5);
    if (pulito !== el.votanti.value) el.votanti.value = pulito;
    const e = elezione();
    salva(e.id, { ...elezioneCanonica(e, dati(e.id)), votanti: intero(pulito) });
    disegna();
    controlla();
  }

  function cambiaElezione(id) {
    if (stato.inCorso && id !== stato.elezione) {
      errore('Prima completa la scheda in corso: tocca il secondo nome oppure «Solo 1 preferenza».');
      return;
    }
    stato.elezione = id;
    stato.aggiungi = false;
    persisti();
    costruisciGriglia();
    disegna();
    controlla();
  }

  function cambiaAspetta() {
    stato.aspetta = el.aspetta.checked;
    if (!stato.aspetta) registraInCorso();
    persisti();
    disegna();
  }

  function cambiaAutomatica() {
    stato.ogni = Number(el.automatica.value);
    persisti();
    disegna();
    controlla();
  }

  // ------------------------------------------------- Pubblicazione automatica

  function controlla() {
    clearTimeout(stato.timer);
    if (!stato.ogni || stato.inVolo || !puoPubblicare()) return;
    const n = daPubblicare();
    if (n === 0) return;
    let attesa = n >= stato.ogni ? 0 : PAUSA_MS;
    if (Date.now() - stato.erroreAlle < RIPROVA_MS) attesa = RIPROVA_MS;
    else if (Date.now() - stato.occupatoAlle < OCCUPATO_MS) attesa = OCCUPATO_MS;
    stato.timer = setTimeout(pubblicaInAutomatico, attesa);
  }

  async function pubblicaInAutomatico() {
    if (stato.inVolo || daPubblicare() === 0) return;
    stato.inVolo = true;
    let esito = false;
    try {
      esito = await pubblica({ automatica: true });
    } catch {
      esito = false;
    }
    stato.inVolo = false;
    if (esito === false) stato.erroreAlle = Date.now();
    // null: c'era già un'altra pubblicazione in corso, si riprova tra poco
    if (esito === null) stato.occupatoAlle = Date.now();
    disegna();
    controlla();
  }

  return {
    elemento,
    barra,
    testoStato,
    /** Ridisegna dopo cambiamenti esterni (pubblicazione, dati ricaricati). */
    aggiorna() {
      disegna();
      controlla();
    },
    /** Da chiamare quando la vista viene chiusa. */
    chiudi() {
      clearTimeout(stato.timer);
    },
  };
}
