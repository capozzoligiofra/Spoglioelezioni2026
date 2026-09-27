/** Formattazione di numeri, percentuali e orari all'italiana (fuso di Roma). */

const FUSO_ORARIO = 'Europe/Rome';

const formatoNumero = new Intl.NumberFormat('it-IT');
const formatoPercentuale = new Intl.NumberFormat('it-IT', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const formatoDecimale = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const formatoOra = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: FUSO_ORARIO });
const formatoGiornoBreve = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', timeZone: FUSO_ORARIO });
const formatoGiorno = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: FUSO_ORARIO,
});

/** 1234 → "1.234" */
export const numero = (n) => formatoNumero.format(n);

/** 0.4512 → "45,1%" (null → "—") */
export const percentuale = (x) => (x === null || !Number.isFinite(x) ? '—' : formatoPercentuale.format(x));

/** 81.666… → "81,67" */
export const decimale = (x) => formatoDecimale.format(x);

/** "2026-10-22T09:41:00Z" → "11:41" */
export const ora = (iso) => (iso ? formatoOra.format(new Date(iso)) : '—');

/** "2026-10-22T09:41:00Z" → "22 ottobre" */
export const giornoBreve = (iso) => (iso ? formatoGiornoBreve.format(new Date(iso)) : '—');

/** "alle 11:41" se è oggi, altrimenti "il 22 ottobre alle 11:41" */
export function quando(iso) {
  const giorno = giornoBreve(iso);
  const oggi = giornoBreve(new Date().toISOString());
  return giorno === oggi ? `alle ${ora(iso)}` : `il ${giorno} alle ${ora(iso)}`;
}

/** "2026-10-22" → "giovedì 22 ottobre 2026" */
export function giorno(dataIso) {
  const data = new Date(`${dataIso}T12:00:00Z`);
  return Number.isNaN(data.getTime()) ? dataIso : formatoGiorno.format(data);
}

/** (1, "voto", "voti") → "1 voto"; (3, …) → "3 voti" */
export const conteggio = (n, singolare, plurale) => `${numero(n)} ${n === 1 ? singolare : plurale}`;
