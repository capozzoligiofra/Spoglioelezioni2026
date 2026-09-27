# Spoglio elezioni 2026

Sito per seguire **in diretta** lo spoglio delle elezioni studentesche della scuola: voti di lista,
affluenza, preferenze e seggi, aggiornati sezione per sezione mentre gli scrutatori contano le schede.

- **Pagina pubblica** (`index.html`) – chiunque la apre dal telefono vede i risultati, che si aggiornano da
  soli ogni 30 secondi. Mostra anche come vengono assegnati i seggi (metodo D'Hondt) e i risultati di ogni sezione.
- **Area scrutatori** (`admin.html`) – chi fa lo spoglio inserisce i numeri di ogni sezione, il sito controlla che
  tornino e con un clic li pubblica.
- **Demo** – aggiungendo `?demo` all'indirizzo, la pagina pubblica simula uno spoglio con dati inventati
  ([prova](https://capozzoligiofra.github.io/Spoglioelezioni2026/?demo)) e l'area scrutatori permette di provare
  l'inserimento senza pubblicare nulla ([prova](https://capozzoligiofra.github.io/Spoglioelezioni2026/admin.html?demo)).

È gratuito, non ha bisogno di un server né di un database, funziona su telefoni vecchi e con connessioni lente,
ha il tema scuro ed è pensato per essere accessibile (lettori di schermo, tastiera, colori leggibili anche da chi
ha un daltonismo).

## Come funziona

```
 Scrutatori ── area scrutatori ──▶ data/risultati.json nel repository GitHub
                                     (ogni pubblicazione è un commit)
                                                 │
                                                 ▼  GitHub Pages
                                     Pagina pubblica: rilegge i dati ogni 30 s
```

Ogni pubblicazione diventa un commit del repository, quindi resta uno **storico pubblico** di tutte le modifiche
ai risultati (c'è un collegamento in fondo alla pagina pubblica): chiunque può verificare cosa è cambiato e quando.

## Messa in funzione

### 1. Pubblica il sito con GitHub Pages

1. Il codice deve stare sul branch principale del repository (di solito `main`): il sito viene pubblicato da lì.
2. Su GitHub apri **Settings → Pages** e in «Build and deployment» scegli **Source: GitHub Actions**.
3. Apri la scheda **Actions**, scegli **Pubblica il sito** e premi **Run workflow** (dalle volte successive parte
   da solo a ogni modifica, comprese le pubblicazioni dei risultati).
4. Dopo un paio di minuti il sito è online, per questo repository all'indirizzo
   `https://capozzoligiofra.github.io/Spoglioelezioni2026/`.

GitHub Pages è gratuito per i repository pubblici. Il sito si pubblica con un workflow di GitHub Actions
(`.github/workflows/pubblica-sito.yml`) e non con «Deploy from a branch», perché quest'ultimo ha un limite di
circa 10 aggiornamenti all'ora: troppo pochi durante lo spoglio.

### 2. Inserisci i dati delle elezioni

Tutto si configura nel file [`data/elezioni.json`](data/elezioni.json) (su GitHub: apri il file e premi la
matita per modificarlo). Quello che trovi è un **esempio inventato**: sostituisci scuola, sezioni, liste e
candidati con quelli veri e **togli la riga `"esempio": true`**.

```json
{
  "scuola": "Liceo «Nome della scuola»",
  "titolo": "Elezioni degli studenti 2026/27",
  "dataElezioni": "2026-10-22",
  "repository": "capozzoligiofra/Spoglioelezioni2026",
  "aggiornamentoSecondi": 30,
  "sezioni": [
    { "id": "1A", "aventiDiritto": 24 },
    { "id": "1B", "aventiDiritto": 22 }
  ],
  "elezioni": [
    {
      "id": "consiglio-istituto",
      "nome": "Consiglio d'Istituto",
      "seggi": 4,
      "maxPreferenze": 2,
      "liste": [
        {
          "numero": "I",
          "nome": "Motto della lista",
          "candidati": [
            { "nome": "Nome Cognome", "classe": "5A" },
            { "nome": "Altro Nome", "classe": "4C" }
          ]
        }
      ]
    }
  ]
}
```

| Campo                      | Cosa scrivere                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `sezioni`                  | Una voce per ogni seggio (di solito una per classe). `aventiDiritto` è il numero di iscritti che votano. |
| `elezioni[].id`            | Un nome corto con lettere minuscole e trattini, es. `consiglio-istituto` o `consulta`.                   |
| `elezioni[].seggi`         | Quanti rappresentanti si eleggono.                                                                       |
| `elezioni[].maxPreferenze` | Quante preferenze si possono dare su una scheda (0 se non si danno preferenze).                          |
| `liste[].numero`           | Il numero romano della lista, nell'ordine di presentazione (`"I"`, `"II"`, …).                           |
| `liste[].candidati`        | I candidati **nell'ordine in cui compaiono sulla scheda** (conta in caso di parità di preferenze).       |
| `aggiornamentoSecondi`     | Ogni quanti secondi la pagina pubblica ricontrolla i dati.                                               |

Di solito per il Consiglio d'Istituto si eleggono 4 studenti con 2 preferenze (3 studenti e 1 preferenza nelle
scuole fino a 500 iscritti) e per la Consulta provinciale 2 studenti con 1 preferenza: **controlla sempre la
circolare della tua scuola**. Puoi togliere le elezioni che non ti servono o aggiungerne altre.

Se sbagli qualcosa (una virgola di troppo, una lista ripetuta…) la pagina mostra l'errore e la verifica
automatica su GitHub (scheda **Actions**) diventa rossa.

### 3. Crea il token per pubblicare i risultati

Per pubblicare, l'area scrutatori ha bisogno di un **token** di GitHub, una specie di password limitata a
questo repository:

1. Apri <https://github.com/settings/personal-access-tokens/new> con l'account proprietario del repository.
2. Dagli un nome (es. «Spoglio») e una **scadenza** subito dopo lo spoglio.
3. In **Repository access** scegli **Only select repositories** e seleziona solo questo repository.
4. In **Permissions**, alla voce **Contents**, scegli **Read and write**.
5. Premi **Generate token**, copialo e incollalo nell'area scrutatori (riquadro «Collegamento a GitHub»).

Il token resta salvato solo nel browser di quel dispositivo. Chi ce l'ha può modificare i risultati: non mandarlo
in chat, usalo su dispositivi fidati e a fine spoglio premi «Dimentica il token» o cancellalo da GitHub.
Se altri scrutatori hanno un account GitHub puoi aggiungerli in **Settings → Collaborators**: così ognuno crea il
proprio token.

### 4. Fai una prova

Prima del giorno delle elezioni apri l'area scrutatori, collegala con il token, inserisci qualche numero finto
in una sezione e premi **Pubblica**: entro un paio di minuti deve comparire sulla pagina pubblica. Poi, in fondo
all'area scrutatori, usa **Azzera tutti i risultati**.

## Il giorno dello spoglio

1. Apri una sezione, scegli **Scrutinio in corso** e inserisci votanti, schede bianche e nulle, voti di lista e
   preferenze (Invio passa al campo successivo). I numeri restano salvati sul dispositivo anche se chiudi la
   pagina.
2. Il riquadro **Controlli** segnala i numeri che non tornano: voti di lista + bianche + nulle diversi dai
   votanti, più votanti che aventi diritto, troppe preferenze.
3. Quando la sezione è contata scegli **Scrutinata** e premi **Pubblica**. Si possono pubblicare più sezioni
   insieme; più scrutatori possono pubblicare contemporaneamente senza cancellarsi i dati a vicenda.
4. Con **Comunicazione sul sito** puoi mostrare un avviso a tutti (es. «Lo spoglio riprende alle 14»).
5. Dopo la proclamazione degli eletti da parte della Commissione elettorale spunta **Risultati definitivi** e
   pubblica.

Senza connessione o senza token puoi comunque inserire i dati e premere **Scarica il file**: poi carichi
`risultati.json` nella cartella `data/` del repository (su GitHub: **Add file → Upload files**).

## Come vengono calcolati i risultati

- **Voti validi**: la somma dei voti di lista. Le percentuali delle liste sono calcolate sui voti validi.
- **Affluenza**: votanti diviso aventi diritto, nelle sezioni che hanno già dati.
- **Seggi**: metodo D'Hondt. I voti di ogni lista si dividono per 1, 2, 3… e i seggi vanno ai quozienti più alti.
  A parità di quoziente vince la lista con più voti; se anche i voti sono uguali serve un sorteggio (il sito lo
  segnala). Una lista non può avere più seggi dei suoi candidati.
- **Eletti**: in ogni lista, i candidati con più preferenze; a parità, chi viene prima nell'ordine di lista.
- Le sezioni «in corso» sono già conteggiate come dati parziali: finché lo spoglio non è finito i seggi sono una
  proiezione.

Il sito ha valore informativo: fanno fede i verbali della Commissione elettorale.

## Privacy

Sul sito compaiono nomi di studenti, spesso minorenni: prima di pubblicarlo chiedi il via libera alla
Commissione elettorale o alla dirigenza. Le pagine chiedono ai motori di ricerca di non indicizzarle
(`noindex`). Se preferite, nei candidati potete scrivere solo nome e iniziale del cognome e lasciare vuota la
classe. Il sito non usa cookie, non traccia i visitatori e non carica nulla da altri siti.

## Per chi sviluppa

Nessuna dipendenza e nessuna compilazione: HTML, CSS e JavaScript normali.

```sh
npm start   # sito su http://localhost:8080 (oppure: python3 -m http.server 8080)
npm test    # test dei calcoli e dei file di dati (serve Node.js 20 o più recente)
```

| File                  | Cosa contiene                                                              |
| --------------------- | -------------------------------------------------------------------------- |
| `index.html`          | Pagina pubblica                                                            |
| `admin.html`          | Area scrutatori                                                            |
| `data/elezioni.json`  | Configurazione: scuola, sezioni, liste, candidati                          |
| `data/risultati.json` | Risultati pubblicati (lo scrive l'area scrutatori)                         |
| `data/demo/`          | Dati inventati per la demo                                                 |
| `js/calcoli.js`       | Somme, percentuali, metodo D'Hondt, eletti, controlli (testato in `test/`) |
| `js/pubblico.js`      | Disegno della pagina pubblica e aggiornamento automatico                   |
| `js/admin.js`         | Area scrutatori: moduli, bozze, pubblicazione                              |
| `js/github.js`        | Lettura e scrittura di `data/risultati.json` con le API di GitHub          |
| `css/stile.css`       | Stile, tema chiaro e scuro, colori delle liste                             |
