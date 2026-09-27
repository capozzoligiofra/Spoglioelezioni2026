/**
 * Area scrutatori (admin.html): inserimento dei risultati sezione per
 * sezione e pubblicazione su GitHub.
 *
 * I numeri inseriti restano come "bozza" in questo browser (non si perdono
 * ricaricando la pagina) finché non si preme «Pubblica»: solo allora vengono
 * scritti in data/risultati.json nel repository, con un commit, e il sito
 * pubblico li mostra dopo circa un minuto.
 */

import {
  ETICHETTE_STATO,
  STATI_SEZIONE,
  applicaBozze,
  contaSezioni,
  controllaSezione,
  intero,
  normalizzaRisultati,
  preparaConfigurazione,
  risultatiVuoti,
  sezioneCanonica,
  statoSezione,
} from './calcoli.js';
import { caricaJSON, modalitaDemo, percorsi } from './dati.js';
import { annuncia, classeColore, h, icona, riempi, simboloLista } from './dom.js';
import * as formato from './formato.js';
import { ErroreGitHub, RepositoryGitHub } from './github.js';
import { formattaJSON } from './json.js';

const PERCORSO_RISULTATI = 'data/risultati.json';
const CHIAVE_IMPOSTAZIONI = 'spoglio:impostazioni';
const ICONA_STATO = { 'da-scrutinare': 'cerchio', 'in-corso': 'orologio', scrutinata: 'spunta' };
const STATO_BREVE = { 'da-scrutinare': 'da scrutinare', 'in-corso': 'in corso', scrutinata: 'scrutinata' };

const trova = (id) => document.getElementById(id);
const pagina = {
  scuola: trova('scuola'),
  avvisi: trova('avvisi'),
  area: trova('area'),
  azioni: trova('azioni'),
  annuncio: trova('annuncio'),
};

// localStorage può non essere disponibile (navigazione privata, blocchi): si prosegue senza.
const memoria = {
  leggi(chiave, predefinito) {
    try {
      const testo = window.localStorage.getItem(chiave);
      return testo ? JSON.parse(testo) : predefinito;
    } catch {
      return predefinito;
    }
  },
  scrivi(chiave, valore) {
    try {
      window.localStorage.setItem(chiave, JSON.stringify(valore));
    } catch {
      // niente memoria locale: le bozze durano finché la pagina resta aperta
    }
  },
};

const app = {
  demo: modalitaDemo(),
  config: null,
  pubblicati: risultatiVuoti(),
  fonte: '',
  bozze: { sezioni: {} },
  selezionata: null,
  impostazioni: { repository: '', branch: '', token: '' },
  repo: null,
  utente: null,
  erroreConnessione: null,
  occupato: false,
  el: {},
};

const chiaveBozze = () => (app.demo ? 'spoglio:bozze-demo' : 'spoglio:bozze');
const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sezioneDaId = (id) => app.config.sezioni.find((s) => s.id === id);
const datiSezione = (id) => app.bozze.sezioni[id] ?? app.pubblicati.sezioni[id];

avvia();

