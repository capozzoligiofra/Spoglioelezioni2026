/**
 * Pagina pubblica dei risultati (index.html).
 * Carica la configurazione, poi rilegge data/risultati.json a intervalli
 * regolari e ridisegna la pagina solo quando i dati cambiano.
 */

import {
  ETICHETTE_STATO,
  STATI_SEZIONE,
  calcolaElezione,
  contaSezioni,
  normalizzaRisultati,
  preparaConfigurazione,
  risultatiVuoti,
} from './calcoli.js';
import { caricaJSON, modalitaDemo, percorsi, sorgenteDemo, sorgenteReale } from './dati.js';
import { annuncia, classeColore, h, icona, simboloLista } from './dom.js';
import * as formato from './formato.js';

const trova = (id) => document.getElementById(id);
const pagina = {
  scuola: trova('scuola'),
  titolo: trova('titolo'),
  data: trova('data-elezioni'),
  stato: trova('stato-spoglio'),
  aggiornamento: trova('aggiornamento'),
  avvisi: trova('avvisi'),
  schede: trova('schede'),
  pannelli: trova('pannelli'),
  annuncio: trova('annuncio'),
  piede: trova('piede-collegamenti'),
};

const app = {
  config: null,
  sorgente: null,
  risultati: null,
  firma: '',
  selezionata: null,
  timer: null,
  inCaricamento: false,
  erroreRete: null,
  // Elementi creati una volta sola (per non perdere il focus di chi li usa)
  testoAggiornamento: h('span'),
  bottoneAggiorna: null,
  avvisoCommissione: h('div', { class: 'avvisi-dinamici' }),
};

const ICONA_STATO = { 'da-scrutinare': 'cerchio', 'in-corso': 'orologio', scrutinata: 'spunta' };

avvia();

async function avvia() {
  const demo = modalitaDemo();
  const file = percorsi(demo);
  let grezza;
  try {
    grezza = await caricaJSON(file.config);
  } catch (errore) {
    erroreGrave('Non riesco a caricare la configurazione delle elezioni.', [errore.message]);
    return;
  }
  const { config, errori } = preparaConfigurazione(grezza);
  if (!config) {
    erroreGrave(`Il file ${file.config} contiene degli errori:`, errori);
    return;
  }
  app.config = config;

  try {
    app.sorgente = demo ? await sorgenteDemo(file.risultati, config) : sorgenteReale(file.risultati);
  } catch (errore) {
    erroreGrave('Non riesco a caricare i dati della demo.', [errore.message]);
    return;
  }

  intestazione();
  app.selezionata = elezioneDallIndirizzo() ?? config.elezioni[0].id;
  costruisciSchede();

  window.addEventListener('hashchange', () => {
    const id = elezioneDallIndirizzo();
    if (id) seleziona(id);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !app.sorgente.demo) aggiorna();
  });
  await aggiorna();
}

// ------------------------------------------------------------ Aggiornamento

async function aggiorna() {
  if (app.inCaricamento) return;
  clearTimeout(app.timer);
  app.inCaricamento = true;
  app.bottoneAggiorna.classList.add('gira');
  app.bottoneAggiorna.setAttribute('aria-disabled', 'true');
  try {
    const risultati = await app.sorgente.leggi();
    app.erroreRete = null;
    const firma = JSON.stringify(risultati);
    if (firma !== app.firma) {
      const primoCaricamento = app.risultati === null;
      app.firma = firma;
      app.risultati = risultati;
      disegna();
      if (!primoCaricamento) annunciaNovita();
    }
  } catch (errore) {
    app.erroreRete = errore.message;
    if (app.risultati === null) {
      app.risultati = risultatiVuoti();
      disegna();
    }
  } finally {
    app.inCaricamento = false;
    app.bottoneAggiorna.classList.remove('gira');
    app.bottoneAggiorna.removeAttribute('aria-disabled');
    disegnaStato();
    pianifica();
  }
}

function pianifica() {
  clearTimeout(app.timer);
  if (app.sorgente.demo) {
    if (!app.sorgente.finita) app.timer = setTimeout(aggiorna, app.sorgente.intervalloMs);
    return;
  }
  // Con la pagina nascosta non si scarica nulla: si riprende quando torna visibile.
  if (document.visibilityState === 'hidden') return;
  const secondi = normalizzaRisultati(app.risultati).definitivi ? 300 : app.config.aggiornamentoSecondi;
  app.timer = setTimeout(aggiorna, (app.erroreRete ? Math.min(secondi, 15) : secondi) * 1000);
}

