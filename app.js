(function () {
  const { parseCartellino, pdfLines, compute, toMin, fmt, MONTHS } = window.Calc;
  const KEY = 'straordinari-v1';
  const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const $ = id => document.getElementById(id);

  // state.days: {date: {tot, stamps, edited}}
  let state = { days: {}, recoveries: [], settings: { base: '8:30', weeks: 8, autoDeficit: true } };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) state = { ...state, ...s }; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const dmy = s => s.split('-').reverse().join('/');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  $('today').value = todayIso();
  $('recDate').value = todayIso();
  $('base').value = state.settings.base;
  $('weeks').value = state.settings.weeks;
  $('autoDeficit').checked = state.settings.autoDeficit;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  async function importPdfs(files) {
    const out = [];
    for (const f of files) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        const r = parseCartellino(await pdfLines(pdf));
        if (!r.year || !r.days.length) throw new Error('formato non riconosciuto');
        let n = 0, incomplete = 0;
        for (const d of r.days) {
          const prev = state.days[d.date];
          if (prev && prev.edited && d.tot == null) continue; // non sovrascrivere correzioni manuali
          state.days[d.date] = { tot: d.tot, stamps: d.stamps };
          if (d.tot != null) n++; else if (d.stamps.length) incomplete++;
        }
        out.push(`✓ ${f.name}: ${MONTHS[r.month - 1]} ${r.year}, ${n} giornate con TOT` +
          (incomplete ? `, <span class="neg">${incomplete} con timbrature incomplete</span>` : ''));
      } catch (e) {
        out.push(`<span class="neg">✗ ${esc(f.name)}: ${esc(e.message)}</span>`);
      }
    }
    $('msg').innerHTML = out.join('<br>');
    save(); render();
  }

  function settings() {
    const base = toMin($('base').value);
    return { baseMin: base == null ? 510 : base, windowDays: (Number($('weeks').value) || 8) * 7, autoDeficit: $('autoDeficit').checked };
  }

  function render() {
    const st = settings();
    const today = $('today').value || todayIso();
    const days = Object.fromEntries(Object.entries(state.days).map(([k, v]) => [k, v.tot]));
    const res = compute(days, state.recoveries, st, today);
    const t = res.totals;
    const soon = res.bank.filter(b => b.status === 'aperte' && b.daysLeft <= 7).reduce((s, b) => s + b.remaining, 0);

    $('stats').innerHTML = [
      ['Straordinari totali', fmt(t.overtime), ''],
      ['Recuperate', fmt(t.recovered), 'pos'],
      ['Da recuperare', fmt(t.open), ''],
      ['Scadono entro 7 gg', fmt(soon), soon ? 'neg' : ''],
      ['Pagate', fmt(t.paid), ''],
    ].concat(t.uncovered ? [['Recuperi non coperti', fmt(t.uncovered), 'neg']] : [])
      .map(([l, v, c]) => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`).join('');

    // Banca ore
    const badge = b => {
      if (b.status === 'recuperate') return '<span class="badge b-ok">recuperate</span>';
      if (b.status === 'pagate') return '<span class="badge b-paid">da pagare</span>';
      const cls = b.daysLeft <= 7 ? 'b-bad' : b.daysLeft <= 14 ? 'b-warn' : 'b-open';
      return `<span class="badge ${cls}">${b.daysLeft} gg</span>`;
    };
    $('bank').innerHTML = res.bank.length ? '<tr><th>Giorno</th><th class="num">Extra</th><th class="num">Residuo</th><th>Scadenza</th><th>Stato</th></tr>' +
      res.bank.slice().reverse().map(b => `<tr><td>${dmy(b.date)}</td><td class="num">${fmt(b.minutes)}</td>` +
        `<td class="num">${fmt(b.remaining)}</td><td>${dmy(b.deadline)}</td><td>${badge(b)}</td></tr>`).join('')
      : '<tr><td class="muted">Nessuno straordinario: importa un cartellino.</td></tr>';

    // Recuperi (manuali + automatici)
    $('recs').innerHTML = res.recLog.length ? '<tr><th>Data</th><th class="num">Ore</th><th>Nota</th><th>Coperto da</th><th></th></tr>' +
      res.recLog.slice().reverse().map(r => `<tr><td>${dmy(r.date)}</td><td class="num">${fmt(r.minutes)}</td>` +
        `<td>${esc(r.note)}</td><td>${r.used.map(u => dmy(u.from).slice(0, 5) + ' (' + fmt(u.minutes) + ')').join(', ') || '—'}` +
        `${r.uncovered ? ` <span class="neg">scoperto ${fmt(r.uncovered)}</span>` : ''}</td>` +
        `<td>${r.auto ? '<span class="muted">auto</span>' : `<button class="del" data-rec="${r.idx}">✕</button>`}</td></tr>`).join('')
      : '<tr><td class="muted">Nessun recupero registrato.</td></tr>';

    const paid = Object.entries(res.paidByMonth).sort();
    $('paid').innerHTML = paid.length ? '<tr><th>Mese di scadenza</th><th class="num">Ore</th></tr>' +
      paid.map(([m, v]) => { const [y, mo] = m.split('-'); return `<tr><td>${MONTHS[mo - 1]} ${y}</td><td class="num">${fmt(v)}</td></tr>`; }).join('')
      : '<tr><td class="muted">Nessuna ora scaduta finora.</td></tr>';

    // Giornate
    const dates = Object.keys(state.days).sort().reverse();
    $('days').innerHTML = dates.length ? '<tr><th>Data</th><th>Timbrature</th><th class="num">TOT</th><th class="num">Diff. base</th></tr>' +
      dates.map(d => {
        const v = state.days[d];
        const wd = WD[new Date(d + 'T12:00').getDay()];
        const diff = v.tot == null ? '' : v.tot - st.baseMin;
        const incomplete = v.tot == null && v.stamps && v.stamps.length;
        return `<tr class="${wd === 'sab' || wd === 'dom' ? 'weekend' : ''}"><td>${wd} ${dmy(d)}</td>` +
          `<td>${(v.stamps || []).join(' · ')}${incomplete ? ' <span class="badge b-warn">incompleta</span>' : ''}</td>` +
          `<td class="num"><input class="tot" data-day="${d}" value="${v.tot == null ? '' : fmt(v.tot)}" placeholder="—"></td>` +
          `<td class="num ${diff > 0 ? 'pos' : diff < 0 && v.tot > 0 ? 'neg' : 'muted'}">${diff === '' ? '' : (diff > 0 ? '+' : '') + fmt(diff)}</td></tr>`;
      }).join('')
      : '<tr><td class="muted">Nessuna giornata.</td></tr>';
  }

  // Eventi
  const drop = $('drop');
  $('file').addEventListener('change', e => { importPdfs([...e.target.files]); e.target.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); importPdfs([...e.dataTransfer.files]); });

  ['base', 'weeks', 'autoDeficit', 'today'].forEach(id => $(id).addEventListener('change', () => {
    state.settings = { base: $('base').value, weeks: Number($('weeks').value) || 8, autoDeficit: $('autoDeficit').checked };
    save(); render();
  }));

  $('recAdd').addEventListener('click', () => {
    const m = toMin($('recHours').value);
    if (!$('recDate').value || !m || m <= 0) { alert('Inserisci data e ore nel formato hh:mm'); return; }
    state.recoveries.push({ date: $('recDate').value, minutes: m, note: $('recNote').value.trim() });
    $('recHours').value = ''; $('recNote').value = '';
    save(); render();
  });
  $('recs').addEventListener('click', e => {
    const i = e.target.dataset.rec;
    if (i != null) { state.recoveries.splice(Number(i), 1); save(); render(); }
  });
  $('days').addEventListener('change', e => {
    const d = e.target.dataset.day;
    if (!d) return;
    const raw = e.target.value.trim();
    const m = raw === '' ? null : toMin(raw);
    if (raw !== '' && m == null) { alert('Formato hh:mm'); render(); return; }
    state.days[d] = { ...state.days[d], tot: m, edited: true };
    save(); render();
  });

  $('export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = 'straordinari-backup.json';
    a.click();
  });
  $('importJson').addEventListener('change', async e => {
    try { state = { ...state, ...JSON.parse(await e.target.files[0].text()) }; save(); location.reload(); }
    catch (err) { alert('Backup non valido'); }
  });
  $('reset').addEventListener('click', () => {
    if (confirm('Cancellare tutte le giornate e i recuperi?')) { state.days = {}; state.recoveries = []; save(); render(); }
  });

  render();
})();
