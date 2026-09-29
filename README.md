# Calcolo Straordinari

Webapp statica (nessun server) che legge i PDF "Cartellino presenze" di più dipendenti: estrae il **nome** e la colonna **TOT** e calcola gli straordinari per ciascuno.

## Regole
- **Straordinario** = ore del giorno (TOT) oltre la base giornaliera (default **8:30**).
- Ogni straordinario va in una banca ore e si può **recuperare entro 8 settimane** (56 giorni, configurabile).
- I recuperi consumano prima le ore più vecchie (FIFO). Contano come recupero:
  - i recuperi inseriti a mano (permessi, uscite anticipate…);
  - opzionalmente le giornate lavorate sotto la base (es. 7:30 → 1:00 recuperata).
- Le ore non recuperate entro la scadenza passano in **"da pagare"**, raggruppate per mese di scadenza.
- Lo stato si aggiorna automaticamente in base alla data odierna (o alla "data di riferimento").

## Dipendenti
- Ogni cartellino viene assegnato al dipendente indicato nel PDF (il nome accanto a MATRICOLA); caricando altri mesi dello stesso dipendente le giornate si sommano.
- Un PDF con più cartellini (uno per dipendente) viene diviso automaticamente.
- La tabella "Dipendenti" riassume per ognuno straordinari, recuperate, da recuperare, in scadenza, pagate e prossima scadenza; cliccando una riga si apre il dettaglio.

## Uso
Apri `index.html` nel browser (o servila con `python3 -m http.server`), trascina uno o più cartellini PDF.
Le giornate con timbrature incomplete sono segnalate e il TOT si può correggere a mano.
I dati restano nel browser (localStorage); usa "Esporta backup" per salvarli.