function annunciaNovita() {
  const risultati = normalizzaRisultati(app.risultati);
  if (app.sorgente.demo && !risultati.definitivi) return;
  const c = contaSezioni(app.config, risultati);
  annuncia(
    pagina.annuncio,
    risultati.definitivi
      ? 'Sono stati pubblicati i risultati definitivi.'
      : `Risultati aggiornati: ${c.scrutinata} sezioni scrutinate su ${c.totale}.`,
  );
}

// ---------------------------------------------------------------- Testata

function intestazione() {
  const { config } = app;
  pagina.scuola.textContent = config.scuola ?? '';
  pagina.titolo.textContent = config.titolo ?? 'Spoglio delle elezioni';
  if (config.dataElezioni) {
    pagina.data.textContent = `Votazioni: ${formato.giorno(config.dataElezioni)}`;
    pagina.data.hidden = false;
  }

  app.bottoneAggiorna = h(
    'button',
    {
      type: 'button',
      class: 'bottone piccolo',
      onclick: () => aggiorna(),
    },
    icona('aggiorna'),
    'Aggiorna ora',
  );
  pagina.aggiornamento.replaceChildren(app.testoAggiornamento, app.bottoneAggiorna);

  const fissi = [];
  if (app.sorgente.demo) fissi.push(avvisoDemo());
  else if (config.esempio) {
    fissi.push(
      avviso(
        'attenzione',
        'avviso',
        h('strong', {}, 'Dati di esempio'),
        h(
          'p',
          {},
          'Scuola, liste e candidati sono inventati. Chi gestisce il sito deve inserire quelli veri nel file data/elezioni.json e togliere la riga "esempio": true.',
        ),
      ),
    );
  }
  pagina.avvisi.replaceChildren(...fissi, app.avvisoCommissione);

  if (!app.sorgente.demo && /^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) {
    pagina.piede.append(
      h(
        'a',
        { href: `https://github.com/${config.repository}/commits/HEAD/data/risultati.json` },
        'Storico di ogni modifica ai risultati',
      ),
    );
  }
}

function avvisoDemo() {
  return avviso(
    'attenzione',
    'info',
    h('strong', {}, 'Modalità dimostrativa'),
    h('p', {}, 'Liste, candidati e voti sono inventati: lo spoglio è simulato per mostrare come apparirà il sito.'),
    h(
      'div',
      { class: 'avviso-azioni' },
      h(
        'button',
        {
          type: 'button',
          class: 'bottone piccolo',
          onclick: () => {
            app.sorgente.saltaAllaFine();
            aggiorna();
          },
        },
        'Vai ai risultati finali',
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'bottone piccolo',
          onclick: () => {
            app.sorgente.ricomincia();
            aggiorna();
          },
        },
        'Ricomincia',
      ),
      h('a', { class: 'bottone piccolo', href: './' }, 'Esci dalla demo'),
    ),
  );
}

function disegnaStato() {
  if (!app.config) return;
  const risultati = normalizzaRisultati(app.risultati);
  const c = contaSezioni(app.config, risultati);
  let stato;
  let simbolo;
  let testo;
  if (risultati.definitivi) {
    [stato, simbolo, testo] = ['definitivi', icona('lucchetto'), 'Risultati definitivi'];
  } else if (c.scrutinata === c.totale) {
    [stato, simbolo, testo] = ['concluso', icona('spunta'), 'Spoglio concluso · risultati provvisori'];
  } else if (c.scrutinata + c['in-corso'] > 0) {
    [stato, simbolo, testo] = [
      'in-corso',
      h('span', { class: 'punto-live', 'aria-hidden': 'true' }),
      'In diretta · spoglio in corso',
    ];
  } else {
    [stato, simbolo, testo] = ['attesa', icona('orologio'), 'Spoglio non ancora iniziato'];
  }
  pagina.stato.dataset.stato = stato;
  pagina.stato.replaceChildren(simbolo, testo);

  const parti = [];
  if (risultati.aggiornato) parti.push(`Dati aggiornati ${formato.quando(risultati.aggiornato)}`);
  if (!risultati.definitivi && !app.sorgente.demo) {
    parti.push(`la pagina si aggiorna da sola ogni ${app.config.aggiornamentoSecondi} secondi`);
  }
  const frase = parti.join(' · ');
  app.testoAggiornamento.replaceChildren(frase ? `${frase[0].toUpperCase()}${frase.slice(1)}.` : '');
  if (app.erroreRete) {
    app.testoAggiornamento.append(h('span', { class: 'errore-rete' }, ` ${app.erroreRete} Riprovo tra poco.`));
  }
}

