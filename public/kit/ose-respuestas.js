// Complemento de ose-sync.js (pegar DESPUÉS de ose-sync.js en la misma pestaña de OSE).
// OSE.llamadas(desde, hasta, socias): entradas del Histórico de Llamadas (informe 61 "Llamadas a Socias") entre dos
// fechas ISO (YYYY-MM-DD) apuntadas A MANO por las entrenadoras (no las "MIA | ..." que vuelca la app ni cumpleaños).
// socias = [[nombre, ultEntrenoISO], ...]: solo devuelve entradas de esas socias posteriores a su último entreno,
// una fila por socia [nombre, primeraFecha 'YYYY-MM-DD', ultimaFechaHora 'YYYY-MM-DD HH:MM', empleada, motivo, comentario].
// Sin 'socias' devuelve todas las filas: [nombre, empleado, 'YYYY-MM-DD HH:MM', motivo, comentario, mia].
OSE.llamadas = async function (desde, hasta, socias) {
  const dmy = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4);
  const nm = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  const a = [...document.querySelectorAll('a')].find(x => x.textContent.trim() === 'Gestión' && /\.aspx/.test(x.getAttribute('href') || ''));
  if (!a) throw new Error('SESION_OSE_CADUCADA (no veo el menú Gestión)');
  let pg = await OSE.get(a.href.replace('management_index.aspx', 'reports.aspx'));
  if (!pg.doc.forms[0]) throw new Error('SESION_OSE_CADUCADA (OSE devolvió ' + pg.doc.title + ')');
  pg = await OSE.post(pg, { 'ctl00$cplMainPage$cmbReport': '61', '__EVENTTARGET': 'ctl00$cplMainPage$cmbReport', '__EVENTARGUMENT': '' });
  pg = await OSE.post(pg, { 'ctl00$cplMainPage$cmbReport': '61', 'ctl00$cplMainPage$txtStartDate$txtStartDate': dmy(desde), 'ctl00$cplMainPage$txtEndDate$txtEndDate': dmy(hasta) }, 'ctl00$cplMainPage$butPreview');
  const rel = pg.doc.querySelector('#cplMainPage_divOpenPopup').getAttribute('onclick').match(/'([^']+)'/)[1];
  const rep = await OSE.get(new URL(rel, pg.url).href);
  let rows = [...rep.doc.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim().replace(/\s+/g, ' ')))
    .filter(c => c.length === 6 && /^\d\d\/\d\d\/\d{4}/.test(c[2]))
    .map(c => [c[0], c[1], c[2].slice(6, 10) + '-' + c[2].slice(3, 5) + '-' + c[2].slice(0, 2) + ' ' + (c[2].slice(11, 16) || '00:00'), c[3], c[4].slice(0, 300), c[5]])
    .filter(c => !c[4].startsWith('MIA |') && !/umplea/i.test(c[3]));
  if (socias) {
    const u = {}; socias.forEach(([n, ult]) => { u[nm(n)] = ult; });
    const by = {};
    rows.filter(c => u[nm(c[0])] && c[2].slice(0, 10) > u[nm(c[0])]).forEach(c => {
      const k = nm(c[0]); const b = by[k] || (by[k] = { first: c, last: c });
      if (c[2] < b.first[2]) b.first = c; if (c[2] >= b.last[2]) b.last = c;
    });
    return JSON.stringify(Object.values(by).map(b => [b.last[0], b.first[2].slice(0, 10), b.last[2], b.last[1].split(' ')[0], b.last[3], b.last[4].slice(0, 160)]));
  }
  return JSON.stringify(rows);
};
'respuestas listo';
