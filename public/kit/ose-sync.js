// OSE MIA sync helpers — se ejecuta dentro de una pestaña de sys.oseurope.com con la sesión iniciada.
// Uso: pegar este archivo entero en javascript_tool y después llamar a OSE.extraer() / OSE.registrar(g).
window.OSE = (() => {
  const P = t => new DOMParser().parseFromString(t, 'text/html');
  const STAFF = { Susana: 'Susana', Manoli: 'Manoli', Eva: 'EVA', Viviana: 'Viviana' };
  async function get(url) { const r = await fetch(url, { credentials: 'include' }); return { doc: P(await r.text()), url: r.url }; }
  async function post(page, fields, submitter) {
    const f = page.doc.forms[0]; const fd = new FormData(f);
    for (const k of [...fd.keys()]) { const el = f.querySelector(`[name="${CSS.escape(k)}"]`); if (el && el.type === 'submit') fd.delete(k); }
    if (submitter) { const b = f.querySelector(`[name="${CSS.escape(submitter)}"]`); fd.set(submitter, b ? b.value : ''); }
    for (const [k, v] of Object.entries(fields || {})) { if (v === null) fd.delete(k); else fd.set(k, v); }
    if (!('__EVENTTARGET' in (fields || {}))) { fd.set('__EVENTTARGET', ''); fd.set('__EVENTARGUMENT', ''); }
    const body = new URLSearchParams(); for (const [k, v] of fd.entries()) if (typeof v === 'string') body.append(k, v);
    const action = new URL(f.getAttribute('action') || page.url, page.url).href;
    const r = await fetch(action, { method: 'POST', body, credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return { doc: P(await r.text()), url: r.url };
  }
  // Enlaces del menú principal por su texto (las rutas cambian según la página en la que estés)
  const nav = txt => { const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === txt && /\.aspx/.test(x.getAttribute('href') || '')); if (!a) throw new Error('SESION_OSE_CADUCADA (no veo el menú ' + txt + ')'); return a.href; };
  const link = sel => sel.includes('CISMembers/list') ? nav('Socias') : nav('Gestión');
  const loggedIn = () => { try { nav('Socias'); return true; } catch (e) { return false; } };

  // ---------- LECTURA ----------
  async function informe(reportId, extra) {
    let pg = await get(link('a[href*="CISManagement/management_index.aspx"]').replace('management_index.aspx', 'reports.aspx'));
    pg = await post(pg, { 'ctl00$cplMainPage$cmbReport': String(reportId), '__EVENTTARGET': 'ctl00$cplMainPage$cmbReport', '__EVENTARGUMENT': '' });
    const fields = { 'ctl00$cplMainPage$cmbReport': String(reportId) };
    for (const [k, v] of Object.entries(extra || {})) {
      const el = [...pg.doc.forms[0].querySelectorAll('input[type=text]')].find(e => e.name.includes(k));
      if (!el) throw new Error('Campo ' + k + ' no encontrado en el informe ' + reportId);
      fields[el.name] = v;
    }
    pg = await post(pg, fields, 'ctl00$cplMainPage$butPreview');
    const div = pg.doc.querySelector('#cplMainPage_divOpenPopup');
    const rel = div && (div.getAttribute('onclick') || '').match(/'([^']+)'/);
    if (!rel) throw new Error('El informe ' + reportId + ' no devolvió enlace');
    const rep = await get(new URL(rel[1], pg.url).href);
    return [...rep.doc.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim().replace(/\s+/g, ' ')));
  }
  async function miaNC() {
    const url = link('a[href*="CISManagement/management_index.aspx"]').replace('management_index.aspx', 'MIA.aspx');
    let doc = await get(url); const out = {};
    const rows = d => [...d.doc.querySelectorAll('tr')].filter(r => r.querySelector('input[type=checkbox]') && r.cells.length >= 9).slice(1).map(r => [...r.cells].map(c => c.textContent.trim()));
    const pager = d => [...d.doc.querySelectorAll('td.Grelha_Cab')].map(x => x.textContent).find(x => /Página/.test(x));
    for (const b of ['1', '2', '3', '4']) {
      let d = await post(doc, { 'ctl00$cplMainPage$cmbMIA': b }, 'ctl00$cplMainPage$butSelect');
      let all = rows(d), p = pager(d), g = 0;
      while (p) { const m = p.match(/Página (\d+) de (\d+)/); if (!m || +m[1] >= +m[2] || g > 40) break; d = await post(d, { '__EVENTTARGET': 'ctl00$cplMainPage$objGrid', '__EVENTARGUMENT': 'GRID_PAGE_NEXT' }); all = all.concat(rows(d)); p = pager(d); g++; }
      all.forEach(c => { out[c[6]] = { nc: !!c[9], cat: c[8] }; });
    }
    return out;
  }
  async function totalSocias() {
    const pg = await get(link('a[href*="CISMembers/list.aspx"]'));
    const t = [...pg.doc.querySelectorAll('td')].map(x => x.textContent).find(x => /Total: \d+/.test(x));
    return t ? +t.match(/Total: (\d+)/)[1] : null;
  }
  // Devuelve [num, nombre, tel, ultEntrenoISO, dias, rp, pb, cat, nc, notaFicha]
  async function extraer() {
    if (!loggedIn()) throw new Error('SESION_OSE_CADUCADA');
    const rows = (await (async () => {
      // Informe "Días sin Venir" (id 32) con 4 días
      let pg = await get(link('a[href*="CISManagement/management_index.aspx"]').replace('management_index.aspx', 'reports.aspx'));
      pg = await post(pg, { 'ctl00$cplMainPage$cmbReport': '32', '__EVENTTARGET': 'ctl00$cplMainPage$cmbReport', '__EVENTARGUMENT': '' });
      const el = [...pg.doc.forms[0].querySelectorAll('input[type=text]')].find(e => !/txtSearch|Date/.test(e.name));
      pg = await post(pg, { 'ctl00$cplMainPage$cmbReport': '32', [el.name]: '4' }, 'ctl00$cplMainPage$butPreview');
      const rel = pg.doc.querySelector('#cplMainPage_divOpenPopup').getAttribute('onclick').match(/'([^']+)'/)[1];
      const rep = await get(new URL(rel, pg.url).href);
      return [...rep.doc.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim()));
    })()).filter(c => c.length === 9 && /^\d+$/.test(c[1]));
    const nc = await miaNC();
    const iso = s => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };
    const out = rows.map(r => {
      const cands = [r[5], r[4]].map(x => (x || '').replace(/[\s.-]/g, ''));
      const tel = cands.find(x => /^[679]\d{8}$/.test(x)) || '';
      const nota = [r[5], r[4]].filter(x => x && !/^[\d\s.-]+$/.test(x)).join(' / ');
      const m = nc[r[1]] || {};
      return [r[1], r[0], tel, iso(r[2]), +r[3], /Empleado/.test(r[7]), r[8] !== 'Alta', m.cat || '', !!m.nc, nota];
    });
    return { total: await totalSocias(), socias: out };
  }

  // ---------- ESCRITURA ----------
  async function openHistorico(num) {
    let pg = await get(link('a[href*="CISMembers/list.aspx"]'));
    pg = await post(pg, { 'ctl00$cplMainPage$txtMemberNumber': String(num), 'ctl00$cplMainPage$radListMemberStatus': 'radMemberStatusAll' }, 'ctl00$cplMainPage$butSearch');
    const row = [...pg.doc.querySelectorAll('tr[onclick*="details.aspx"]')].find(r => [...r.cells].some(c => c.textContent.trim() === String(num)));
    if (!row) throw new Error('Socia ' + num + ' no encontrada');
    const rel = row.getAttribute('onclick').match(/document\.location = "([^"]+)"/)[1];
    const det = await get(new URL(rel, pg.url).href);
    const a = det.doc.querySelector('a[href*="historicCallList.aspx"]');
    if (!a) throw new Error('Sin enlace al Histórico de ' + num);
    return get(new URL(a.getAttribute('href'), det.url).href);
  }
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  function yaEsta(hist, texto) { return hist.doc.body.textContent.replace(/\s+/g, ' ').includes(norm(texto).slice(0, 60)); }
  // g = {num, dia:'YYYY-MM-DD', hora:'HH:MM', por:'Susana', canal:'Llamada'|'WhatsApp'|'En persona', textoOSE}
  async function registrar(g) {
    if (!loggedIn()) throw new Error('SESION_OSE_CADUCADA');
    let hist = await openHistorico(g.num);
    if (yaEsta(hist, g.textoOSE)) return { ok: true, dup: true };
    let form = await post(hist, {}, 'ctl00$cplMainPage$butNew');
    const f = form.doc.forms[0];
    const staffSel = f.querySelector('select[name$="cmbStaff"]');
    const want = STAFF[g.por] || g.por;
    let opt = [...staffSel.options].find(o => o.text.toLowerCase().includes(want.toLowerCase()));
    let nota = '';
    if (!opt) { opt = [...staffSel.options].find(o => /EVA ALCOCER/i.test(o.text)); nota = ' [hecha por ' + g.por + ', no está dada de alta como empleada en OSE]'; }
    const [y, m, d] = g.dia.split('-');
    const fields = {
      'ctl00$cplMainPage$txtDate$txtDate': `${d}/${m}/${y}`,
      'ctl00$cplMainPage$txtHour': g.hora || '12:00',
      'ctl00$cplMainPage$cmbOccurrence': '1', // Días sin entrenar
      'ctl00$cplMainPage$cmbStaff': opt.value,
      'ctl00$cplMainPage$txtComments': g.textoOSE + nota,
      'ctl00$cplMainPage$chkMIA': 'on'
    };
    let res = await post(form, fields, 'ctl00$cplMainPage$butConfirm');
    // Si OSE pide el método de contacto en una ventana aparte, la completamos.
    const cm = res.doc.querySelector('select[name$="cmbContactMethod"]');
    if (res.url.includes('historicCallDetails') && cm && cm.options.length > 1) {
      const pick = [...cm.options].find(o => g.canal === 'WhatsApp' ? /whats|mensaje|sms/i.test(o.text) : g.canal === 'En persona' ? /persona/i.test(o.text) : /tel|llam/i.test(o.text)) || cm.options[1];
      res = await post(res, { ...fields, 'ctl00$cplMainPage$cmbContactMethod': pick.value }, 'ctl00$cplMainPage$btnHistCallConfirm');
    }
    const err = [...res.doc.querySelectorAll('.CISLabelError,.error,[id*=lblError]')].map(e => e.textContent.trim()).filter(Boolean).join(' ');
    hist = await openHistorico(g.num);
    if (yaEsta(hist, g.textoOSE)) return { ok: true };
    return { ok: false, error: err || 'No aparece en el Histórico tras confirmar' };
  }
  // prevStr = "num:ultISO:pb:nc,num:..." (lo genera prevkeys.py). Devuelve solo lo que ha cambiado.
  async function extraerDelta(prevStr) {
    const prev = {}; String(prevStr || '').split(',').filter(Boolean).forEach(x => { const [n, u, pb, nc] = x.split(':'); prev[n] = { u, pb: pb === '1', nc: nc === '1' }; });
    const r = await extraer(); window.__ext = r;
    const now = new Set(r.socias.map(s => s[0]));
    const changed = r.socias.filter(s => { const p = prev[s[0]]; return !p || p.u !== s[3] || p.pb !== s[6] || p.nc !== s[8]; })
      .map(s => [s[0], s[1], s[2], s[3], s[4], s[5] ? 1 : 0, s[6] ? 1 : 0, s[7], s[8] ? 1 : 0, s[9]]);
    const gone = Object.keys(prev).filter(n => !now.has(n));
    return JSON.stringify({ total: r.total, n: r.socias.length, changed, gone });
  }
  // Vuelca una lista de gestiones; devuelve [{id, ok, error}]
  async function volcar(lista) {
    const out = [];
    for (const g of lista) { try { const r = await registrar(g); out.push({ id: g.id, ...r }); } catch (e) { out.push({ id: g.id, ok: false, error: String(e.message || e) }); if (String(e.message).includes('SESION_OSE_CADUCADA')) break; } }
    return JSON.stringify(out);
  }
  // Últimas llamadas registradas en OSE (informe "Llamadas a Socias", 90 días) para dar contexto al mensaje personal.
  // lista = [[num, nombre], ...] -> {num: ["dd/mm/aaaa Empleado (Motivo): comentario", ...]} (máx. 2 por socia)
  async function contexto(lista) {
    const fin = new Date(), ini = new Date(Date.now() - 90 * 864e5);
    const f = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    let pg = await get(link('Gestión').replace('management_index.aspx', 'reports.aspx'));
    pg = await post(pg, { 'ctl00$cplMainPage$cmbReport': '61', '__EVENTTARGET': 'ctl00$cplMainPage$cmbReport', '__EVENTARGUMENT': '' });
    pg = await post(pg, { 'ctl00$cplMainPage$cmbReport': '61', 'ctl00$cplMainPage$txtStartDate$txtStartDate': f(ini), 'ctl00$cplMainPage$txtEndDate$txtEndDate': f(fin) }, 'ctl00$cplMainPage$butPreview');
    const rel = pg.doc.querySelector('#cplMainPage_divOpenPopup').getAttribute('onclick').match(/'([^']+)'/)[1];
    const rep = await get(new URL(rel, pg.url).href);
    const calls = [...rep.doc.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim().replace(/\s+/g, ' '))).filter(c => c.length === 6 && /\d\d\/\d\d\/\d{4}/.test(c[2]));
    const nm = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
    const key = c => c[2].slice(6, 10) + c[2].slice(3, 5) + c[2].slice(0, 2) + c[2].slice(11);
    const out = {};
    for (const [num, nombre] of lista) {
      const k = nm(nombre);
      const mine = calls.filter(c => nm(c[0]) === k).sort((a, b) => key(b).localeCompare(key(a)));
      out[num] = mine.slice(0, 2).map(c => `${c[2].slice(0, 10)} ${c[1].split(' ')[0]} (${c[3]}): ${c[4].slice(0, 160)}`);
    }
    return JSON.stringify(out);
  }
  return { get, post, informe, extraer, extraerDelta, openHistorico, registrar, volcar, contexto, loggedIn };
})();
'OSE listo';