// ----------------------------------------------------------------- Schede

function costruisciSchede() {
  const { elezioni } = app.config;
  if (elezioni.length < 2) return;
  const lista = h(
    'div',
    { class: 'schede-lista', role: 'tablist', 'aria-label': 'Elezioni' },
    elezioni.map((elezione) =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          class: 'scheda-tab',
          id: `tab-${elezione.id}`,
          'aria-controls': `pannello-${elezione.id}`,
          onclick: () => seleziona(elezione.id),
          onkeydown: (evento) => tastiSchede(evento, elezione.id),
        },
        elezione.nome,
      ),
    ),
  );
  pagina.schede.firstElementChild.replaceChildren(lista);
  pagina.schede.hidden = false;
  aggiornaSchede();
}

function aggiornaSchede() {
  for (const elezione of app.config.elezioni) {
    const attiva = elezione.id === app.selezionata;
    const tab = trova(`tab-${elezione.id}`);
    if (tab) {
      tab.setAttribute('aria-selected', String(attiva));
      tab.tabIndex = attiva ? 0 : -1;
    }
    const pannello = trova(`pannello-${elezione.id}`);
    if (pannello) pannello.hidden = !attiva;
  }
}

function seleziona(id, { focus = false } = {}) {
  app.selezionata = id;
  aggiornaSchede();
  if (decodeURIComponent(window.location.hash.slice(1)) !== id) {
    window.history.replaceState(null, '', `#${id}`);
  }
  if (focus) trova(`tab-${id}`)?.focus();
}

function tastiSchede(evento, id) {
  const ids = app.config.elezioni.map((e) => e.id);
  const i = ids.indexOf(id);
  const destinazione = {
    ArrowRight: ids[(i + 1) % ids.length],
    ArrowLeft: ids[(i - 1 + ids.length) % ids.length],
    Home: ids[0],
    End: ids.at(-1),
  }[evento.key];
  if (!destinazione) return;
  evento.preventDefault();
  seleziona(destinazione, { focus: true });
}

function elezioneDallIndirizzo() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return app.config.elezioni.some((e) => e.id === id) ? id : null;
}

// ------------------------------------------------------------------ Pagina

function disegna() {
  const risultati = normalizzaRisultati(app.risultati);
  disegnaStato();

  app.avvisoCommissione.replaceChildren(
    risultati.avviso
      ? avviso(
          'info',
          'megafono',
          h('strong', {}, 'Comunicazione della Commissione elettorale'),
          h('p', {}, risultati.avviso),
        )
      : '',
  );

  // Ridisegna i pannelli mantenendo aperti i riquadri già aperti, il focus
  // e lo scorrimento orizzontale delle tabelle.
  const aperti = new Set([...pagina.pannelli.querySelectorAll('details[open]')].map((d) => d.dataset.chiave));
  const idFocus = pagina.pannelli.contains(document.activeElement) ? document.activeElement.id : '';
  const scorrimenti = [...pagina.pannelli.querySelectorAll('.scorri[id]')].map((el) => [el.id, el.scrollLeft]);

  pagina.pannelli.replaceChildren(
    ...app.config.elezioni.map((elezione) => pannello(calcolaElezione(app.config, elezione, risultati))),
  );

  for (const dettagli of pagina.pannelli.querySelectorAll('details[data-chiave]')) {
    dettagli.open = aperti.has(dettagli.dataset.chiave);
  }
  for (const [id, sinistra] of scorrimenti) {
    const el = trova(id);
    if (el) el.scrollLeft = sinistra;
  }
  if (idFocus) trova(idFocus)?.focus({ preventScroll: true });

  const c = contaSezioni(app.config, risultati);
  const base = `Spoglio – ${app.config.titolo ?? 'Elezioni'}`;
  document.title =
    !risultati.definitivi && c.scrutinata > 0 && c.scrutinata < c.totale
      ? `(${c.scrutinata}/${c.totale}) ${base}`
      : base;
}

