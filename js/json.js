/**
 * Scrive JSON leggibile: gli oggetti "semplici" (solo numeri e testi) stanno
 * su una riga, così i file di dati sono più facili da modificare e le
 * differenze tra una versione e l'altra su GitHub si leggono meglio.
 *
 *   { "id": "1A", "aventiDiritto": 24 }   invece di 4 righe
 */
export function formattaJSON(valore) {
  return `${scrivi(valore, '')}\n`;
}

const semplice = (v) => v === null || typeof v !== 'object';

function scrivi(valore, rientro) {
  if (semplice(valore)) return JSON.stringify(valore);
  const interno = `${rientro}  `;
  if (Array.isArray(valore)) {
    if (valore.length === 0) return '[]';
    if (valore.every(semplice)) return `[${valore.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `[\n${valore.map((v) => interno + scrivi(v, interno)).join(',\n')}\n${rientro}]`;
  }
  const voci = Object.entries(valore).filter(([, v]) => v !== undefined);
  if (voci.length === 0) return '{}';
  if (voci.every(([, v]) => semplice(v))) {
    return `{ ${voci.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
  }
  return `{\n${voci.map(([k, v]) => `${interno}${JSON.stringify(k)}: ${scrivi(v, interno)}`).join(',\n')}\n${rientro}}`;
}
