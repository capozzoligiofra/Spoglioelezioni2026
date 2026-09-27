/**
 * Lettura e scrittura del file dei risultati nel repository GitHub, con le
 * API di GitHub e un token personale ("fine-grained") dello scrutatore.
 * Ogni pubblicazione diventa un commit: resta uno storico pubblico di
 * tutte le modifiche.
 */

const API = 'https://api.github.com';

export class ErroreGitHub extends Error {
  constructor(messaggio, stato) {
    super(messaggio);
    this.stato = stato;
  }
}

function spiegaErrore(stato, dettaglio) {
  if (stato === 401) return 'Token non valido o scaduto: creane uno nuovo.';
  if (stato === 403) {
    return `GitHub ha rifiutato l'operazione: il token deve avere il permesso «Contents: Read and write» su questo repository. (${dettaglio})`;
  }
  if (stato === 404)
    return 'Repository, branch o file non trovati, oppure il token non ha accesso a questo repository.';
  if (stato === 409) return 'Il file è stato modificato da qualcun altro nel frattempo.';
  if (stato === 422) return `GitHub non ha accettato la richiesta: ${dettaglio}`;
  return `Errore di GitHub (${stato})${dettaglio ? `: ${dettaglio}` : ''}.`;
}

async function chiama(url, token, { metodo = 'GET', corpo } = {}) {
  const intestazioni = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (corpo) intestazioni['Content-Type'] = 'application/json';
  let risposta;
  try {
    risposta = await fetch(url, {
      method: metodo,
      headers: intestazioni,
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ErroreGitHub('Impossibile contattare GitHub: controlla la connessione a internet.', 0);
  }
  if (risposta.ok) return risposta.json();
  let dettaglio = '';
  try {
    dettaglio = (await risposta.json()).message ?? '';
  } catch {
    // risposta senza JSON: basta il codice di errore
  }
  throw new ErroreGitHub(spiegaErrore(risposta.status, dettaglio), risposta.status);
}

// Il contenuto dei file viaggia in base64; il testo è UTF-8 (lettere accentate).
function inBase64(testo) {
  const byte = new TextEncoder().encode(testo);
  let binario = '';
  for (let i = 0; i < byte.length; i += 0x8000) binario += String.fromCharCode(...byte.subarray(i, i + 0x8000));
  return btoa(binario);
}

function daBase64(base64) {
  const binario = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
}

export class RepositoryGitHub {
  /**
   * @param {{proprietario: string, nome: string, branch?: string, percorso: string, token: string}} opzioni
   * Se branch è vuoto si usa il branch principale del repository.
   */
  constructor({ proprietario, nome, branch, percorso, token }) {
    this.proprietario = proprietario;
    this.nome = nome;
    this.branch = branch || '';
    this.percorso = percorso;
    this.token = token;
  }

  get nomeCompleto() {
    return `${this.proprietario}/${this.nome}`;
  }

  get indirizzo() {
    return `${API}/repos/${encodeURIComponent(this.proprietario)}/${encodeURIComponent(this.nome)}`;
  }

  get indirizzoFile() {
    return `${this.indirizzo}/contents/${this.percorso.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Controlla token e repository; se il branch non è indicato usa quello principale. */
  async verifica() {
    const repository = await chiama(this.indirizzo, this.token);
    if (!this.branch) this.branch = repository.default_branch;
    let utente = null;
    try {
      utente = (await chiama(`${API}/user`, this.token)).login;
    } catch {
      // Il nome utente serve solo da mostrare: se non arriva pazienza.
    }
    return { utente, puoiScrivere: repository.permissions?.push ?? null };
  }

  /** @returns {Promise<{testo: string|null, sha: string|null}>} testo null se il file non esiste */
  async leggi() {
    try {
      const file = await chiama(`${this.indirizzoFile}?ref=${encodeURIComponent(this.branch)}`, this.token);
      return { testo: daBase64(file.content), sha: file.sha };
    } catch (errore) {
      if (errore.stato === 404) return { testo: null, sha: null };
      throw errore;
    }
  }

  /** Scrive il file con un commit. sha è quello letto prima: se il file è cambiato GitHub rifiuta (409). */
  async scrivi(testo, sha, messaggio) {
    const corpo = { message: messaggio, content: inBase64(testo), branch: this.branch };
    if (sha) corpo.sha = sha;
    const risposta = await chiama(this.indirizzoFile, this.token, { metodo: 'PUT', corpo });
    return { sha: risposta.content?.sha ?? null };
  }
}
