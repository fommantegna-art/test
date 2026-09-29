(function () {
  const { parseAll, pdfLines, compute, toMin, fmt, MONTHS } = window.Calc;
  const KEY = 'straordinari-v2';
  const WD = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const $ = id => document.getElementById(id);

  // state.employees: {chiave: {name, company, days: {date: {tot, stamps, edited}}, recoveries: []}}
  const KEY_V1 = 'straordinari-v1';
  let state = { employees: {}, selected: null, settings: { base: '8:30', weeks: 8, autoDeficit: true } };
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) state = { ...state, ...s };
    else {
      const v1 = JSON.parse(localStorage.getItem(KEY_V1)); // dati della versione a dipendente singolo
      if (v1 && v1.days && Object.keys(v1.days).length) {
        state.employees['DIPENDENTE'] = { name: 'Dipendente (dati precedenti)', company: '', days: v1.days, recoveries: v1.recoveries || [] };
        if (v1.settings) state.settings = v1.settings;
      }
    }
  } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };
  const empKey = name => (name || 'SENZA NOME').toUpperCase().replace(/\s+/g, ' ').trim();
  const cur = () => state.employees[state.selected];

  const todayIso = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const dmy = s => s.split('-').reverse().join('/');
  const monthLabel = ym => { const [y, m] = ym.split('-'); const n = MONTHS[m - 1]; return n[0].toUpperCase() + n.slice(1) + ' ' + y; };
  // Raggruppa per mese (YYYY-MM) mantenendo l'ordine degli elementi
  const groupByMonth = (items, dateOf) => {
    const g = [];
    for (const it of items) {
      const m = dateOf(it).slice(0, 7);
      if (!g.length || g[g.length - 1][0] !== m) g.push([m, []]);
      g[g.length - 1][1].push(it);
    }
    return g;
  };
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
        const found = parseAll(await pdfLines(pdf)).filter(r => r.year);
        if (!found.length) throw new Error('formato non riconosciuto');
        for (const r of found) {
          const key = empKey(r.name);
          const emp = state.employees[key] || (state.employees[key] = { name: r.name || 'Senza nome', company: r.company || '', days: {}, recoveries: [] });
          if (r.company) emp.company = r.company;
          let n = 0, incomplete = 0;
          for (const d of r.days) {
            const prev = emp.days[d.date];
            if (prev && prev.edited && d.tot == null) continue; // non sovrascrivere correzioni manuali
            emp.days[d.date] = { tot: d.tot, stamps: d.stamps };
            if (d.tot != null) n++; else if (d.stamps.length) incomplete++;
          }
          state.selected = key;
          out.push(`✓ ${esc(f.name)}: <b>${esc(emp.name)}</b>, ${MONTHS[r.month - 1]} ${r.year}, ${n} giornate con TOT` +
            (incomplete ? `, <span class="neg">${incomplete} con timbrature incomplete</span>` : ''));
        }
      } catch (e) {
        out.push(`<span class="neg">✗ ${esc(f.name)}: ${esc(e.message)}</span>`);
      }
    }
    $('msg').innerHTML = out.join('<br>');
    $('days').innerHTML = ''; // dopo un import si apre il mese più recente
    save(); render();
  }

  function settings() {
    const base = toMin($('base').value);
    return { baseMin: base == null ? 510 : base, windowDays: (Number($('weeks').value) || 8) * 7, autoDeficit: $('autoDeficit').checked };
  }

  function computeEmp(emp, st, today) {
    const days = Object.fromEntries(Object.entries(emp.days).map(([k, v]) => [k, v.tot]));
    const res = compute(days, emp.recoveries, st, today);
    const open = res.bank.filter(b => b.status === 'aperte');
    res.soon = open.filter(b => b.daysLeft <= 7).reduce((s, b) => s + b.remaining, 0);
    res.next = open.length ? open[0] : null;
    return res;
  }

  function renderOverview(st, today) {
    const keys = Object.keys(state.employees).sort((a, b) => state.employees[a].name.localeCompare(state.employees[b].name));
    if (!keys.length) { $('emps').innerHTML = '<tr><td class="muted">Nessun dipendente: importa uno o più cartellini.</td></tr>'; return; }
    const sum = { overtime: 0, recovered: 0, open: 0, soon: 0, paid: 0 };
    const rows = keys.map(k => {
      const emp = state.employees[k];
      const r = computeEmp(emp, st, today);
      for (const f of ['overtime', 'recovered', 'open', 'paid']) sum[f] += r.totals[f];
      sum.soon += r.soon;
      const months = [...new Set(Object.keys(emp.days).map(d => d.slice(0, 7)))].sort()
        .map(m => MONTHS[m.slice(5) - 1].slice(0, 3) + ' ' + m.slice(2, 4)).join(', ');
      return `<tr data-emp="${esc(k)}" class="${k === state.selected ? 'sel' : ''}"><td><b>${esc(emp.name)}</b><br><span class="muted">${esc(emp.company)}</span></td>` +
        `<td class="muted">${months}</td><td class="num">${fmt(r.totals.overtime)}</td><td class="num pos">${fmt(r.totals.recovered)}</td>` +
        `<td class="num">${fmt(r.totals.open)}</td><td class="num ${r.soon ? 'neg' : ''}">${fmt(r.soon)}</td><td class="num">${fmt(r.totals.paid)}</td>` +
        `<td>${r.next ? dmy(r.next.deadline) + ' <span class="muted">(' + fmt(r.next.remaining) + ')</span>' : '—'}</td></tr>`;
    });
    $('emps').innerHTML = '<tr><th>Dipendente</th><th>Mesi</th><th class="num">Straord.</th><th class="num">Recuperate</th>' +
      '<th class="num">Da recuperare</th><th class="num">Scad. ≤7 gg</th><th class="num">Pagate</th><th>Prossima scadenza</th></tr>' +
      rows.join('') + (keys.length > 1 ? `<tr class="total"><td>Totale (${keys.length})</td><td></td><td class="num">${fmt(sum.overtime)}</td>` +
      `<td class="num">${fmt(sum.recovered)}</td><td class="num">${fmt(sum.open)}</td><td class="num">${fmt(sum.soon)}</td><td class="num">${fmt(sum.paid)}</td><td></td></tr>` : '');
    $('empSel').innerHTML = keys.map(k => `<option value="${esc(k)}" ${k === state.selected ? 'selected' : ''}>${esc(state.employees[k].name)}</option>`).join('');
  }

  function render() {
    const st = settings();
    const today = $('today').value || todayIso();
    if (!state.employees[state.selected]) state.selected = Object.keys(state.employees)[0] || null;
    renderOverview(st, today);
    $('detail').hidden = !state.selected;
    if (!state.selected) return;
    const emp = cur();
    $('empName').textContent = emp.name;
    $('empCompany').textContent = emp.company;
    const res = computeEmp(emp, st, today);
    const t = res.totals;
    const soon = res.soon;

    $('stats').innerHTML = [
      ['Straordinari totali', fmt(t.overtime), ''],
      ['Recuperate', fmt(t.recovered), 'pos'],
      ['Da recuperare', fmt(t.open), ''],
      ['Scadono entro 7 gg', fmt(soon), soon ? 'neg' : ''],
      ['Pagate', fmt(t.paid), ''],
    ].concat(t.uncovered ? [['Recuperi non coperti', fmt(t.uncovered), 'neg']] : [])
      .map(([l, v, c]) => `<div class="stat"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`).join('');

    // Riepilogo mensile (straordinari raggruppati per mese in cui sono stati fatti)
    const byMonth = {};
    const mrow = m => byMonth[m] || (byMonth[m] = { worked: 0, days: 0, incomplete: 0, ot: 0, rec: 0, open: 0, paid: 0, soon: 0 });
    for (const [d, v] of Object.entries(emp.days)) {
      const r = mrow(d.slice(0, 7));
      if (v.tot != null) { r.worked += v.tot; if (v.tot > 0) r.days++; }
      else if (v.stamps && v.stamps.length) r.incomplete++;
    }
    for (const bk of res.bank) {
      const r = mrow(bk.date.slice(0, 7));
      r.ot += bk.minutes;
      r.rec += bk.minutes - (bk.status === 'recuperate' ? 0 : bk.remaining);
      if (bk.status === 'aperte') { r.open += bk.remaining; if (bk.daysLeft <= 7) r.soon += bk.remaining; }
      if (bk.status === 'pagate') r.paid += bk.remaining;
    }
    const monthKeys = Object.keys(byMonth).sort().reverse();
    $('months').innerHTML = monthKeys.length ? '<tr><th>Mese</th><th class="num">Giorni</th><th class="num">Ore lavorate</th><th class="num">Straord.</th>' +
      '<th class="num">Recuperate</th><th class="num">Da recuperare</th><th class="num">Pagate</th></tr>' +
      monthKeys.map(m => { const r = byMonth[m]; return `<tr><td><b>${monthLabel(m)}</b>${r.incomplete ? ` <span class="badge b-warn">${r.incomplete} incomplete</span>` : ''}</td>` +
        `<td class="num">${r.days}</td><td class="num">${fmt(r.worked)}</td><td class="num">${fmt(r.ot)}</td><td class="num pos">${fmt(r.rec)}</td>` +
        `<td class="num ${r.soon ? 'neg' : ''}">${fmt(r.open)}</td><td class="num">${fmt(r.paid)}</td></tr>`; }).join('')
      : '<tr><td class="muted">Nessun dato.</td></tr>';

    // Banca ore, divisa per mese
    const badge = b => {
      if (b.status === 'recuperate') return '<span class="badge b-ok">recuperate</span>';
      if (b.status === 'pagate') return '<span class="badge b-paid">da pagare</span>';
      const cls = b.daysLeft <= 7 ? 'b-bad' : b.daysLeft <= 14 ? 'b-warn' : 'b-open';
      return `<span class="badge ${cls}">${b.daysLeft} gg</span>`;
    };
    $('bank').innerHTML = res.bank.length ? '<tr><th>Giorno</th><th class="num">Extra</th><th class="num">Residuo</th><th>Scadenza</th><th>Stato</th></tr>' +
      groupByMonth(res.bank.slice().reverse(), b => b.date).map(([m, items]) =>
        `<tr class="month"><td>${monthLabel(m)}</td><td class="num">${fmt(items.reduce((s, b) => s + b.minutes, 0))}</td>` +
        `<td class="num">${fmt(items.reduce((s, b) => s + (b.status === 'recuperate' ? 0 : b.remaining), 0))}</td><td colspan="2"></td></tr>` +
        items.map(b => `<tr><td>${dmy(b.date)}</td><td class="num">${fmt(b.minutes)}</td>` +
          `<td class="num">${fmt(b.remaining)}</td><td>${dmy(b.deadline)}</td><td>${badge(b)}</td></tr>`).join('')).join('')
      : '<tr><td class="muted">Nessuno straordinario: importa un cartellino.</td></tr>';

    // Recuperi (manuali + automatici), divisi per mese
    $('recs').innerHTML = res.recLog.length ? '<tr><th>Data</th><th class="num">Ore</th><th>Nota</th><th>Coperto da</th><th></th></tr>' +
      groupByMonth(res.recLog.slice().reverse(), r => r.date).map(([m, items]) =>
        `<tr class="month"><td>${monthLabel(m)}</td><td class="num">${fmt(items.reduce((s, r) => s + r.minutes, 0))}</td><td colspan="3"></td></tr>` +
        items.map(r => `<tr><td>${dmy(r.date)}</td><td class="num">${fmt(r.minutes)}</td>` +
          `<td>${esc(r.note)}</td><td>${r.used.map(u => dmy(u.from).slice(0, 5) + ' (' + fmt(u.minutes) + ')').join(', ') || '—'}` +
          `${r.uncovered ? ` <span class="neg">scoperto ${fmt(r.uncovered)}</span>` : ''}</td>` +
          `<td>${r.auto ? '<span class="muted">auto</span>' : `<button class="del" data-rec="${r.idx}">✕</button>`}</td></tr>`).join('')).join('')
      : '<tr><td class="muted">Nessun recupero registrato.</td></tr>';

    const paid = Object.entries(res.paidByMonth).sort();
    $('paid').innerHTML = paid.length ? '<tr><th>Mese di scadenza</th><th class="num">Ore</th></tr>' +
      paid.map(([m, v]) => `<tr><td>${monthLabel(m)}</td><td class="num">${fmt(v)}</td></tr>`).join('')
      : '<tr><td class="muted">Nessuna ora scaduta finora.</td></tr>';

    // Giornate: un blocco apribile per mese (il più recente aperto)
    const dates = Object.keys(emp.days).sort().reverse();
    const openMonths = new Set([...$('days').querySelectorAll('details[open]')].map(d => d.dataset.month));
    const groups = groupByMonth(dates, d => d);
    const keepOpen = groups.some(([m]) => openMonths.has(m)); // conserva i mesi aperti tra un aggiornamento e l'altro
    $('days').innerHTML = dates.length ? groups.map(([m, ds], i) => {
      const r = byMonth[m];
      const isOpen = keepOpen ? openMonths.has(m) : i === 0;
      return `<details data-month="${m}" ${isOpen ? 'open' : ''}><summary><b>${monthLabel(m)}</b>` +
        `<span class="muted"> · ${r.days} giorni · ${fmt(r.worked)} lavorate · <span class="pos">+${fmt(r.ot)} straord.</span></span>` +
        `${r.incomplete ? ` <span class="badge b-warn">${r.incomplete} incomplete</span>` : ''}</summary>` +
        '<div class="tbl"><table><tr><th>Data</th><th>Timbrature</th><th class="num">TOT</th><th class="num">Diff. base</th></tr>' +
        ds.map(d => {
          const v = emp.days[d];
          const wd = WD[new Date(d + 'T12:00').getDay()];
          const diff = v.tot == null ? '' : v.tot - st.baseMin;
          const incomplete = v.tot == null && v.stamps && v.stamps.length;
          return `<tr class="${wd === 'sab' || wd === 'dom' ? 'weekend' : ''}"><td>${wd} ${dmy(d)}</td>` +
            `<td>${(v.stamps || []).join(' · ')}${incomplete ? ' <span class="badge b-warn">incompleta</span>' : ''}</td>` +
            `<td class="num"><input class="tot" data-day="${d}" value="${v.tot == null ? '' : fmt(v.tot)}" placeholder="—"></td>` +
            `<td class="num ${diff > 0 ? 'pos' : diff < 0 && v.tot > 0 ? 'neg' : 'muted'}">${diff === '' ? '' : (diff > 0 ? '+' : '') + fmt(diff)}</td></tr>`;
        }).join('') + '</table></div></details>';
    }).join('') : '<p class="muted">Nessuna giornata.</p>';
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
    cur().recoveries.push({ date: $('recDate').value, minutes: m, note: $('recNote').value.trim() });
    $('recHours').value = ''; $('recNote').value = '';
    save(); render();
  });
  $('recs').addEventListener('click', e => {
    const i = e.target.dataset.rec;
    if (i != null) { cur().recoveries.splice(Number(i), 1); save(); render(); }
  });
  $('days').addEventListener('change', e => {
    const d = e.target.dataset.day;
    if (!d) return;
    const raw = e.target.value.trim();
    const m = raw === '' ? null : toMin(raw);
    if (raw !== '' && m == null) { alert('Formato hh:mm'); render(); return; }
    cur().days[d] = { ...cur().days[d], tot: m, edited: true };
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
    if (confirm('Cancellare tutti i dipendenti, le giornate e i recuperi?')) { state.employees = {}; state.selected = null; save(); render(); }
  });
  $('emps').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-emp]');
    if (tr) { state.selected = tr.dataset.emp; $('days').innerHTML = ''; save(); render(); $('detail').scrollIntoView({ behavior: 'smooth' }); }
  });
  $('empSel').addEventListener('change', e => { state.selected = e.target.value; $('days').innerHTML = ''; save(); render(); });
  $('empDel').addEventListener('click', () => {
    if (state.selected && confirm(`Eliminare ${cur().name} e tutti i suoi dati?`)) { delete state.employees[state.selected]; state.selected = null; save(); render(); }
  });

  render();
})();