async function avvia() {
  const file = percorsi(app.demo);
  let grezza;
  try {
    grezza = await caricaJSON(file.config);
  } catch (errore) {
    erroreGrave('Non riesco a caricare la configurazione delle elezioni.', [errore.message]);
    return;
  }
  const { config, errori, avvisi } = preparaConfigurazione(grezza);
  if (!config) {
    erroreGrave(`Il file ${file.config} contiene degli errori:`, errori);
    return;
  }
  app.config = config;
  pagina.scuola.textContent = [config.scuola, config.titolo].filter(Boolean).join(' · ');
  if (app.demo) trova('collegamento-sito').href = 'index.html?demo';

  const salvate = memoria.leggi(CHIAVE_IMPOSTAZIONI, {});
  app.impostazioni = {
    repository: salvate.repository || repositoryPredefinito(config),
    branch: salvate.branch || '',
    token: salvate.token || '',
  };
  app.bozze = caricaBozze();

  mostraAvvisiConfigurazione(config, avvisi);
  costruisciPagina();

  if (!app.demo && app.impostazioni.token) await collega();
  else await caricaPubblicati();
  disegnaTutto();

  const daIndirizzo = decodeURIComponent(window.location.hash.replace(/^#sezione-/, ''));
  if (sezioneDaId(daIndirizzo)) apriSezione(daIndirizzo, { focus: false });
}

/** Sul sito GitHub Pages (utente.github.io/repository) il repository si ricava dall'indirizzo. */
function repositoryPredefinito(config) {
  if (/^[\w.-]+\/[\w.-]+$/.test(config.repository ?? '')) return config.repository;
  const utente = window.location.hostname.match(/^([\w-]+)\.github\.io$/)?.[1];
  const nome = window.location.pathname.split('/').filter(Boolean)[0];
  return utente && nome && !nome.endsWith('.html') ? `${utente}/${nome}` : '';
}

function mostraAvvisiConfigurazione(config, avvisi) {
  const elenco = [];
  if (config.esempio && !app.demo) {
    elenco.push(
      avviso(
        'attenzione',
        'avviso',
        h('strong', {}, 'Configurazione di esempio'),
        h(
          'p',
          {},
          'Prima delle elezioni inserisci sezioni, liste e candidati veri nel file data/elezioni.json e togli la riga "esempio": true.',
        ),
      ),
    );
  }
  if (avvisi.length) {
    elenco.push(
      avviso(
        'attenzione',
        'avviso',
        h('strong', {}, 'Da controllare in data/elezioni.json'),
        h(
          'ul',
          {},
          avvisi.map((a) => h('li', {}, a)),
        ),
      ),
    );
  }
  pagina.avvisi.replaceChildren(...elenco);
}

// ------------------------------------------------------------- Dati e bozze

function caricaBozze() {
  const salvate = memoria.leggi(chiaveBozze(), null);
  return {
    sezioni: salvate?.sezioni && typeof salvate.sezioni === 'object' ? salvate.sezioni : {},
    definitivi: typeof salvate?.definitivi === 'boolean' ? salvate.definitivi : undefined,
    avviso: typeof salvate?.avviso === 'string' ? salvate.avviso : undefined,
  };
}

function salvaBozze() {
  memoria.scrivi(chiaveBozze(), app.bozze);
}

/** Toglie le bozze uguali a quanto già pubblicato (o di sezioni che non esistono più). */
function pulisciBozze() {
  for (const [id, dati] of Object.entries(app.bozze.sezioni)) {
    const pubblicata = sezioneCanonica(app.config, app.pubblicati.sezioni[id]);
    if (!sezioneDaId(id) || uguali(sezioneCanonica(app.config, dati), pubblicata)) delete app.bozze.sezioni[id];
  }
  if (app.bozze.definitivi === app.pubblicati.definitivi) app.bozze.definitivi = undefined;
  if (app.bozze.avviso === app.pubblicati.avviso) app.bozze.avviso = undefined;
  salvaBozze();
}

const numeroModifiche = () =>
  Object.keys(app.bozze.sezioni).length + (app.bozze.definitivi !== undefined) + (app.bozze.avviso !== undefined);

/** Risultati come appariranno dopo la pubblicazione delle bozze. */
const conBozze = () => applicaBozze(app.config, app.pubblicati, app.bozze, new Date().toISOString());

async function caricaPubblicati() {
  const adesso = formato.ora(new Date().toISOString());
  try {
    if (app.demo) {
      app.fonte = 'Modalità dimostrativa: niente viene pubblicato davvero.';
    } else if (app.repo) {
      const { testo } = await app.repo.leggi();
      app.pubblicati = normalizzaRisultati(testo ? JSON.parse(testo) : null);
      app.fonte = `Risultati pubblicati letti da GitHub alle ${adesso}.`;
    } else {
      app.pubblicati = normalizzaRisultati(await caricaJSON(percorsi(false).risultati, { fresco: true }));
      app.fonte = `Risultati pubblicati letti dal sito alle ${adesso} (potrebbero mancare le modifiche dell'ultimo minuto).`;
    }
  } catch (errore) {
    app.fonte = `Non riesco a leggere i risultati pubblicati: ${errore.message}`;
  }
  pulisciBozze();
}

// --------------------------------------------------------------- GitHub

async function collega() {
  const { repository, branch, token } = app.impostazioni;
  const [proprietario, nome] = repository.split('/');
  const repo = new RepositoryGitHub({ proprietario, nome, branch, percorso: PERCORSO_RISULTATI, token });
  try {
    const { utente, puoiScrivere } = await repo.verifica();
    app.repo = repo;
    app.utente = utente;
    app.erroreConnessione =
      puoiScrivere === false ? 'Il tuo account GitHub non ha il permesso di scrivere in questo repository.' : null;
    memoria.scrivi(CHIAVE_IMPOSTAZIONI, app.impostazioni);
  } catch (errore) {
    app.repo = null;
    app.erroreConnessione = errore.message;
  }
  await caricaPubblicati();
}

async function inviaConnessione(evento) {
  evento.preventDefault();
  const campi = new FormData(evento.target);
  app.impostazioni = {
    repository: String(campi.get('repository') ?? '').trim(),
    branch: String(campi.get('branch') ?? '').trim(),
    token: String(campi.get('token') ?? '').trim(),
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(app.impostazioni.repository)) {
    app.erroreConnessione = 'Scrivi il repository nella forma proprietario/nome, per esempio mario-rossi/spoglio.';
  } else if (!app.impostazioni.token) {
    app.erroreConnessione = 'Incolla il token di GitHub.';
  } else {
    const bottone = evento.target.querySelector('button[type="submit"]');
    bottone.textContent = 'Collegamento…';
    bottone.setAttribute('aria-disabled', 'true');
    await collega();
  }
  disegnaTutto({ ricostruisciModulo: true });
  if (app.repo) {
    messaggio('ok', `Collegato a GitHub${app.utente ? ` come ${app.utente}` : ''}.`);
    trova('titolo-connessione')?.focus();
  } else {
    trova('errore-connessione')?.focus();
  }
}

async function scollega() {
  app.repo = null;
  app.utente = null;
  app.erroreConnessione = null;
  app.impostazioni.token = '';
  memoria.scrivi(CHIAVE_IMPOSTAZIONI, app.impostazioni);
  await caricaPubblicati();
  disegnaTutto({ ricostruisciModulo: true });
  messaggio('', 'Token dimenticato da questo browser.');
  trova('titolo-connessione')?.focus();
}

async function ricarica() {
  await caricaPubblicati();
  disegnaTutto({ ricostruisciModulo: true });
  messaggio('', app.fonte);
}

/**
 * Legge il file su GitHub, lo trasforma e lo riscrive. Se nel frattempo un
 * altro scrutatore ha pubblicato (conflitto), riparte dalla versione nuova:
 * così nessuno cancella il lavoro degli altri.
 */
async function scriviSuGitHub(trasforma, messaggioCommit, { ignoraContenuto = false } = {}) {
  for (let tentativo = 1; ; tentativo += 1) {
    const { testo, sha } = await app.repo.leggi();
    let attuali = risultatiVuoti();
    if (testo && !ignoraContenuto) {
      try {
        attuali = normalizzaRisultati(JSON.parse(testo));
      } catch {
        throw new Error(
          `il file ${PERCORSO_RISULTATI} su GitHub non è un JSON valido. Correggilo a mano oppure usa «Azzera tutti i risultati».`,
        );
      }
    }
    const nuovi = trasforma(attuali);
    try {
      await app.repo.scrivi(formattaJSON(nuovi), sha, messaggioCommit);
      return nuovi;
    } catch (errore) {
      const conflitto = errore instanceof ErroreGitHub && (errore.stato === 409 || errore.stato === 422);
      if (!conflitto || tentativo >= 4) throw errore;
    }
  }
}

function messaggioCommit(bozze) {
  const parti = Object.entries(bozze.sezioni).map(
    ([id, dati]) => `sezione ${sezioneDaId(id)?.nome ?? id} ${STATO_BREVE[statoSezione(dati)]}`,
  );
  if (bozze.definitivi !== undefined)
    parti.push(bozze.definitivi ? 'risultati definitivi' : 'risultati di nuovo provvisori');
  if (bozze.avviso !== undefined) parti.push(bozze.avviso ? 'comunicazione aggiornata' : 'comunicazione tolta');
  const titolo = `Spoglio: ${parti.join(', ')}`;
  return titolo.length <= 72
    ? titolo
    : `Spoglio: ${formato.conteggio(parti.length, 'modifica', 'modifiche')}\n\n${parti.join('\n')}`;
}

async function pubblica() {
  if (app.occupato) return;
  if (numeroModifiche() === 0) {
    messaggio('', 'Non ci sono modifiche da pubblicare.');
    return;
  }
  const errori = Object.entries(app.bozze.sezioni).flatMap(([id, dati]) =>
    controllaSezione(app.config, sezioneDaId(id), dati)
      .filter((p) => p.livello === 'errore')
      .map((p) => `• Sezione ${sezioneDaId(id).nome}: ${p.messaggio}`),
  );
  if (
    errori.length > 0 &&
    !window.confirm(
      `Attenzione, ci sono dati impossibili:\n\n${errori.slice(0, 6).join('\n')}${
        errori.length > 6 ? `\n… e altri ${errori.length - 6}` : ''
      }\n\nPubblicare comunque?`,
    )
  ) {
    return;
  }

  const bozze = structuredClone(app.bozze);
  const adesso = new Date().toISOString();

  if (app.demo) {
    app.pubblicati = applicaBozze(app.config, app.pubblicati, bozze, adesso);
    app.bozze = { sezioni: {} };
    salvaBozze();
    disegnaTutto();
    messaggio(
      'ok',
      `Prova riuscita alle ${formato.ora(adesso)}. In modalità dimostrativa i dati non vengono inviati a nessuno.`,
    );
    return;
  }
  if (!app.repo) {
    messaggio(
      'errore',
      'Per pubblicare collega prima questo dispositivo a GitHub (riquadro qui sopra), oppure scarica il file.',
    );
    trova('titolo-connessione')?.focus();
    return;
  }

  app.occupato = true;
  disegnaAzioni();
  messaggio('', 'Pubblicazione in corso…');
  try {
    app.pubblicati = await scriviSuGitHub(
      (attuali) => applicaBozze(app.config, attuali, bozze, adesso),
      messaggioCommit(bozze),
    );
    // Toglie solo le bozze pubblicate: se nel frattempo hai scritto altro, resta in bozza.
    for (const [id, dati] of Object.entries(bozze.sezioni)) {
      if (uguali(app.bozze.sezioni[id], dati)) delete app.bozze.sezioni[id];
    }
    if (app.bozze.definitivi === bozze.definitivi) app.bozze.definitivi = undefined;
    if (app.bozze.avviso === bozze.avviso) app.bozze.avviso = undefined;
    pulisciBozze();
    app.fonte = `Pubblicato su GitHub alle ${formato.ora(adesso)}.`;
    messaggio('ok', `Pubblicato alle ${formato.ora(adesso)}. Il sito pubblico si aggiorna entro un paio di minuti.`);
  } catch (errore) {
    messaggio('errore', `Pubblicazione non riuscita: ${errore.message} Le modifiche restano salvate come bozza.`);
  } finally {
    app.occupato = false;
    disegnaTutto();
  }
}

async function azzera() {
  const risposta = window.prompt(
    'Questa operazione cancella TUTTI i risultati pubblicati e le bozze (per esempio dopo una prova).\n\nPer confermare scrivi AZZERA',
  );
  if (risposta?.trim().toUpperCase() !== 'AZZERA') return;
  const adesso = new Date().toISOString();
  const vuoti = { ...risultatiVuoti(), aggiornato: adesso };

  if (app.demo) {
    app.pubblicati = vuoti;
  } else if (app.repo) {
    app.occupato = true;
    disegnaAzioni();
    try {
      app.pubblicati = await scriviSuGitHub(() => vuoti, 'Spoglio: azzerati tutti i risultati', {
        ignoraContenuto: true,
      });
    } catch (errore) {
      messaggio('errore', `Azzeramento non riuscito: ${errore.message}`);
      return;
    } finally {
      app.occupato = false;
      disegnaAzioni();
    }
  } else {
    scaricaFile(vuoti);
    messaggio('', 'Scaricato un risultati.json vuoto: caricalo su GitHub al posto di quello attuale.');
  }
  app.bozze = { sezioni: {} };
  salvaBozze();
  disegnaTutto({ ricostruisciModulo: true });
  if (app.repo || app.demo) messaggio('ok', 'Tutti i risultati sono stati azzerati.');
}

function scaricaFile(contenuto = conBozze()) {
  const url = URL.createObjectURL(new Blob([formattaJSON(contenuto)], { type: 'application/json' }));
  const collegamento = h('a', { href: url, download: 'risultati.json', hidden: true });
  document.body.append(collegamento);
  collegamento.click();
  collegamento.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------- Pagina

function costruisciPagina() {
  app.el.connessione = h('section', { class: 'blocco', 'aria-labelledby': 'titolo-connessione' });
  app.el.grigliaSezioni = h('ul', { class: 'griglia-sezioni' });
  app.el.riepilogoSezioni = h('p', { class: 'sottotitolo' });
  app.el.modulo = h('section', { class: 'blocco', 'aria-labelledby': 'titolo-modulo', hidden: true });

  pagina.area.replaceChildren(
    app.el.connessione,
    h(
      'section',
      { class: 'blocco', 'aria-labelledby': 'titolo-sezioni' },
      h('h2', { id: 'titolo-sezioni' }, 'Sezioni'),
      app.el.riepilogoSezioni,
      h('p', { class: 'nota' }, 'Scegli una sezione per inserire o correggere i suoi risultati.'),
      app.el.grigliaSezioni,
    ),
    app.el.modulo,
    bloccoGenerale(),
  );

  app.el.contatore = h('strong', {});
  app.el.messaggio = h('span', { class: 'messaggio-azione', role: 'status' });
  app.el.pubblica = h('button', { type: 'button', class: 'bottone primario', onclick: pubblica });
  pagina.azioni.firstElementChild.replaceChildren(
    h('div', { class: 'testi-azione' }, app.el.contatore, app.el.messaggio),
    h(
      'div',
      { class: 'riga-azioni' },
      h(
        'button',
        { type: 'button', class: 'bottone', onclick: () => scaricaFile() },
        icona('scarica'),
        'Scarica il file',
      ),
      app.el.pubblica,
    ),
  );
  pagina.azioni.hidden = false;
}

function disegnaTutto({ ricostruisciModulo = false } = {}) {
  disegnaConnessione();
  disegnaSezioni();
  disegnaGenerale();
  disegnaAzioni();
  if (app.selezionata) {
    // Il modulo aperto si ricostruisce solo se non contiene modifiche in corso.
    if (ricostruisciModulo && !app.bozze.sezioni[app.selezionata]) apriSezione(app.selezionata, { focus: false });
    else aggiornaControlli();
    app.el.annulla.hidden = !app.bozze.sezioni[app.selezionata];
  }
}

function disegnaConnessione() {
  const blocco = app.el.connessione;
  const titolo = h(
    'h2',
    { id: 'titolo-connessione', tabindex: '-1' },
    app.demo ? 'Modalità dimostrativa' : 'Collegamento a GitHub',
  );

  if (app.demo) {
    riempi(
      blocco,
      titolo,
      h(
        'p',
        {},
        "Stai provando l'area scrutatori con liste e candidati inventati. Inserisci pure dei numeri e premi «Pubblica»: i dati restano solo in questo browser.",
      ),
      h(
        'div',
        { class: 'riga-azioni' },
        h('a', { class: 'bottone', href: 'index.html?demo' }, 'Vedi la demo del sito pubblico'),
        h('a', { class: 'bottone', href: 'admin.html' }, 'Esci dalla demo'),
      ),
    );
    return;
  }

  const erroreConnessione = app.erroreConnessione
    ? avviso('critico', 'errore', h('strong', { id: 'errore-connessione', tabindex: '-1' }, app.erroreConnessione))
    : null;

  if (app.repo) {
    riempi(
      blocco,
      titolo,
      h(
        'p',
        { class: 'stato-connessione ok' },
        icona('collegato'),
        h(
          'span',
          {},
          `Collegato${app.utente ? ` come ${app.utente}` : ''}: pubblichi su ${app.repo.nomeCompleto}, branch ${app.repo.branch}.`,
        ),
      ),
      erroreConnessione,
      h('p', { class: 'nota' }, app.fonte),
      h(
        'div',
        { class: 'riga-azioni' },
        h(
          'button',
          { type: 'button', class: 'bottone', onclick: ricarica },
          icona('aggiorna'),
          'Ricarica i dati pubblicati',
        ),
        h('button', { type: 'button', class: 'bottone', onclick: scollega }, 'Dimentica il token'),
      ),
    );
    return;
  }

  riempi(
    blocco,
    titolo,
    h(
      'p',
      { class: 'stato-connessione no' },
      icona('cerchio'),
      h(
        'span',
        {},
        'Non collegato: puoi già inserire i dati, ma per pubblicarli questo dispositivo deve essere collegato al repository GitHub del sito.',
      ),
    ),
    erroreConnessione,
    h('p', { class: 'nota' }, app.fonte),
    h(
      'form',
      { class: 'modulo-connessione', onsubmit: inviaConnessione },
      h(
        'div',
        { class: 'griglia-campi larga' },
        campoTesto('Repository', 'repository', app.impostazioni.repository, 'Nella forma proprietario/nome.'),
        campoTesto(
          'Branch (facoltativo)',
          'branch',
          app.impostazioni.branch,
          'Vuoto = il branch principale del repository.',
        ),
      ),
      campoTesto('Token di GitHub', 'token', '', 'Resta salvato solo in questo browser.', { type: 'password' }),
      h(
        'div',
        { class: 'riga-azioni' },
        h('button', { type: 'submit', class: 'bottone primario' }, icona('collegato'), 'Collega'),
      ),
    ),
    aiutoToken(),
  );
}

function campoTesto(etichetta, nome, valore, aiuto, attributi = {}) {
  const id = `campo-${nome}`;
  return h(
    'div',
    { class: 'campo' },
    h('label', { for: id }, etichetta),
    h('input', {
      id,
      name: nome,
      class: 'input',
      type: 'text',
      value: valore,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-describedby': `${id}-aiuto`,
      ...attributi,
    }),
    h('span', { class: 'aiuto', id: `${id}-aiuto` }, aiuto),
  );
}

function aiutoToken() {
  return h(
    'details',
    { class: 'dettagli interni' },
    h('summary', {}, 'Come si crea il token'),
    h(
      'div',
      { class: 'dettagli-corpo' },
      h(
        'ol',
        { class: 'passi' },
        h(
          'li',
          {},
          'Entra in GitHub con un account che può modificare il repository e apri ',
          h(
            'a',
            { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' },
            'la pagina per creare un token',
          ),
          '.',
        ),
        h('li', {}, 'Dagli un nome (per esempio «Spoglio») e una scadenza subito dopo lo spoglio.'),
        h(
          'li',
          {},
          'In «Repository access» scegli «Only select repositories» e seleziona solo il repository del sito.',
        ),
        h('li', {}, 'In «Permissions», alla voce «Contents», scegli «Read and write».'),
        h('li', {}, 'Premi «Generate token», copia il token (inizia con github_pat_) e incollalo qui sopra.'),
      ),
      h(
        'p',
        { class: 'nota' },
        'Chi ha il token può modificare i risultati: non condividerlo in chat, usalo solo su dispositivi fidati e a fine spoglio premi «Dimentica il token» (o cancellalo da GitHub).',
      ),
    ),
  );
}

function disegnaSezioni() {
  const risultati = conBozze();
  const conteggio = contaSezioni(app.config, risultati);
  app.el.riepilogoSezioni.textContent = `${conteggio.scrutinata} scrutinate, ${conteggio['in-corso']} in corso, ${conteggio['da-scrutinare']} da scrutinare (su ${conteggio.totale}).`;
  app.el.grigliaSezioni.replaceChildren(
    ...app.config.sezioni.map((sezione) => {
      const stato = statoSezione(risultati.sezioni[sezione.id]);
      const inBozza = Boolean(app.bozze.sezioni[sezione.id]);
      return h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: `bottone-sezione stato-${stato}`,
            'aria-current': sezione.id === app.selezionata ? 'true' : null,
            onclick: () => apriSezione(sezione.id),
          },
          h('span', { class: 'nome-sezione' }, icona(ICONA_STATO[stato]), sezione.nome),
          h('span', { class: 'stato-breve' }, STATO_BREVE[stato]),
          inBozza ? h('span', { class: 'segno-bozza' }, 'bozza') : null,
          inBozza ? h('span', { class: 'sr-only' }, ', con modifiche non pubblicate') : null,
        ),
      );
    }),
  );
}

// ------------------------------------------------------ Modulo di sezione

let contatoreCampi = 0;

function apriSezione(id, { focus = true } = {}) {
  const sezione = sezioneDaId(id);
  app.selezionata = id;
  window.history.replaceState(null, '', `${window.location.search}#sezione-${encodeURIComponent(id)}`);
  const dati = datiSezione(id);
  const stato = statoSezione(dati);
  const indice = app.config.sezioni.indexOf(sezione);
  const precedente = app.config.sezioni[indice - 1];
  const successiva = app.config.sezioni[indice + 1];

  app.el.problemi = h('ul', { class: 'problemi' });
  app.el.annulla = h(
    'button',
    { type: 'button', class: 'bottone pericolo', onclick: annullaSezione, hidden: !app.bozze.sezioni[id] },
    'Annulla le modifiche non pubblicate',
  );

  const modulo = h(
    'form',
    {
      id: 'modulo-sezione',
      class: 'griglia-due',
      novalidate: true,
      onsubmit: (evento) => evento.preventDefault(),
      oninput: aggiornaDaModulo,
      onchange: aggiornaDaModulo,
      onkeydown: invioPassaAvanti,
    },
    h(
      'div',
      {},
      h('h2', { id: 'titolo-modulo', tabindex: '-1' }, `Sezione ${sezione.nome}`),
      h(
        'p',
        { class: 'sottotitolo' },
        sezione.aventiDiritto === null
          ? 'Aventi diritto al voto non indicati.'
          : `${formato.conteggio(sezione.aventiDiritto, 'avente diritto', 'aventi diritto')} al voto.`,
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', { class: 'etichetta-gruppo' }, 'Stato dello scrutinio'),
      h(
        'div',
        { class: 'scelta-stato' },
        STATI_SEZIONE.map((valore) =>
          h(
            'label',
            {},
            h('input', { type: 'radio', name: 'stato', value: valore, checked: valore === stato }),
            ETICHETTE_STATO[valore],
          ),
        ),
      ),
      h(
        'p',
        { class: 'nota' },
        'Con «Scrutinio in corso» i voti inseriti compaiono già sul sito come dati parziali. Quando hai finito di contare scegli «Scrutinata».',
      ),
    ),
    app.config.elezioni.map((elezione) => moduloElezione(elezione, dati?.elezioni?.[elezione.id])),
    h('div', { class: 'blocco-controlli' }, h('h3', {}, 'Controlli'), app.el.problemi),
    h(
      'div',
      { class: 'riga-azioni' },
      precedente
        ? h(
            'button',
            { type: 'button', class: 'bottone', onclick: () => apriSezione(precedente.id) },
            icona('sinistra'),
            `Sezione ${precedente.nome}`,
          )
        : null,
      successiva
        ? h(
            'button',
            { type: 'button', class: 'bottone', onclick: () => apriSezione(successiva.id) },
            `Sezione ${successiva.nome}`,
            icona('destra'),
          )
        : null,
      app.el.annulla,
    ),
  );

  app.el.modulo.replaceChildren(modulo);
  app.el.modulo.hidden = false;
  aggiornaControlli();
  disegnaSezioni();
  if (focus) {
    const titolo = trova('titolo-modulo');
    titolo.focus({ preventScroll: true });
    titolo.scrollIntoView({ block: 'start' });
  }
}

function moduloElezione(elezione, dati) {
  // Senza dati i campi restano vuoti; con dati mostrano anche gli zeri.
  const valore = (numero) => (dati ? String(intero(numero)) : '');
  const campo = (etichetta, dataset, numero) =>
    campoNumero(etichetta, { elezione: elezione.id, ...dataset }, valore(numero));
  return h(
    'fieldset',
    { class: 'modulo-elezione' },
    h('legend', {}, elezione.nome),
    h(
      'div',
      { class: 'griglia-campi' },
      campo('Votanti', { campo: 'votanti' }, dati?.votanti),
      campo('Schede bianche', { campo: 'bianche' }, dati?.bianche),
      campo('Schede nulle', { campo: 'nulle' }, dati?.nulle),
    ),
    elezione.liste.map((lista) => {
      const datiLista = dati?.liste?.[lista.numero];
      return h(
        'fieldset',
        { class: `modulo-lista ${classeColore(lista.colore)}` },
        h('legend', {}, simboloLista(lista, 'piccolo'), `Lista ${lista.numero} – ${lista.nome}`),
        h(
          'div',
          { class: 'griglia-campi' },
          campo('Voti di lista', { campo: 'voti', lista: lista.numero }, datiLista?.voti),
        ),
        elezione.maxPreferenze > 0 && lista.candidati.length > 0
          ? h(
              'fieldset',
              { class: 'gruppo-preferenze' },
              h('legend', { class: 'etichetta-gruppo' }, 'Preferenze'),
              h(
                'div',
                { class: 'griglia-campi' },
                lista.candidati.map((candidato) =>
                  campo(
                    candidato.nome,
                    { campo: 'preferenze', lista: lista.numero, candidato: candidato.nome },
                    datiLista?.preferenze?.[candidato.nome],
                  ),
                ),
              ),
            )
          : null,
      );
    }),
    h('p', { class: 'riepilogo-schede', dataset: { riepilogo: elezione.id } }),
  );
}

function campoNumero(etichetta, dataset, valore) {
  contatoreCampi += 1;
  const id = `numero-${contatoreCampi}`;
  return h(
    'div',
    { class: 'campo' },
    h('label', { for: id }, etichetta),
    h('input', {
      id,
      class: 'input numero',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      maxlength: '5',
      autocomplete: 'off',
      dataset,
      value: valore,
    }),
  );
}

/** Legge il modulo e restituisce i dati della sezione in forma canonica. */
function leggiModulo(modulo) {
  const grezzi = { stato: modulo.querySelector('input[name="stato"]:checked')?.value, elezioni: {} };
  let qualcosaInserito = false;
  for (const input of modulo.querySelectorAll('input.numero')) {
    const { elezione, campo, lista, candidato } = input.dataset;
    if (input.value !== '') qualcosaInserito = true;
    const datiElezione = (grezzi.elezioni[elezione] ??= { liste: {} });
    const numero = intero(input.value);
    if (campo === 'voti') (datiElezione.liste[lista] ??= { preferenze: {} }).voti = numero;
    else if (campo === 'preferenze') (datiElezione.liste[lista] ??= { preferenze: {} }).preferenze[candidato] = numero;
    else datiElezione[campo] = numero;
  }
  if (!qualcosaInserito) delete grezzi.elezioni;
  return sezioneCanonica(app.config, grezzi);
}

function aggiornaDaModulo(evento) {
  const modulo = evento.currentTarget;
  const campo = evento.target;
  if (campo.matches('input.numero')) {
    const pulito = campo.value.replace(/\D/g, '').slice(0, 5);
    if (pulito !== campo.value) campo.value = pulito;
    // Il primo numero inserito in una sezione da scrutinare la mette "in corso".
    const stato = modulo.querySelector('input[name="stato"]:checked');
    if (pulito !== '' && stato?.value === 'da-scrutinare') {
      modulo.querySelector('input[name="stato"][value="in-corso"]').checked = true;
      annuncia(pagina.annuncio, 'Stato della sezione: scrutinio in corso.');
    }
  }

  const dati = leggiModulo(modulo);
  const pubblicata = sezioneCanonica(app.config, app.pubblicati.sezioni[app.selezionata]);
  if (uguali(dati, pubblicata)) delete app.bozze.sezioni[app.selezionata];
  else app.bozze.sezioni[app.selezionata] = dati;
  salvaBozze();

  app.el.annulla.hidden = !app.bozze.sezioni[app.selezionata];
  aggiornaControlli();
  disegnaSezioni();
  disegnaAzioni();
}

/** Invio passa al campo successivo, come in un foglio di calcolo. */
function invioPassaAvanti(evento) {
  if (evento.key !== 'Enter' || !evento.target.matches('input.numero')) return;
  evento.preventDefault();
  const campi = [...evento.currentTarget.querySelectorAll('input.numero')];
  const prossimo = campi[campi.indexOf(evento.target) + 1];
  if (prossimo) {
    prossimo.focus();
    prossimo.select();
  }
}

function annullaSezione() {
  const sezione = sezioneDaId(app.selezionata);
  if (!window.confirm(`Annullare le modifiche non pubblicate della sezione ${sezione.nome}?`)) return;
  delete app.bozze.sezioni[app.selezionata];
  salvaBozze();
  apriSezione(app.selezionata);
  disegnaAzioni();
}

function aggiornaControlli() {
  if (!app.selezionata || !app.el.problemi) return;
  const sezione = sezioneDaId(app.selezionata);
  const dati = datiSezione(app.selezionata);

  for (const elezione of app.config.elezioni) {
    const riepilogo = app.el.modulo.querySelector(`[data-riepilogo="${CSS.escape(elezione.id)}"]`);
    if (!riepilogo) continue;
    const d = dati?.elezioni?.[elezione.id];
    const validi = elezione.liste.reduce((somma, l) => somma + intero(d?.liste?.[l.numero]?.voti), 0);
    const schede = validi + intero(d?.bianche) + intero(d?.nulle);
    riepilogo.replaceChildren(
      h('span', {}, 'Schede contate: ', h('strong', {}, formato.numero(schede))),
      h(
        'span',
        {},
        `(${formato.numero(validi)} voti di lista + ${formato.numero(intero(d?.bianche))} bianche + ${formato.numero(intero(d?.nulle))} nulle)`,
      ),
      h('span', {}, 'Votanti: ', h('strong', {}, formato.numero(intero(d?.votanti)))),
    );
  }

  const problemi = controllaSezione(app.config, sezione, dati);
  const nomeElezione = (id) => app.config.elezioni.find((e) => e.id === id)?.nome ?? id;
  const daScrutinare = statoSezione(dati) === 'da-scrutinare';
  app.el.problemi.replaceChildren(
    ...(problemi.length
      ? problemi.map((p) =>
          h(
            'li',
            { class: p.livello === 'errore' ? 'errore' : 'avviso-dato' },
            icona(p.livello === 'errore' ? 'errore' : 'avviso'),
            h('span', {}, h('strong', {}, `${nomeElezione(p.elezione)}: `), p.messaggio),
          ),
        )
      : [
          h(
            'li',
            { class: 'tutto-ok' },
            icona(daScrutinare ? 'cerchio' : 'spunta'),
            daScrutinare
              ? 'Sezione da scrutinare: i numeri non vengono conteggiati.'
              : 'Nessun problema: i numeri tornano.',
          ),
        ]),
  );
}

// ------------------------------------------- Comunicazioni e chiusura

function bloccoGenerale() {
  app.el.avvisoPubblico = h('textarea', {
    id: 'avviso-pubblico',
    class: 'input',
    rows: '3',
    maxlength: '500',
    'aria-describedby': 'avviso-pubblico-aiuto',
    oninput: (evento) => {
      const testo = evento.target.value.trim();
      app.bozze.avviso = testo === app.pubblicati.avviso ? undefined : testo;
      salvaBozze();
      disegnaAzioni();
    },
  });
  app.el.definitivi = h('input', {
    type: 'checkbox',
    id: 'definitivi',
    onchange: (evento) => {
      const valore = evento.target.checked;
      app.bozze.definitivi = valore === app.pubblicati.definitivi ? undefined : valore;
      salvaBozze();
      disegnaAzioni();
    },
  });

  return h(
    'section',
    { class: 'blocco griglia-due', 'aria-labelledby': 'titolo-generale' },
    h('h2', { id: 'titolo-generale' }, 'Comunicazioni e chiusura dello spoglio'),
    h(
      'div',
      { class: 'campo' },
      h('label', { for: 'avviso-pubblico' }, 'Comunicazione sul sito (facoltativa)'),
      app.el.avvisoPubblico,
      h(
        'span',
        { class: 'aiuto', id: 'avviso-pubblico-aiuto' },
        'Compare in evidenza sulla pagina pubblica, per esempio «Lo spoglio riprende alle 14». Lascia vuoto per non mostrare nulla.',
      ),
    ),
    h(
      'div',
      { class: 'casella' },
      app.el.definitivi,
      h(
        'label',
        { for: 'definitivi' },
        h('strong', {}, 'Risultati definitivi'),
        h(
          'span',
          { class: 'aiuto' },
          'Da spuntare solo dopo la proclamazione degli eletti da parte della Commissione elettorale.',
        ),
      ),
    ),
    h(
      'details',
      { class: 'dettagli interni' },
      h('summary', {}, 'Azzera tutti i risultati'),
      h(
        'div',
        { class: 'dettagli-corpo' },
        h('p', {}, 'Serve dopo le prove, prima del vero spoglio: cancella tutti i risultati pubblicati e le bozze.'),
        h(
          'div',
          {},
          h('button', { type: 'button', class: 'bottone pericolo', onclick: azzera }, 'Azzera tutti i risultati'),
        ),
      ),
    ),
  );
}

function disegnaGenerale() {
  if (document.activeElement !== app.el.avvisoPubblico) {
    app.el.avvisoPubblico.value = app.bozze.avviso ?? app.pubblicati.avviso;
  }
  app.el.definitivi.checked = app.bozze.definitivi ?? app.pubblicati.definitivi;
}

function disegnaAzioni() {
  const n = numeroModifiche();
  app.el.contatore.textContent =
    n === 0 ? 'Tutto pubblicato' : `${formato.conteggio(n, 'modifica', 'modifiche')} da pubblicare`;
  app.el.pubblica.replaceChildren(
    icona('carica'),
    app.occupato ? 'Pubblicazione…' : app.demo ? 'Pubblica (prova)' : 'Pubblica',
  );
  if (app.occupato || n === 0) app.el.pubblica.setAttribute('aria-disabled', 'true');
  else app.el.pubblica.removeAttribute('aria-disabled');
}

function messaggio(tipo, testo) {
  app.el.messaggio.className = `messaggio-azione ${tipo}`;
  app.el.messaggio.textContent = testo;
}

// ----------------------------------------------------------------- Aiuti

function avviso(tipo, nomeIcona, ...contenuto) {
  return h('div', { class: `avviso ${tipo}` }, icona(nomeIcona), h('div', { class: 'avviso-testo' }, ...contenuto));
}

function erroreGrave(titolo, dettagli) {
  pagina.area.replaceChildren(
    h(
      'div',
      { class: 'avviso critico errore-grave', role: 'alert' },
      icona('errore'),
      h(
        'div',
        { class: 'avviso-testo' },
        h('strong', {}, titolo),
        h(
          'ul',
          {},
          dettagli.map((d) => h('li', {}, d)),
        ),
        h('p', {}, 'Correggi il problema e ricarica la pagina.'),
      ),
    ),
  );
}
