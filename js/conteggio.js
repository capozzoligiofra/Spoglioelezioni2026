/**
 * Conteggio "scheda per scheda" dell'area scrutatori, pensato per il telefono.
 *
 * Per ogni scheda letta ad alta voce si tocca la lista (oppure direttamente i
 * candidati con la preferenza: la lista si seleziona da sola), o «Bianca» /
 * «Nulla», e si preme «Conferma». I totali si aggiornano da soli e, se si
 * vuole, vengono pubblicati in automatico ogni tot schede.
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

const vuota = () => ({ tipo: null, lista: null, preferenze: [] });

/** "Lista II · Rossi Mario, Bianchi Anna", "Scheda bianca", "Scheda nulla" */
export function descriviScheda(scheda) {
  if (scheda.tipo === 'bianca') return 'Scheda bianca';
  if (scheda.tipo === 'nulla') return 'Scheda nulla';
  if (scheda.tipo === 'lista') {
    return `Lista ${scheda.lista}${scheda.preferenze.length ? ` · ${scheda.preferenze.join(', ')}` : ''}`;
  }
  return '';
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
  const stato = {
    elezione: config.elezioni.some((e) => e.id === salvate.elezione) ? salvate.elezione : config.elezioni[0].id,
    ogni: OGNI_QUANTE_SCHEDE.includes(salvate.ogni) ? salvate.ogni : 20,
    storico: Array.isArray(salvate.storico) ? salvate.storico.slice(-200) : [],
    scheda: vuota(),
    ultimaConferma: 0,
    timer: null,
    inVolo: false,
    erroreAlle: 0,
  };
  const el = { tasti: new Map() };

  const elezione = () => config.elezioni.find((e) => e.id === stato.elezione);
  const numeri = () => elezioneCanonica(elezione(), dati(stato.elezione));
  const daPubblicare = () =>
    Math.max(
      0,
      schedeContate(elezione(), dati(stato.elezione)) - schedeContate(elezione(), datiPubblicati(stato.elezione)),
    );
  const persisti = () =>
    memoria.scrivi(chiave, { elezione: stato.elezione, ogni: stato.ogni, storico: stato.storico.slice(-200) });
  const ultimaDellElezione = () => {
    for (let i = stato.storico.length - 1; i >= 0; i -= 1) {
      const voce = stato.storico[i];
      if (voce.sezione === sezione.id && voce.elezione === stato.elezione) return i;
    }
    return -1;
  };

  // ------------------------------------------------------------ Elementi fissi

  el.schedaCorrente = h('p', { class: 'scheda-corrente', 'aria-live': 'polite' });
  el.svuota = h('button', { type: 'button', class: 'bottone', onclick: () => cambiaScheda(vuota()) }, 'Svuota');
  el.conferma = h(
    'button',
    { type: 'button', class: 'bottone primario tasto-conferma', onclick: conferma },
    icona('spunta'),
    'Conferma scheda',
  );
  const barra = h(
    'div',
    { class: 'riga-conteggio' },
    el.schedaCorrente,
    h('div', { class: 'riga-azioni' }, el.svuota, el.conferma),
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
  el.annullaUltima = h(
    'button',
    { type: 'button', class: 'bottone pericolo', onclick: annullaUltima },
    icona('sinistra'),
    "Annulla l'ultima scheda",
  );
  el.ultima = h('p', { class: 'nota' });
  el.automatica = h(
    'select',
    { id: 'pubblica-ogni', class: 'input', onchange: cambiaAutomatica },
    OGNI_QUANTE_SCHEDE.map((n) =>
      h('option', { value: String(n) }, n ? `Ogni ${n} schede` : 'Solo quando premo «Pubblica»'),
    ),
  );
  el.statoAutomatica = h('p', { class: 'nota' });

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
    h(
      'p',
      { class: 'nota' },
      'Per ogni scheda tocca la lista votata, oppure direttamente i candidati con la preferenza (la lista si seleziona da sola), poi premi «Conferma scheda» in basso.',
    ),
    el.griglia,
    h('div', { class: 'riga-azioni annulla-ultima' }, el.annullaUltima, el.ultima),
    h(
      'div',
      { class: 'campo pubblicazione-automatica' },
      h('label', { for: 'pubblica-ogni' }, 'Pubblica in automatico'),
      el.automatica,
      el.statoAutomatica,
    ),
  );

  costruisciGriglia();
  disegna();

  // ---------------------------------------------------------------- Disegno

  function costruisciGriglia() {
    const e = elezione();
    el.tasti.clear();
    // Ogni tasto ha un numero (voti o preferenze già contati) che si aggiorna da solo.
    const tasto = (chiaveTasto, classe, onclick, contenuto, conta = h('span', { class: 'conta' })) => {
      const bottone = h('button', { type: 'button', class: classe, 'aria-pressed': 'false', onclick }, ...contenuto);
      if (!bottone.contains(conta)) bottone.append(conta);
      el.tasti.set(chiaveTasto, { bottone, conta });
      return bottone;
    };
    el.griglia.replaceChildren(
      ...e.liste.map((lista) =>
        h(
          'section',
          { class: `conteggio-lista ${classeColore(lista.colore)}`, 'aria-label': `Lista ${lista.numero}` },
          tasto(`lista:${lista.numero}`, 'tasto-lista', () => tocca({ tipo: 'lista', lista: lista.numero }), [
            simboloLista(lista, 'piccolo'),
            h(
              'span',
              { class: 'tasto-testo' },
              h('span', { class: 'tasto-nome' }, `Lista ${lista.numero} – ${lista.nome}`),
            ),
            icona('spunta', 'segno-scelta'),
          ]),
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
                    () => tocca({ tipo: 'candidato', lista: lista.numero, nome: candidato.nome }),
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
                      icona('spunta', 'segno-scelta'),
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
        tasto('bianca', 'tasto-speciale', () => tocca({ tipo: 'bianca' }), [
          h('span', { class: 'tasto-nome' }, 'Bianca'),
          icona('spunta', 'segno-scelta'),
        ]),
        tasto('nulla', 'tasto-speciale', () => tocca({ tipo: 'nulla' }), [
          h('span', { class: 'tasto-nome' }, 'Nulla'),
          icona('spunta', 'segno-scelta'),
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
    const s = stato.scheda;
    const contate = schedeContate(e, n);

    // Numeri sui tasti e tasti scelti per la scheda in corso
    for (const lista of e.liste) {
      const tastoLista = el.tasti.get(`lista:${lista.numero}`);
      tastoLista.conta.textContent = formato.conteggio(n.liste[lista.numero].voti, 'voto', 'voti');
      tastoLista.bottone.setAttribute('aria-pressed', String(s.tipo === 'lista' && s.lista === lista.numero));
      for (const candidato of lista.candidati) {
        const tastoCandidato = el.tasti.get(`candidato:${lista.numero}:${candidato.nome}`);
        if (!tastoCandidato) continue;
        tastoCandidato.conta.textContent = formato.conteggio(
          n.liste[lista.numero].preferenze[candidato.nome],
          'pref.',
          'pref.',
        );
        tastoCandidato.bottone.setAttribute(
          'aria-pressed',
          String(s.tipo === 'lista' && s.lista === lista.numero && s.preferenze.includes(candidato.nome)),
        );
      }
    }
    el.tasti.get('bianca').conta.textContent = formato.numero(n.bianche);
    el.tasti.get('bianca').bottone.setAttribute('aria-pressed', String(s.tipo === 'bianca'));
    el.tasti.get('nulla').conta.textContent = formato.numero(n.nulle);
    el.tasti.get('nulla').bottone.setAttribute('aria-pressed', String(s.tipo === 'nulla'));

    // Riepilogo e votanti
    el.contate.replaceChildren(
      h('strong', {}, formato.conteggio(contate, 'scheda contata', 'schede contate')),
      n.votanti ? ` su ${formato.numero(n.votanti)} votanti` : '',
    );
    if (document.activeElement !== el.votanti) el.votanti.value = n.votanti ? String(n.votanti) : '';

    // Scheda in corso (nella barra in basso)
    const prossima = `Scheda n. ${formato.numero(contate + 1)}`;
    el.schedaCorrente.replaceChildren(
      h('strong', {}, prossima),
      s.tipo ? `: ${descriviScheda(s)}` : ': tocca la lista, i candidati, «Bianca» o «Nulla»',
    );
    if (s.tipo) el.conferma.removeAttribute('aria-disabled');
    else el.conferma.setAttribute('aria-disabled', 'true');
    el.svuota.hidden = !s.tipo;

    // Ultima scheda registrata
    const ultima = ultimaDellElezione();
    el.annullaUltima.hidden = ultima < 0;
    el.ultima.textContent = ultima < 0 ? '' : `Ultima registrata: ${descriviScheda(stato.storico[ultima].scheda)}`;

    // Pubblicazione automatica
    el.automatica.value = String(stato.ogni);
    el.statoAutomatica.textContent = spiegazioneAutomatica();
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

  function cambiaScheda(scheda) {
    stato.scheda = scheda;
    disegna();
  }

  function tocca(azione) {
    const s = stato.scheda;
    const max = elezione().maxPreferenze;
    if (azione.tipo === 'bianca' || azione.tipo === 'nulla') {
      cambiaScheda(s.tipo === azione.tipo ? vuota() : { tipo: azione.tipo, lista: null, preferenze: [] });
    } else if (azione.tipo === 'lista') {
      cambiaScheda(
        s.tipo === 'lista' && s.lista === azione.lista
          ? vuota()
          : { tipo: 'lista', lista: azione.lista, preferenze: [] },
      );
    } else if (s.tipo !== 'lista' || s.lista !== azione.lista) {
      // Preferenza a un candidato: vale anche come voto alla sua lista.
      cambiaScheda({ tipo: 'lista', lista: azione.lista, preferenze: [azione.nome] });
    } else if (s.preferenze.includes(azione.nome)) {
      cambiaScheda({ ...s, preferenze: s.preferenze.filter((nome) => nome !== azione.nome) });
    } else if (s.preferenze.length >= max) {
      navigator.vibrate?.([40, 60, 40]);
      annuncia(`Al massimo ${formato.conteggio(max, 'preferenza', 'preferenze')} per scheda.`);
      el.schedaCorrente.classList.remove('lampeggia-errore');
      void el.schedaCorrente.offsetWidth;
      el.schedaCorrente.classList.add('lampeggia-errore');
    } else {
      cambiaScheda({ ...s, preferenze: [...s.preferenze, azione.nome] });
    }
  }

  function conferma() {
    const scheda = stato.scheda;
    // Niente scheda scelta, o doppio tocco involontario sul tasto
    if (!scheda.tipo || Date.now() - stato.ultimaConferma < 400) return;
    stato.ultimaConferma = Date.now();
    const e = elezione();
    const prima = dati(e.id);
    const numero = schedeContate(e, prima) + 1;
    salva(e.id, applicaScheda(e, prima, scheda, +1));
    stato.storico.push({ sezione: sezione.id, elezione: e.id, scheda, ora: Date.now() });
    stato.scheda = vuota();
    persisti();
    disegna();
    navigator.vibrate?.(25);
    barra.classList.remove('lampeggia');
    void barra.offsetWidth;
    barra.classList.add('lampeggia');
    annuncia(`Scheda ${numero} registrata: ${descriviScheda(scheda)}.`);
    controlla();
  }

  function annullaUltima() {
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
  }

  function cambiaElezione(id) {
    stato.elezione = id;
    stato.scheda = vuota();
    persisti();
    costruisciGriglia();
    disegna();
    controlla();
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
    stato.timer = setTimeout(pubblicaInAutomatico, attesa);
  }

  async function pubblicaInAutomatico() {
    if (stato.inVolo || daPubblicare() === 0) return;
    stato.inVolo = true;
    const esito = await pubblica({ automatica: true });
    stato.inVolo = false;
    if (esito === false) stato.erroreAlle = Date.now();
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
