/**
 * Piccoli aiuti per costruire la pagina. Il testo viene sempre inserito come
 * testo (mai come HTML), così un nome strano in un file di dati non può
 * rompere la pagina né eseguire codice.
 */

/**
 * Crea un elemento: h('p', { class: 'nota' }, 'Ciao ', h('strong', {}, 'mondo')).
 * Attributi: false/null/undefined vengono saltati, true diventa attributo vuoto,
 * "on…" aggiunge un gestore di eventi, "style" accetta { '--variabile': valore }.
 */
export function h(tag, attributi, ...figli) {
  const elemento = document.createElement(tag);
  for (const [nome, valore] of Object.entries(attributi ?? {})) {
    if (valore === null || valore === undefined || valore === false) continue;
    if (nome.startsWith('on') && typeof valore === 'function') {
      elemento.addEventListener(nome.slice(2), valore);
    } else if (nome === 'style') {
      for (const [proprieta, v] of Object.entries(valore)) elemento.style.setProperty(proprieta, v);
    } else if (nome === 'dataset') {
      Object.assign(elemento.dataset, valore);
    } else if (nome === 'value') {
      elemento.value = valore;
    } else {
      elemento.setAttribute(nome, valore === true ? '' : String(valore));
    }
  }
  aggiungi(elemento, figli);
  return elemento;
}

/** Come elemento.replaceChildren(), ma salta null/false come h(). */
export function riempi(elemento, ...figli) {
  elemento.replaceChildren();
  aggiungi(elemento, figli);
}

function aggiungi(elemento, figli) {
  for (const figlio of figli) {
    if (figlio === null || figlio === undefined || figlio === false) continue;
    if (Array.isArray(figlio)) aggiungi(elemento, figlio);
    else elemento.append(figlio instanceof Node ? figlio : String(figlio));
  }
}

const SVG = 'http://www.w3.org/2000/svg';

// Icone disegnate a tratto su una griglia 24×24.
const ICONE = {
  spunta: [['path', { d: 'M20 6 9 17l-5-5' }]],
  orologio: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 7v5l3 2' }],
  ],
  cerchio: [['circle', { cx: 12, cy: 12, r: 8 }]],
  aggiorna: [
    ['path', { d: 'M21 12a9 9 0 1 1-2.64-6.36L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  avviso: [
    ['path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }],
    ['path', { d: 'M12 9v4M12 17h.01' }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 11v5M12 8h.01' }],
  ],
  errore: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'm15 9-6 6M9 9l6 6' }],
  ],
  lucchetto: [
    ['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  ],
  megafono: [
    [
      'path',
      { d: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13' },
    ],
  ],
  scarica: [['path', { d: 'M12 4v11M7 10l5 5 5-5M5 20h14' }]],
  carica: [['path', { d: 'M12 20V9M7 14l5-5 5 5M5 4h14' }]],
  sinistra: [['path', { d: 'M15 18l-6-6 6-6' }]],
  destra: [['path', { d: 'M9 18l6-6-6-6' }]],
  urna: [['path', { d: 'M4 11h16v9H4zM8 11V4h8v7M10 7h4' }]],
  collegato: [
    [
      'path',
      { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' },
    ],
  ],
};

/** Icona decorativa (nascosta ai lettori di schermo: il testo accanto dice tutto). */
export function icona(nome, classe = '') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `icona ${classe}`.trim());
  for (const [tag, attributi] of ICONE[nome]) {
    const parte = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attributi)) parte.setAttribute(k, v);
    svg.append(parte);
  }
  return svg;
}

/** Classe CSS con il colore della lista (le liste oltre l'ottava sono grigie). */
export const classeColore = (colore) => (colore ? `serie-${colore}` : 'serie-altro');

/** Tondo colorato con il numero della lista, come un piccolo simbolo elettorale. */
export function simboloLista(lista, classe = '') {
  const lunghezza = lista.numero.length;
  return h(
    'span',
    {
      class: `simbolo ${classeColore(lista.colore)} ${lunghezza > 3 ? 'lungo' : lunghezza > 2 ? 'medio' : ''} ${classe}`,
      'aria-hidden': 'true',
    },
    lista.numero,
  );
}

/** Scrive un messaggio per i lettori di schermo in una regione aria-live. */
export function annuncia(regione, messaggio) {
  regione.textContent = '';
  // Il breve ritardo fa sì che lo stesso messaggio venga letto di nuovo.
  setTimeout(() => {
    regione.textContent = messaggio;
  }, 100);
}