function pannello(r) {
  const { elezione } = r;
  const piuElezioni = app.config.elezioni.length > 1;
  return h(
    'section',
    {
      class: 'pannello',
      id: `pannello-${elezione.id}`,
      role: piuElezioni ? 'tabpanel' : null,
      'aria-labelledby': `titolo-${elezione.id}`,
      hidden: piuElezioni && elezione.id !== app.selezionata,
    },
    h(
      'div',
      { class: 'pannello-testa' },
      h('h2', { id: `titolo-${elezione.id}` }, elezione.nome),
      h('p', { class: 'meta' }, descrizioneElezione(elezione)),
    ),
    numeriPrincipali(r),
    statoSezioni(r),
    r.iniziato
      ? [votiDiLista(r), seggi(r), preferenze(r), spiegazioneSeggi(r), risultatiPerSezione(r)]
      : [attesa(), listeECandidati(elezione)],
  );
}

function descrizioneElezione(elezione) {
  return [
    elezione.descrizione,
    `${formato.conteggio(elezione.seggi, 'seggio', 'seggi')} da assegnare`,
    elezione.maxPreferenze === 0
      ? 'senza preferenze'
      : `fino a ${formato.conteggio(elezione.maxPreferenze, 'preferenza', 'preferenze')} per scheda`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function numeriPrincipali(r) {
  const { totale, scrutinata } = r.sezioni;
  const inCorso = r.sezioni['in-corso'];
  const tutte = scrutinata === totale;
  let dettaglioSezioni = `${formato.numero(totale - scrutinata)} ancora da completare`;
  if (tutte) dettaglioSezioni = 'Tutte le sezioni sono state scrutinate';
  else if (inCorso > 0) dettaglioSezioni = `${formato.conteggio(inCorso, 'sezione', 'sezioni')} in corso di scrutinio`;

  return h(
    'div',
    { class: 'kpi' },
    tessera(
      'Sezioni scrutinate',
      [formato.numero(scrutinata), h('small', {}, ` su ${formato.numero(totale)}`)],
      h(
        'div',
        { class: `misuratore${tutte ? ' completo' : ''}`, 'aria-hidden': 'true' },
        h('span', { style: { '--w': `${totale ? (scrutinata / totale) * 100 : 0}%` } }),
      ),
      dettaglioSezioni,
    ),
    tessera(
      'Affluenza',
      formato.percentuale(r.affluenza),
      null,
      r.affluenza === null
        ? 'Disponibile dopo le prime sezioni'
        : `${formato.numero(r.votanti)} votanti su ${formato.numero(r.aventiDirittoConDati)} aventi diritto${tutte ? '' : ' nelle sezioni contate'}`,
    ),
    tessera(
      'Voti validi',
      formato.numero(r.validi),
      null,
      `su ${formato.conteggio(r.schede, 'scheda scrutinata', 'schede scrutinate')}`,
    ),
    tessera(
      'Schede bianche e nulle',
      formato.numero(r.bianche + r.nulle),
      null,
      `${formato.conteggio(r.bianche, 'bianca', 'bianche')} · ${formato.conteggio(r.nulle, 'nulla', 'nulle')}`,
    ),
  );
}

function tessera(etichetta, valore, extra, dettaglio) {
  return h(
    'div',
    { class: 'tessera' },
    h('span', { class: 'tessera-etichetta' }, etichetta),
    h('span', { class: 'tessera-valore' }, valore),
    extra,
    dettaglio ? h('span', { class: 'tessera-dettaglio' }, dettaglio) : null,
  );
}

function statoSezioni(r) {
  const id = `sezioni-${r.elezione.id}`;
  return h(
    'section',
    { class: 'blocco', 'aria-labelledby': id },
    h('h3', { id }, 'Stato delle sezioni'),
    h(
      'ul',
      { class: 'legenda' },
      [...STATI_SEZIONE]
        .reverse()
        .map((stato) =>
          h(
            'li',
            { class: `stato-${stato}` },
            icona(ICONA_STATO[stato]),
            `${ETICHETTE_STATO[stato]}: ${r.sezioni[stato]}`,
          ),
        ),
    ),
    h(
      'ul',
      { class: 'chips', 'aria-label': 'Elenco delle sezioni' },
      r.perSezione.map((sezione) =>
        h(
          'li',
          { class: `chip stato-${sezione.stato}` },
          icona(ICONA_STATO[sezione.stato]),
          sezione.nome,
          h('span', { class: 'sr-only' }, `: ${ETICHETTE_STATO[sezione.stato].toLowerCase()}`),
        ),
      ),
    ),
  );
}

function barra(quota, classe = '') {
  const larghezza = Math.max(0, Math.min(1, quota)) * 100;
  return h(
    'div',
    { class: `barra ${classe} ${quota > 0 ? 'ha-valore' : ''}`, 'aria-hidden': 'true' },
    h('span', { style: { '--w': `${larghezza}%` } }),
  );
}

function descrizioneAvanzamento(r) {
  const { totale, scrutinata } = r.sezioni;
  const inCorso = r.sezioni['in-corso'];
  if (scrutinata === totale) return `Risultati di tutte le ${formato.numero(totale)} sezioni.`;
  return `Dati di ${formato.numero(scrutinata)} sezioni scrutinate su ${formato.numero(totale)}${
    inCorso ? ` e di ${formato.conteggio(inCorso, 'sezione', 'sezioni')} in corso` : ''
  }.`;
}

function votiDiLista(r) {
  const id = `voti-${r.elezione.id}`;
  const massimo = Math.max(1, ...r.liste.map((l) => l.voti));
  return h(
    'section',
    { class: 'blocco', 'aria-labelledby': id },
    h('h3', { id }, 'Voti di lista'),
    h('p', { class: 'sottotitolo' }, descrizioneAvanzamento(r)),
    h(
      'ol',
      { class: 'risultati-liste' },
      r.liste.map((lista) =>
        h(
          'li',
          { class: `riga-lista ${classeColore(lista.colore)}` },
          simboloLista(lista),
          h(
            'div',
            { class: 'rl-nome' },
            h('span', { class: 'rl-titolo' }, lista.nome),
            h(
              'span',
              { class: 'rl-sotto' },
              `Lista ${lista.numero} · ${lista.seggi ? formato.conteggio(lista.seggi, 'seggio', 'seggi') : 'nessun seggio'}`,
            ),
          ),
          h(
            'div',
            { class: 'rl-valori' },
            h('span', { class: 'rl-percentuale' }, formato.percentuale(lista.percentuale)),
            h('span', { class: 'rl-voti' }, formato.conteggio(lista.voti, 'voto', 'voti')),
          ),
          barra(lista.voti / massimo),
        ),
      ),
    ),
  );
}

function elencoListe(liste) {
  const nomi = liste.map((l) => `lista ${l.numero}`);
  return nomi.length > 1 ? `${nomi.slice(0, -1).join(', ')} e ${nomi.at(-1)}` : nomi[0];
}

function seggi(r) {
  const id = `seggi-${r.elezione.id}`;
  const { assegnati, nonAssegnati, sorteggio } = r.seggi;
  let titolo = 'Seggi: proiezione';
  let nota = 'Come verrebbero assegnati i seggi con i voti contati finora: può cambiare fino alla fine dello spoglio.';
  if (r.definitivi) {
    titolo = 'Eletti';
    nota = 'Risultato proclamato dalla Commissione elettorale.';
  } else if (r.completo) {
    titolo = 'Eletti (risultato provvisorio)';
    nota = 'Lo spoglio è concluso: il risultato diventa ufficiale con la proclamazione della Commissione elettorale.';
  }
  return h(
    'section',
    { class: 'blocco', 'aria-labelledby': id },
    h('h3', { id }, titolo),
    h('p', { class: 'sottotitolo' }, nota),
    h(
      'ol',
      { class: 'seggi' },
      assegnati.map((seggio) =>
        h(
          'li',
          { class: `seggio ${classeColore(seggio.lista.colore)}` },
          simboloLista(seggio.lista),
          h(
            'div',
            { class: 'seggio-testo' },
            h('span', { class: 'seggio-numero' }, `${seggio.numero}° seggio`),
            h('span', { class: 'seggio-nome' }, seggio.candidato.nome),
            h(
              'span',
              { class: 'seggio-dettagli' },
              [
                `Lista ${seggio.lista.numero} – ${seggio.lista.nome}`,
                seggio.candidato.classe && `classe ${seggio.candidato.classe}`,
              ]
                .filter(Boolean)
                .join(' · '),
            ),
            r.elezione.maxPreferenze > 0
              ? h(
                  'span',
                  { class: 'seggio-dettagli' },
                  formato.conteggio(seggio.candidato.preferenze, 'preferenza', 'preferenze'),
                )
              : null,
          ),
        ),
      ),
    ),
    nonAssegnati > 0
      ? avviso(
          'attenzione',
          'avviso',
          h(
            'p',
            {},
            `${formato.conteggio(nonAssegnati, 'seggio resta', 'seggi restano')} senza assegnazione: le liste non hanno abbastanza candidati.`,
          ),
        )
      : null,
    sorteggio
      ? avviso(
          'attenzione',
          'avviso',
          h('strong', {}, 'Parità perfetta'),
          h(
            'p',
            {},
            `${elencoListe(sorteggio.liste)} hanno lo stesso quoziente e gli stessi voti: ${
              sorteggio.seggi === 1 ? "l'ultimo seggio si assegna" : `gli ultimi ${sorteggio.seggi} seggi si assegnano`
            } per sorteggio. Per ora ${sorteggio.seggi === 1 ? 'è mostrato' : 'sono mostrati'} alla lista che viene prima sulla scheda.`,
          ),
        )
      : null,
  );
}

function preferenze(r) {
  const { maxPreferenze } = r.elezione;
  if (maxPreferenze === 0) return null;
  const id = `preferenze-${r.elezione.id}`;
  return h(
    'section',
    { class: 'blocco', 'aria-labelledby': id },
    h('h3', { id }, 'Preferenze'),
    h(
      'p',
      { class: 'sottotitolo' },
      `Ogni scheda può dare fino a ${formato.conteggio(maxPreferenze, 'preferenza', 'preferenze')} a candidati della lista votata. In ogni lista sono eletti i candidati con più preferenze; a parità, chi viene prima nell'ordine di lista.`,
    ),
    h(
      'div',
      { class: 'griglia-preferenze' },
      r.liste.map((lista) => tabellaPreferenze(r, lista)),
    ),
  );
}

function tabellaPreferenze(r, lista) {
  const id = `pref-${r.elezione.id}-${lista.colore ?? lista.numero}`;
  const massimo = Math.max(1, ...lista.candidati.map((c) => c.preferenze));
  const esito = r.completo
    ? () => h('span', { class: 'etichetta-esito' }, icona('spunta'), 'Eletto/a')
    : () => h('span', { class: 'etichetta-esito vantaggio' }, icona('destra'), 'In vantaggio');
  return h(
    'div',
    { class: `scheda-lista ${classeColore(lista.colore)}` },
    h('h4', { id }, simboloLista(lista, 'piccolo'), `Lista ${lista.numero} – ${lista.nome}`),
    lista.candidati.length === 0
      ? h('p', { class: 'nota' }, 'Nessun candidato.')
      : h(
          'table',
          { class: 'tabella tabella-preferenze', 'aria-labelledby': id },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Candidato/a'),
              h('th', { scope: 'col', class: 'num' }, 'Preferenze'),
            ),
          ),
          h(
            'tbody',
            {},
            lista.candidati.map((candidato) =>
              h(
                'tr',
                { class: candidato.eletto ? 'eletto' : null },
                h(
                  'th',
                  { scope: 'row' },
                  h(
                    'span',
                    { class: 'riga-candidato' },
                    h('span', { class: 'nome-candidato' }, candidato.nome),
                    candidato.eletto ? esito() : null,
                  ),
                  h(
                    'span',
                    { class: 'dettaglio-candidato' },
                    [`n. ${candidato.posizione} in lista`, candidato.classe && `classe ${candidato.classe}`]
                      .filter(Boolean)
                      .join(' · '),
                  ),
                  barra(candidato.preferenze / massimo, 'sottile'),
                ),
                h('td', { class: 'num valore-preferenze' }, formato.numero(candidato.preferenze)),
              ),
            ),
          ),
        ),
    lista.paritaDecisaDallOrdine
      ? h(
          'p',
          { class: 'nota' },
          "Parità di preferenze per l'ultimo seggio della lista: prevale chi viene prima nell'ordine di lista.",
        )
      : null,
  );
}

