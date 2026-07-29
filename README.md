# Mei Ling Codec

Codec locale conversazionale per Miura, con interfaccia minimale ispirata al primo MGS e personaggi manga animabili.

## Stack attivo

- Cervello locale: `Qwen3-4B-Instruct-2507` in LM Studio (`mei-ling-qwen3-4b-instruct`).
- Voce: Kokoro 82M, identità femminile italiana `if_sara`, CPU, italiano e inglese.
- Ascolto: Faster Whisper Small locale su CPU con rilevamento vocale nel browser.
- UI: chiamata reale senza hold-to-speak, suono Codec, espressioni di Mei Ling e layout responsive.
- Memoria: SQLite locale in `data/mei-ling.sqlite`, con conversazioni e istruzioni persistenti.
- Daily Intel: lettura Internet pubblica, RSS/Atom, ranking sui gusti di Miura, inbox e chiamate Codec in arrivo.

## Avvio

1. Creare la configurazione locale (resta esclusa da Git):

```powershell
Copy-Item .env.example .env.local
```

2. Avviare il server locale di LM Studio e caricare l'istanza `mei-ling-qwen3-4b-instruct`.
3. Dalla cartella del progetto eseguire:

```powershell
npm start
```

4. Aprire `http://127.0.0.1:5178` e autorizzare il microfono.

`start.mjs` avvia insieme Codec (`5178`), Kokoro (`5179`) e Whisper (`5180`). Voce e ascolto vengono preriscaldati in background.

Il progetto usa il modello locale di LM Studio e non richiede una chiave OpenAI.

## Cervello proattivo

- Legge soltanto fonti pubbliche con richieste `GET`: nessun login, cookie, credenziale o upload.
- Usa 4 feed ufficiali e 7 ricerche mirate; blocca URL locali/privati, redirect pericolosi, risposte troppo grandi e formati non RSS/Atom.
- Esegue una scansione ogni 4 ore mentre il Codec è acceso.
- Prepara al massimo un avviso normale al giorno, con quiet hours `22:00–08:00` Europe/Rome.
- Ogni briefing conserva titolo, fonte, URL, data, motivazione editoriale e missione di registrazione.
- Se la pagina è aperta, un briefing non letto avvia una vera chiamata in arrivo; con permesso già concesso può mostrare una notifica locale.
- Le istruzioni esplicitamente persistenti, come “ricordati” o “da ora in poi”, vengono salvate e reinserite nelle conversazioni future.

Scansione manuale locale:

```powershell
Invoke-RestMethod -Method Post -ContentType 'application/json' `
  -Body '{"force":true}' http://127.0.0.1:5178/api/brain/run
```

Stato e prove:

```powershell
Invoke-RestMethod http://127.0.0.1:5178/api/brain/status
Invoke-RestMethod http://127.0.0.1:5178/api/sources
npm run verify
```

## Approvazioni e limiti

Ricerca pubblica, ranking, memoria, bozze e notifiche locali sono autonome. Pubblicare o programmare contenuti, contattare persone, spendere denaro, caricare file personali, modificare account/sicurezza o cancellare materiale richiede un'approvazione esatta, con payload verificato, scadenza e uso singolo.

Il processo e il PC devono restare accesi per le scansioni. Il push remoto verso un telefono, l'accesso HTTPS fuori dal PC, l'avvio automatico di Windows e i collegamenti ai social/Gray Fox non sono ancora attivi. Nessuna di queste integrazioni viene simulata.
