# Calcolo Straordinari

Webapp statica (nessun server) che legge il PDF "Cartellino presenze" e calcola gli straordinari dalla colonna **TOT**.

## Regole
- **Straordinario** = ore del giorno (TOT) oltre la base giornaliera (default **8:30**).
- Ogni straordinario va in una banca ore e si può **recuperare entro 8 settimane** (56 giorni, configurabile).
- I recuperi consumano prima le ore più vecchie (FIFO). Contano come recupero:
  - i recuperi inseriti a mano (permessi, uscite anticipate…);
  - opzionalmente le giornate lavorate sotto la base (es. 7:30 → 1:00 recuperata).
- Le ore non recuperate entro la scadenza passano in **"da pagare"**, raggruppate per mese di scadenza.
- Lo stato si aggiorna automaticamente in base alla data odierna (o alla "data di riferimento").

## Uso
Apri `index.html` nel browser (o servila con `python3 -m http.server`), trascina uno o più cartellini PDF.
Le giornate con timbrature incomplete sono segnalate e il TOT si può correggere a mano.
I dati restano nel browser (localStorage); usa "Esporta backup" per salvarli.