function spiegazioneSeggi(r) {
  const { elezione } = r;
  const didascalia = `didascalia-quozienti-${elezione.id}`;
  const divisori = Array.from({ length: elezione.seggi }, (_, i) => i + 1);
  return h(
    'details',
    { class: 'dettagli', dataset: { chiave: `quozienti-${elezione.id}` } },
    h('summary', { id: `apri-quozienti-${elezione.id}` }, 'Come vengono assegnati i seggi'),
    h(
      'div',
      { class: 'dettagli-corpo' },
      h(
        'p',
        {},
        `I seggi si assegnano con il metodo D'Hondt: i voti di ogni lista si dividono per 1, 2, 3 e così via, e i ${formato.numero(
          elezione.seggi,
        )} seggi vanno ai quozienti più alti. Nella tabella il riquadro scuro indica l'ordine in cui è stato assegnato ogni seggio.`,
      ),
      h(
        'p',
        {},
        'A parità di quoziente il seggio va alla lista con più voti; se anche i voti sono uguali si procede per sorteggio. Una lista non può avere più seggi dei suoi candidati: in quel caso il seggio passa al quoziente successivo.',
      ),
      h(
        'div',
        {
          class: 'scorri',
          id: `scorri-quozienti-${elezione.id}`,
          tabindex: '0',
          role: 'region',
          'aria-labelledby': didascalia,
        },
        h(
          'table',
          { class: 'tabella tabella-quozienti' },
          h('caption', { id: didascalia }, 'Quozienti di ogni lista'),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Lista'),
              divisori.map((d) => h('th', { scope: 'col', class: 'num' }, `voti ÷ ${d}`)),
            ),
          ),
          h(
            'tbody',
            {},
            r.seggi.tabellaQuozienti.map(({ lista, quozienti }) =>
              h(
                'tr',
                {},
                h(
                  'th',
                  { scope: 'row' },
                  h(
                    'span',
                    { class: `intestazione-lista ${classeColore(lista.colore)}` },
                    h('span', { class: 'pallino', 'aria-hidden': 'true' }),
                    `Lista ${lista.numero}`,
                  ),
                ),
                divisori.map((divisore) => cellaQuoziente(quozienti.find((q) => q.divisore === divisore))),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function cellaQuoziente(q) {
  if (!q) return h('td', { class: 'num' }, '0');
  const valore = formato.decimale(q.valore);
  if (q.seggio) {
    return h(
      'td',
      { class: 'num vincente' },
      h('span', { class: 'numero-seggio' }, `${q.seggio}°`),
      h('span', { class: 'sr-only' }, ' seggio: '),
      valore,
    );
  }
  if (q.esaurita) {
    return h(
      'td',
      { class: 'num escluso', title: 'La lista non ha altri candidati' },
      valore,
      h('span', { class: 'sr-only' }, ' (lista senza altri candidati)'),
    );
  }
  return h('td', { class: 'num' }, valore);
}

function risultatiPerSezione(r) {
  const { elezione } = r;
  const didascalia = `didascalia-sezioni-${elezione.id}`;
  const numero = (valore) =>
    h('td', { class: 'num' }, valore === null || valore === undefined ? '—' : formato.numero(valore));
  const affluenza = (votanti, aventi) =>
    h('td', { class: 'num' }, votanti !== null && aventi ? formato.percentuale(votanti / aventi) : '—');
  const intestazioneLista = (lista) =>
    h(
      'th',
      { scope: 'col', class: 'num' },
      h(
        'span',
        { class: `intestazione-lista ${classeColore(lista.colore)}` },
        h('span', { class: 'pallino', 'aria-hidden': 'true' }),
        `Lista ${lista.numero}`,
      ),
    );

  return h(
    'details',
    { class: 'dettagli', dataset: { chiave: `sezioni-${elezione.id}` } },
    h('summary', { id: `apri-sezioni-${elezione.id}` }, 'Risultati sezione per sezione'),
    h(
      'div',
      { class: 'dettagli-corpo' },
      h(
        'div',
        {
          class: 'scorri',
          id: `scorri-sezioni-${elezione.id}`,
          tabindex: '0',
          role: 'region',
          'aria-labelledby': didascalia,
        },
        h(
          'table',
          { class: 'tabella tabella-sezioni' },
          h('caption', { id: didascalia }, `${elezione.nome}: voti in ogni sezione`),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, 'Sezione'),
              h('th', { scope: 'col' }, 'Stato'),
              h('th', { scope: 'col', class: 'num' }, 'Aventi diritto'),
              h('th', { scope: 'col', class: 'num' }, 'Votanti'),
              h('th', { scope: 'col', class: 'num' }, 'Affluenza'),
              r.liste.map(intestazioneLista),
              h('th', { scope: 'col', class: 'num' }, 'Bianche'),
              h('th', { scope: 'col', class: 'num' }, 'Nulle'),
            ),
          ),
          h(
            'tbody',
            {},
            r.perSezione.map((sezione) => {
              const conDati = sezione.votanti !== null;
              return h(
                'tr',
                {},
                h('th', { scope: 'row' }, sezione.nome),
                h(
                  'td',
                  {},
                  h(
                    'span',
                    { class: `stato-cella stato-${sezione.stato}` },
                    icona(ICONA_STATO[sezione.stato]),
                    ETICHETTE_STATO[sezione.stato],
                  ),
                ),
                numero(sezione.aventiDiritto),
                numero(conDati ? sezione.votanti : null),
                affluenza(conDati ? sezione.votanti : null, sezione.aventiDiritto),
                r.liste.map((lista) => numero(conDati ? sezione.voti[lista.numero] : null)),
                numero(conDati ? sezione.bianche : null),
                numero(conDati ? sezione.nulle : null),
              );
            }),
          ),
          h(
            'tfoot',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, 'Totale'),
              h('td', {}, `${r.sezioni.scrutinata} su ${r.sezioni.totale} scrutinate`),
              numero(r.aventiDiritto),
              numero(r.votanti),
              h('td', { class: 'num' }, formato.percentuale(r.affluenza)),
              r.liste.map((lista) => numero(lista.voti)),
              numero(r.bianche),
              numero(r.nulle),
            ),
          ),
        ),
      ),
    ),
  );
}

function attesa() {
  return h(
    'div',
    { class: 'blocco' },
    h(
      'div',
      { class: 'vuoto' },
      icona('urna'),
      h('strong', {}, 'Lo spoglio non è ancora iniziato'),
      h(
        'p',
        {},
        'I risultati compariranno qui sezione per sezione, appena gli scrutatori li pubblicano. Non serve ricaricare: la pagina si aggiorna da sola.',
      ),
    ),
  );
}

function listeECandidati(elezione) {
  const id = `candidati-${elezione.id}`;
  return h(
    'section',
    { class: 'blocco', 'aria-labelledby': id },
    h('h3', { id }, 'Liste e candidati'),
    h(
      'ul',
      { class: 'elenco-liste' },
      elezione.liste.map((lista) =>
        h(
          'li',
          { class: classeColore(lista.colore) },
          h(
            'span',
            { class: 'intestazione-lista' },
            simboloLista(lista, 'piccolo'),
            h('strong', {}, `Lista ${lista.numero} – ${lista.nome}`),
          ),
          lista.candidati.length
            ? h(
                'ol',
                {},
                lista.candidati.map((candidato) =>
                  h('li', {}, h('span', {}, candidato.nome), candidato.classe ? ` · ${candidato.classe}` : ''),
                ),
              )
            : h('p', { class: 'nota' }, 'Nessun candidato.'),
        ),
      ),
    ),
  );
}

// ----------------------------------------------------------------- Aiuti

function avviso(tipo, nomeIcona, ...contenuto) {
  return h('div', { class: `avviso ${tipo}` }, icona(nomeIcona), h('div', { class: 'avviso-testo' }, ...contenuto));
}

function erroreGrave(titolo, dettagli) {
  pagina.stato.dataset.stato = 'errore';
  pagina.stato.replaceChildren(icona('errore'), 'Impossibile mostrare i risultati');
  pagina.pannelli.replaceChildren(
    h(
      'div',
      { class: 'avviso critico errore-grave', role: 'alert' },
      icona('errore'),
      h(
        'div',
        { class: 'avviso-testo' },
        h('strong', {}, titolo),
        dettagli.length
          ? h(
              'ul',
              {},
              dettagli.map((d) => h('li', {}, d)),
            )
          : null,
        h('p', {}, 'Se gestisci il sito, correggi il problema e ricarica la pagina.'),
      ),
    ),
  );
}
