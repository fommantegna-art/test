// Logica pura: parsing del cartellino e calcolo straordinari/recuperi/pagamenti.
// Usabile sia nel browser (window.Calc) sia in Node (module.exports).
(function (root) {
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const DAY_RE = /^(\d{1,2})\s+(lun|mar|mer|gio|ven|sab|dom)\b/i;
  const TIME_RE = /\b(\d{1,2}):(\d{2})\b/g;
  const DAY_MS = 86400000;

  function toMin(hhmm) {
    const m = /^(-?)(\d{1,3}):(\d{2})$/.exec(String(hhmm).trim());
    if (!m) return null;
    const v = Number(m[2]) * 60 + Number(m[3]);
    return m[1] ? -v : v;
  }

  function fmt(min) {
    const sign = min < 0 ? '-' : '';
    const a = Math.abs(Math.round(min));
    return sign + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0');
  }

  function iso(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function addDays(s, n) {
    return new Date(parseDate(s) + n * DAY_MS).toISOString().slice(0, 10);
  }

  // lines: [{text, items:[{str, x}]}] in ordine di lettura.
  // Restituisce {year, month, days:[{date, weekday, tot (minuti|null), stamps:[]}]}
  function parseCartellino(lines) {
    let year = null, month = null, totX = null, name = null, company = null;
    lines.forEach((ln, i) => {
      if (name === null && ln.items) {
        // Il nome è la cella a sinistra dell'etichetta MATRICOLA; la riga sotto a sinistra è l'azienda.
        const k = ln.items.findIndex(it => it.str.trim() === 'MATRICOLA');
        if (k > 0) {
          name = ln.items.slice(0, k).map(it => it.str.trim()).join(' ').replace(/\s+/g, ' ');
          for (const next of lines.slice(i + 1, i + 4)) {
            const lab = next.items.findIndex(it => /^CODICE EXPORT$/.test(it.str.trim()));
            if (lab > 0) { company = next.items.slice(0, lab).map(it => it.str.trim()).join(' '); break; }
          }
        }
      }
    });
    for (const ln of lines) {
      const mm = new RegExp('\\b(' + MONTHS.join('|') + ')\\s+(\\d{4})\\b', 'i').exec(ln.text);
      if (mm && month === null) { month = MONTHS.indexOf(mm[1].toLowerCase()) + 1; year = Number(mm[2]); }
      if (totX === null && /\bGIORNO\b/.test(ln.text) && ln.items) {
        const tots = ln.items.filter(i => i.str.trim() === 'TOT').map(i => i.right);
        if (tots.length) totX = Math.min(...tots);
      }
    }
    const days = [];
    for (const ln of lines) {
      const text = ln.text.trim();
      const dm = DAY_RE.exec(text);
      if (!dm) continue;
      const rest = text.slice(dm[0].length);
      const times = [...rest.matchAll(TIME_RE)].map(t => t[0]);
      let tot = null, stamps = times;
      if (totX !== null && ln.items) {
        // Colonna TOT individuata per posizione: la cella allineata a destra termina vicino all'header.
        const cell = ln.items.find(i => /^\d{1,2}:\d{2}$/.test(i.str.trim()) && Math.abs(i.right - totX) < 25);
        if (cell) {
          tot = toMin(cell.str.trim());
          const idx = times.lastIndexOf(cell.str.trim());
          stamps = times.slice(0, idx);
        }
      } else if (times.length % 2 === 1 && times.length >= 3) {
        // Fallback testuale: coppie di timbrature + totale finale.
        tot = toMin(times[times.length - 1]);
        stamps = times.slice(0, -1);
      }
      days.push({ day: Number(dm[1]), weekday: dm[2].toLowerCase(), tot, stamps });
    }
    return {
      year, month, name, company,
      days: days.map(d => ({ date: year ? iso(year, month, d.day) : null, weekday: d.weekday, tot: d.tot, stamps: d.stamps })),
    };
  }

  // Un PDF può contenere più cartellini (uno per dipendente): divide le righe a ogni intestazione.
  function parseAll(lines) {
    const blocks = [];
    for (const ln of lines) {
      if (/^Cartellino presenze\b/i.test(ln.text.trim()) || !blocks.length) blocks.push([]);
      blocks[blocks.length - 1].push(ln);
    }
    const out = [];
    for (const b of blocks) {
      const r = parseCartellino(b);
      if (!r.days.length) continue;
      const prev = out[out.length - 1];
      if (!r.name && prev) { r.name = prev.name; r.company = prev.company; } // pagina di continuazione
      if (!r.year && prev) { r.year = prev.year; r.month = prev.month; r.days = parseCartellino([...b, { text: MONTHS[prev.month - 1] + ' ' + prev.year, items: [] }]).days; }
      out.push(r);
    }
    return out;
  }

  // days: {date: minuti lavorati}; recoveries: [{date, minutes, note}]
  // settings: {baseMin, windowDays, autoDeficit}
  function compute(days, recoveries, settings, todayIso) {
    const base = settings.baseMin, win = settings.windowDays;
    const bank = []; // voci di straordinario
    const events = [];
    for (const [date, tot] of Object.entries(days)) {
      if (tot == null) continue;
      if (tot > base) events.push({ date, kind: 'ot', minutes: tot - base });
      else if (settings.autoDeficit && tot > 0 && tot < base) {
        events.push({ date, kind: 'rec', minutes: base - tot, note: 'Giornata sotto base (' + fmt(tot) + ')', auto: true });
      }
    }
    recoveries.forEach((r, i) => events.push({ date: r.date, kind: 'rec', minutes: r.minutes, note: r.note || 'Recupero', idx: i }));
    // A parità di data lo straordinario entra prima del recupero.
    events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'ot' ? -1 : 1));

    const recLog = [];
    for (const ev of events) {
      if (ev.kind === 'ot') {
        bank.push({ date: ev.date, minutes: ev.minutes, remaining: ev.minutes, deadline: addDays(ev.date, win), uses: [] });
        continue;
      }
      let need = ev.minutes;
      const used = [];
      for (const b of bank) {
        if (need <= 0) break;
        if (b.remaining <= 0 || b.deadline < ev.date || b.date > ev.date) continue; // scaduta o futura
        const take = Math.min(need, b.remaining);
        b.remaining -= take; need -= take;
        b.uses.push({ date: ev.date, minutes: take });
        used.push({ from: b.date, minutes: take });
      }
      recLog.push({ ...ev, covered: ev.minutes - need, uncovered: need, used });
    }

    const open = [], paid = [];
    for (const b of bank) {
      if (b.remaining <= 0) b.status = 'recuperate';
      else if (b.deadline < todayIso) { b.status = 'pagate'; paid.push(b); }
      else {
        b.status = 'aperte';
        b.daysLeft = Math.round((parseDate(b.deadline) - parseDate(todayIso)) / DAY_MS);
        open.push(b);
      }
    }
    const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
    const paidByMonth = {};
    for (const b of paid) {
      const key = b.deadline.slice(0, 7);
      paidByMonth[key] = (paidByMonth[key] || 0) + b.remaining;
    }
    return {
      bank, recLog, paidByMonth,
      totals: {
        overtime: sum(bank, 'minutes'),
        recovered: bank.reduce((s, b) => s + b.minutes - (b.status === 'recuperate' ? 0 : b.remaining), 0),
        open: sum(open, 'remaining'),
        paid: sum(paid, 'remaining'),
        uncovered: sum(recLog, 'uncovered'),
      },
    };
  }

  // Raggruppa i frammenti di testo di un documento pdf.js in righe ordinate.
  async function pdfLines(pdf) {
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const rows = [];
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) < 3);
        if (!row) rows.push(row = { y, items: [] });
        const right = x + (it.width || 0);
        row.items.push({ str: it.str, left: x, right });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.left - b.left);
        lines.push({ text: r.items.map(i => i.str.trim()).join(' '), items: r.items });
      }
    }
    return lines;
  }

  const api = { parseCartellino, parseAll, pdfLines, compute, toMin, fmt, addDays, MONTHS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
