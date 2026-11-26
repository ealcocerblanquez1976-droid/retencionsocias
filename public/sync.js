/*
 * Motor de sincronización MIA (Curves Sant Cugat) sobre Supabase.
 * Sustituye a sync.py, respuestas.py, wa.py, riesgo.py, mensajes.py, prevkeys.py y nombres.py:
 * la tarea programada lee OSE y WhatsApp y le pasa aquí lo leído; todo lo demás se calcula y guarda en la web.
 * Se carga en /sync (con sesión iniciada). API en window.MIASYNC.
 */
(function () {
  "use strict";
  const MIN_DIAS = 6;
  // Hasta esa fecha (sin incluir) las MIA de esa entrenadora las lleva Eva. Misma lista que AUSENCIAS en la app.
  const AUSENCIAS = { Viviana: "2026-11-27", Susana: "2026-11-19", Manoli: "2026-11-19" };
  const TEAM = ["Susana", "Manoli", "Viviana", "Eva"];

  /* ---------- fechas (todas 'YYYY-MM-DD', sin zonas horarias) ---------- */
  const ms = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const diff = (a, b) => Math.round((ms(a) - ms(b)) / 864e5); // días a - b
  const addDays = (s, n) => iso(ms(s) + n * 864e5);
  function addWorkdays(s, n) {
    let t = ms(s), k = 0;
    while (k < n) { t += 864e5; const wd = new Date(t).getUTCDay(); if (wd >= 1 && wd <= 5) k++; }
    return iso(t);
  }
  const tramo = (d) => (d <= 15 ? "6-15" : d <= 30 ? "16-30" : "31+");
  const desdeGestion = (u) => addDays(u.slice(0, 10), MIN_DIAS);
  const maxS = (...xs) => xs.filter((x) => x != null).reduce((a, b) => (b > a ? b : a));
  function pyRound(x) { // round() de Python (mitades al par)
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  const pct = (a, b) => (b ? pyRound((100 * a) / b) : null);

  /* ---------- acceso a datos ---------- */
  let dbp = null;
  const db = () => (dbp = dbp || window.claude.use("db"));
  const sb = () => window.MIA_SB;
  async function all(coll) {
    await db();
    const out = {};
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb().from("docs").select("id,data").eq("collection", coll).order("id").range(from, from + 999);
      if (error) throw new Error("Supabase (" + coll + "): " + error.message);
      for (const r of data) out[r.id] = r.data || {};
      if (data.length < 1000) break;
    }
    return out;
  }
  async function ids(coll) {
    await db();
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb().from("docs").select("id").eq("collection", coll).order("id").range(from, from + 999);
      if (error) throw new Error("Supabase (" + coll + "): " + error.message);
      out.push(...data.map((r) => r.id));
      if (data.length < 1000) break;
    }
    return out;
  }
  async function one(coll, id) {
    await db();
    const { data, error } = await sb().from("docs").select("data").eq("collection", coll).eq("id", id).maybeSingle();
    if (error) throw new Error("Supabase (" + coll + "/" + id + "): " + error.message);
    return data ? data.data : null;
  }
  async function ultimaFotoDoc() {
    const l = await ids("snapshots");
    if (!l.length) return null;
    const id = l[l.length - 1]; // ids AAAA-MM-DDTHHMM: el mayor es la más reciente
    return { id, ...(await one("snapshots", id)) };
  }
  const set = async (coll, id, data) => (await db()).doc(coll + "/" + id).set(data);
  const merge = async (coll, id, data) => (await db()).doc(coll + "/" + id).set(data, { merge: true });
  const upd = async (coll, id, data) => (await db()).doc(coll + "/" + id).update(data);
  const del = async (coll, id) => (await db()).doc(coll + "/" + id).delete();
  const parse = (x) => (typeof x === "string" ? JSON.parse(x) : x);
  // Igualdad profunda sin depender del orden de las claves (jsonb las reordena)
  function deepEq(a, b) {
    if (a === b) return true;
    if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
  }

  /* ---------- nombres (igual que respuestas.py) ---------- */
  const nm = (s) => (s || "").normalize("NFD").replace(/[^\x00-\x7F]/g, "").toUpperCase()
    .replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();

  function analizar(llamadas, rows) {
    const porNombre = {};
    for (const [num, r] of Object.entries(rows)) (porNombre[nm(r.n)] = porNombre[nm(r.n)] || []).push(num);
    const res = {};
    for (const [nombre, primera, fecha, emp, motivo, coment] of llamadas || []) {
      const nums = porNombre[nm(nombre)] || [];
      if (nums.length !== 1) continue;
      const num = nums[0];
      if (fecha.slice(0, 10) <= rows[num].u) continue;
      const e = emp || "";
      res[num] = {
        primera: maxS(primera, rows[num].u),
        ultima: { fecha: fecha.slice(0, 10), hora: fecha.slice(11, 16), emp: e ? e[0].toUpperCase() + e.slice(1).toLowerCase() : "",
          motivo, txt: (coment || "").slice(0, 300) },
      };
    }
    return res;
  }
  function ultApp(gest) {
    const u = {};
    for (const g of gest) { const f = (g.fecha || "").replace("T", " ").slice(0, 16); if (f > (u[g.num] || "")) u[g.num] = f; }
    return u;
  }
  const gestionesDesde = async (hoy) => Object.entries(await all("gestiones"))
    .filter(([, g]) => (g.dia || "") >= addDays(hoy, -60)).map(([id, g]) => ({ ...g, id }));

  /* ---------- API ---------- */
  const API = {};

  API.estado = async function () {
    const { data } = await sb().auth.getSession();
    if (!data || !data.session) return "SIN_SESION";
    return "OK " + data.session.user.email;
  };

  // prevkeys.py
  API.prevkeys = async function () {
    const f = await ultimaFotoDoc();
    if (!f) return "SIN_FOTO";
    return Object.entries(f.rows).map(([n, r]) => `${n}:${r.u}:${r.pb ? 1 : 0}:${r.nc ? 1 : 0}`).join(",");
  };
  // nombres.py
  API.nombres = async function () {
    const f = await ultimaFotoDoc();
    return JSON.stringify(Object.values(f ? f.rows : {}).filter((r) => !r.nc).map((r) => [r.n, r.u]));
  };
  API.ultimaFoto = async function () {
    const f = await ultimaFotoDoc();
    if (!f) return null;
    const rows = {};
    for (const [n, r] of Object.entries(f.rows)) rows[n] = { u: r.u, n: r.n };
    return JSON.stringify({ id: f.id, fecha: f.fecha, rows });
  };

  // sync.py: delta de OSE.extraerDelta + llamadas de OSE.llamadas -> foto, informe y vueltas nuevas.
  API.sync = async function (deltaIn, llamadasIn, hoy, hora, opts) {
    opts = opts || {};
    let raw = parse(deltaIn);
    const llamadas = llamadasIn ? parse(llamadasIn) : null;
    const snapIds = await ids("snapshots");
    const prev = snapIds.length ? await one("snapshots", snapIds[snapIds.length - 1]) : null;
    const prevRows = (prev && prev.rows) || {};
    if ("changed" in raw) {
      const gone = new Set(raw.gone || []);
      const full = {};
      for (const [n, r] of Object.entries(prevRows)) if (!gone.has(n)) full[n] = [n, r.n, r.t, r.u, 0, r.rp, r.pb, r.c, r.nc, r.f];
      for (const row of raw.changed) full[row[0]] = row;
      if (Object.keys(full).length !== raw.n) {
        throw new Error(`RECONSTRUCCION: la reconstrucción da ${Object.keys(full).length} socias y OSE dice ${raw.n}. Repetir con extraerDelta('').`);
      }
      raw = { total: raw.total, socias: Object.values(full) };
    }
    const casos = await all("socias");
    const gest = await gestionesDesde(hoy);
    const vueltasOld = Object.values(await all("vueltas"));

    const rows = {};
    for (const [num, nombre, tel, ult, , rp, pb, cat, nc, nota] of raw.socias) {
      const p = prevRows[num];
      let a = p && p.u === ult ? p.a : hoy;
      if (!p && casos[num] && casos[num].ultEntreno === ult && casos[num].abiertaDesde) a = casos[num].abiertaDesde;
      rows[num] = { n: nombre, t: tel, u: ult, rp: !!rp, pb: !!pb, c: cat, nc: !!nc, f: nota, a };
    }
    const snapId = hoy + "T" + hora.replace(":", "");
    if (llamadas) {
      const oseMan = analizar(llamadas, rows);
      for (const [num, d] of Object.entries(oseMan)) {
        const c = (casos[num] = casos[num] || { ultEntreno: rows[num].u, caseUlt: rows[num].u });
        if (!(c.primeraOSE && c.primeraOSE > rows[num].u && c.primeraOSE < d.primera)) c.primeraOSE = d.primera;
        const pv = c.ultGestionOSE || {};
        if (!((pv.fecha || "") > rows[num].u && (pv.fecha || "") + (pv.hora || "") > d.ultima.fecha + d.ultima.hora)) c.ultGestionOSE = d.ultima;
      }
    }
    const primeraDe = (c, sc) => {
      if (!sc || !c) return null;
      const xs = [c.primeraGestion, c.primeraOSE].filter(Boolean);
      return xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : null;
    };
    const sameCase = (c, ult) => c != null && (c.caseUlt || c.ultEntreno) === ult;
    const snapshot = { fecha: hoy, hora, total: raw.total ?? null, n: Object.keys(rows).length, rows };

    const vueltas = [];
    for (const [num, p] of Object.entries(prevRows)) {
      const cur = rows[num];
      if (cur && cur.u === p.u) continue;
      const c = casos[num];
      const sc = sameCase(c, p.u);
      const ug = sc ? (c || {}).ultGestionApp : null;
      let vf = cur ? cur.u : hoy;
      if (vf.slice(0, 10) < p.u.slice(0, 10)) vf = hoy;
      const v = { num, nombre: p.n, abiertaDesde: p.a, ultEntreno: p.u, vueltaFecha: vf, primeraGestion: primeraDe(c, sc),
        por: (ug || {}).por ?? null, ultCodigo: (ug || {}).codigo ?? null, detectada: hoy };
      vueltas.push([`${num}-${p.a}`, v]);
    }

    const owner = (dias, manual) => {
      let w = manual || (dias <= 15 ? "Susana" : dias <= 30 ? "Manoli" : "Eva");
      return w in AUSENCIAS && hoy < AUSENCIAS[w] ? "Eva" : w;
    };
    const estado = [];
    for (const [num, r] of Object.entries(rows)) {
      const c = casos[num];
      const dias = diff(hoy, r.u);
      const sc = sameCase(c, r.u);
      const excl = (c || {}).estado === "excluida";
      const e = { num, dias, tramo: tramo(dias), nc: r.nc, excl, pb: r.pb, a: r.a,
        prox: maxS((sc ? (c || {}).prox : r.a) || r.a, desdeGestion(r.u)),
        escalada: sc ? !!(c || {}).escalada : false, primera: primeraDe(c, sc),
        cod: sc ? (((c || {}).ultGestionApp || {}).codigo ?? null) : null };
      e.owner = e.escalada ? "Eva" : owner(dias, (c || {}).ownerManual);
      estado.push(e);
    }
    const abiertas = estado.filter((e) => !e.nc && !e.excl && !e.pb && e.dias >= MIN_DIAS);
    for (const e of estado) e.a = maxS(e.a, desdeGestion(rows[e.num].u));
    const procesoBaja = estado.filter((e) => !e.nc && !e.excl && e.pb && e.dias >= MIN_DIAS);

    const allV = {};
    for (const v of vueltasOld) allV[`${v.num}-${v.abiertaDesde}`] = v;
    for (const [vid, v] of vueltas) allV[vid] = v;
    const inicioV = (v) => (v.ultEntreno ? maxS(v.abiertaDesde, desdeGestion(v.ultEntreno)) : v.abiertaDesde);
    const casosK1 = abiertas.map((e) => [e.a, e.primera])
      .concat(Object.values(allV).filter((v) => v.vueltaFecha >= inicioV(v)).map((v) => [inicioV(v), v.primeraGestion]));
    const k1 = casosK1.filter(([a]) => diff(hoy, a) <= 21 && addWorkdays(a, 2) <= hoy);
    const k1ok = k1.filter(([a, p]) => p && p <= addWorkdays(a, 2)).length;
    const atrasadas = abiertas.filter((e) => e.prox && e.prox < hoy);
    const base3 = Object.values(allV).filter((v) => v.primeraGestion && diff(hoy, v.primeraGestion) <= 60);
    const ok3 = base3.filter((v) => diff(v.vueltaFecha, v.primeraGestion) <= 14).length;
    const base3open = abiertas.filter((e) => e.primera && diff(hoy, e.primera) >= 14 && diff(hoy, e.primera) <= 60);
    const riesgo = abiertas.filter((e) => e.cod === "RIESGO BAJA");
    const gHoy = gest.filter((g) => g.dia === hoy);
    const equipo = {};
    for (const w of TEAM) {
      const mine = abiertas.filter((e) => e.owner === w);
      equipo[w] = { asignadas: mine.length, paraHoy: mine.filter((e) => !e.prox || e.prox <= hoy).length,
        atrasadas: mine.filter((e) => e.prox && e.prox < hoy).length,
        gestionesHoy: gHoy.filter((g) => g.por === w).length,
        vueltas30: Object.values(allV).filter((v) => v.por === w && diff(hoy, v.vueltaFecha) <= 30).length };
    }
    const ncMia = estado.filter((e) => e.nc && e.dias >= MIN_DIAS).length;
    const informe = { fecha: hoy, hora, totalSocias: raw.total ?? null, mia: abiertas.length, noContactar: ncMia,
      procesoBaja: procesoBaja.length, pctMia: pct(abiertas.length + ncMia, raw.total || 0),
      porTramo: Object.fromEntries(["6-15", "16-30", "31+"].map((t) => [t, abiertas.filter((e) => e.tramo === t).length])),
      nuevasHoy: abiertas.filter((e) => e.a === hoy).length, vueltasHoy: vueltas.length,
      gestionesHoy: gHoy.length, pendientesOSE: gest.filter((g) => g.ose === "pendiente").length,
      kpi: { contactadas48h: pct(k1ok, k1.length), contactadas48hBase: k1.length,
        alDia: pct(abiertas.length - atrasadas.length, abiertas.length), atrasadas: atrasadas.length,
        vuelven14: pct(ok3, base3.length + base3open.length), vuelven14Base: base3.length + base3open.length,
        riesgoBaja: riesgo.length },
      equipo };

    const msgIds = new Set(await ids("mensajes"));
    const faltan = [];
    for (const e of estado) {
      if (e.nc || e.excl || e.pb || e.dias < MIN_DIAS) continue;
      const r = rows[e.num];
      if (msgIds.has(`${e.num}-${r.u}`)) continue;
      const ug = (casos[e.num] || {}).ultGestionApp;
      faltan.push({ num: e.num, nombre: r.n, dias: e.dias, tramo: e.tramo, owner: e.owner, pb: r.pb, ficha: r.f,
        ultimaApp: ug ? `${ug.dia || ""} ${ug.por || ""}: ${ug.codigo || ""} ${ug.nota || ""}`.trim() : "" });
    }

    const oldIds = new Set(vueltasOld.map((v) => `${v.num}-${v.abiertaDesde}`));
    const nuevasV = vueltas.filter(([vid]) => !oldIds.has(vid));
    if (!opts.dryRun) {
      await set("snapshots", snapId, snapshot);
      await set("informes", snapId, informe);
      for (const [vid, v] of nuevasV) await set("vueltas", vid, v);
    }
    window.__miaUltimo = { snapshot, informe, faltan };
    return JSON.stringify({ snapshot: snapId, socias: Object.keys(rows).length, abiertas: abiertas.length,
      nuevas: informe.nuevasHoy, vueltas: vueltas.length, vueltasEscritas: nuevasV.length, faltanMensajes: faltan,
      kpi: informe.kpi, equipo: Object.fromEntries(Object.entries(equipo).map(([w, v]) => [w, [v.paraHoy, v.gestionesHoy, v.atrasadas]])),
      procesoBaja: informe.procesoBaja, pendientesOSE: informe.pendientesOSE });
  };

  // respuestas.py: lo apuntado a mano en el Histórico de OSE -> socias.ultGestionOSE / primeraOSE.
  API.respuestas = async function (llamadasIn, hoy, opts) {
    opts = opts || {};
    const llamadas = parse(llamadasIn);
    const f = await ultimaFotoDoc();
    if (!f) return JSON.stringify({ error: "SIN_FOTO" });
    const rows = f.rows;
    const casos = await all("socias");
    const gest = await gestionesDesde(hoy);
    const ua = ultApp(gest);
    const an = analizar(llamadas, rows);
    const pend = [];
    let escritas = 0;
    for (const num of Object.keys(an).sort()) {
      const d = an[num];
      let ose = d.ultima;
      const c = casos[num], r = rows[num];
      if (c) {
        const pv = c.ultGestionOSE || {};
        if ((pv.fecha || "") > r.u && `${pv.fecha || ""} ${pv.hora || ""}` > `${ose.fecha} ${ose.hora}`) ose = pv;
        if (c.primeraOSE && c.primeraOSE > r.u) d.primera = c.primeraOSE < d.primera ? c.primeraOSE : d.primera;
        d.ultima = ose;
      }
      if (!c) {
        if (!opts.dryRun) await set("socias", num, { num, nombre: r.n, ultEntreno: r.u, caseUlt: r.u, estado: "abierta", ultGestionOSE: ose, primeraOSE: d.primera });
        escritas++;
      } else if (!deepEq(c.ultGestionOSE, ose) || c.primeraOSE !== d.primera) {
        if (!opts.dryRun) await upd("socias", num, { ultGestionOSE: ose, primeraOSE: d.primera });
        escritas++;
      }
      const k = `${ose.fecha} ${ose.hora}`;
      if (ua[num] && k > ua[num] && !r.nc) {
        pend.push({ num, nombre: r.n, fecha: k, emp: ose.emp, motivo: ose.motivo, txt: ose.txt, ultApp: ua[num] });
      }
    }
    return JSON.stringify({ writes: escritas, nuevoEnOSE: pend.length,
      lista: pend.map((p) => `${p.nombre} (${p.num}) ${p.fecha} ${p.emp}: ${(p.txt || "").slice(0, 80)}`),
      porEntrenadora: pend.reduce((a, p) => ((a[p.emp] = (a[p.emp] || 0) + 1), a), {}) });
  };

  /* ---------- WhatsApp: wa.py + riesgo.py ---------- */
  const CORTESIA = new Set(`gracias gracies merci mercis moltes muchas mil muchisimas moltissimes per por tu vuestro vostre interes interès el la los les y i a te et os us
perfecte perfecto perfect ok okey okay vale val genial guay fantastico fantastic estupendo super molt muy bien be igualmente igualment tambien tambe vosotras vosaltres vosotros
un una abrazo abrazos abraçada abracada abraçades besos beso peto petons bss bsss saludos salutacions de nada res cuidaos cuideu-vos
hola bon dia buenos dias tardes tarda nit noches eva susana manoli viviana guapa guapas wapa preciosa reina carinyo carino nena chicas noies`.split(/\s+/));
  const sinMarcas = (s) => s.normalize("NFD").replace(/\p{Mn}/gu, "");
  function cortesia(txt) {
    const t = sinMarcas((txt || "").toLowerCase());
    const pal = t.match(/[a-zçñ'-]+/g) || [];
    return pal.length > 0 && pal.every((p) => CORTESIA.has(p.replace(/^['-]+|['-]+$/g, "")));
  }
  const EXCLUIR = new Set(["696947283"]); // móvil de Eva / del club
  const PATRONES = [
    [/\bhorari?o?s?\b/, "horario"], [/\bno (te )?llego\b|\bno arribo\b|\bno m.arriba\b/, "no llega"],
    [/\bvoy (muy )?just[ao]\b|\bva (muy )?just[ao]\b|\bjust[ao] de tiempo\b|\bvaig (molt )?just[ao]?\b/, "va justa"],
    [/\bno (me da|tengo|trobo) (el )?(tiempo|temps)\b|\bno tinc temps\b|\bsin tiempo\b/, "sin tiempo"],
    [/\b(darme|donar-me|me doy|em dono) de (baja|baixa)\b|\bbaja\b|\bbaixa\b/, "baja"],
    [/\bdejar(lo)?\b|\bdeixar(-ho)?\b|\bplegar\b|\bno (voy a )?seguir\b|\bno seguire\b|\bcancelar\b/, "dejarlo"],
    [/\bprecio\b|\bpreu\b|\bcaro\b|\bdinero\b|\bdiners\b|\bcuota\b|\bquota\b|\bno me lo puedo permitir\b|\bpagar\b/, "dinero"],
    [/\bmudo\b|\bmudanza\b|\bme voy a vivir\b|\bcanvi de casa\b|\bem canvio\b/, "mudanza"],
    [/\b(nuevo trabajo|trabajo nuevo|feina nova|canvi de feina|cambio de trabajo|turno|turnos|torn)\b/, "trabajo"],
    [/\blesion\b|\blesio\b|\boperacion\b|\boperacio\b|\bme operan\b|\bciatica\b|\bdolor\b|\bmal d.esquena\b|\binfeccion\b|\bfisio\b/, "salud"],
    [/\bno me (compensa|va bien|convence)\b|\bno em (compensa|va be|convenc)\b|\bpausa\b|\bcongelar\b/, "no le compensa"],
  ];
  const normR = (s) => sinMarcas((s || "").toLowerCase()).replace(/’/g, "'");
  const etiquetas = (txt) => [...new Set(PATRONES.filter(([p]) => p.test(normR(txt))).map(([, e]) => e))].sort();

  // chats = salida de wa-leer.js: [[tel, dia, hora, noLeidos, txt, nombreWA], ...]; ahora = "AAAA-MM-DD HH:MM"
  API.wa = async function (chatsIn, ahora, opts) {
    opts = opts || {};
    let data = parse(chatsIn);
    if (data && !Array.isArray(data)) data = data.chats || [];
    data = data.filter((r) => r && r[4] !== "Cargando…");
    const f = await ultimaFotoDoc();
    if (!f) return JSON.stringify({ error: "SIN_FOTO" });
    const rows = f.rows, hoy = ahora.slice(0, 10);
    const porTel = {};
    for (const [num, r] of Object.entries(rows)) if (r.t) porTel[r.t] = num;
    const casos = await all("socias");
    const riesgos = await all("riesgos");
    const resumen = {}, riesgoRes = {};
    for (const row of data) {
      const [tel, dia, hora, nl, txt] = row;
      const num = porTel[tel];
      if (!num || cortesia(txt)) continue;
      const r = rows[num];
      if (r.pb || r.nc || dia < r.u) continue;
      const c = casos[num];
      const pv = (c || {}).ultWA || {};
      if (pv.txt === txt && pv.dia === dia) continue;
      const nuevo = { dia, hora: hora || "", txt, noLeidos: nl, leido: ahora };
      if (!opts.dryRun) { if (c) await upd("socias", num, { ultWA: nuevo }); else await set("socias", num, { ultWA: nuevo }); }
      resumen[num] = { nombre: r.n, txt };
    }
    for (const row of data) {
      const [tel, dia, hora, , txt] = row;
      const nombreWA = row.length > 5 ? row[5] : "";
      if (EXCLUIR.has(tel) || !txt || txt.startsWith("[Audio") || txt === "Foto") continue;
      const et = etiquetas(txt);
      if (!et.length) continue;
      const num = Object.prototype.hasOwnProperty.call(porTel, tel) ? porTel[tel] : null;
      const r = num ? rows[num] : null;
      if (r && !r.nc && !r.pb && diff(hoy, r.u) >= 6) continue; // MIA: ya sale en "Han contestado"
      const pv = riesgos[tel];
      if (pv && pv.txt === txt && pv.dia === dia) continue;
      const doc = { tel, nombre: (r ? r.n : "") || nombreWA, nombreWA, num: num || "", dia, hora: hora || "", txt,
        palabras: et, detectado: ahora, estado: "pendiente" };
      if (!opts.dryRun) await set("riesgos", tel, doc);
      riesgoRes[tel] = { nombre: doc.nombre, txt, palabras: et, existia: !!pv };
    }
    return JSON.stringify({ respuestasNuevas: Object.keys(resumen).length, resumen, riesgosNuevos: Object.keys(riesgoRes).length, riesgos: riesgoRes });
  };

  /* ---------- Volcado al Histórico de OSE ---------- */
  let pendPatch = {};
  API.pendientesOSE = async function () {
    const g = await all("gestiones");
    pendPatch = {};
    const lista = [];
    for (const [id, x] of Object.entries(g)) {
      if (x.ose !== "pendiente") continue;
      let por = x.por, texto = x.textoOSE || "";
      if (por in AUSENCIAS && (x.dia || "") < AUSENCIAS[por]) {
        texto = texto.replace(`| ${por} |`, "| Eva |");
        pendPatch[id] = { por: "Eva", porOriginal: por, textoOSE: texto };
        por = "Eva";
      }
      lista.push({ id, num: x.num, dia: x.dia, hora: (x.fecha || "").slice(11, 16), por, canal: x.canal, textoOSE: texto });
      if (lista.length >= 200) break;
    }
    return JSON.stringify(lista);
  };
  // resultados = salida de OSE.volcar(...) (puede ser la unión de varios lotes); ahora = "AAAA-MM-DD HH:MM"
  API.marcarVolcadas = async function (resultadosIn, ahora) {
    const res = parse(resultadosIn);
    let ok = 0, err = 0, sesion = false;
    for (const r of res) {
      if (r.ok) { await upd("gestiones", r.id, { ose: "volcada", oseFecha: ahora, ...(pendPatch[r.id] || {}) }); ok++; }
      else if (String(r.error || "").includes("SESION_OSE_CADUCADA")) { sesion = true; }
      else { await upd("gestiones", r.id, { ose: "error", oseMsg: String(r.error || "error") }); err++; }
    }
    return JSON.stringify({ volcadas: ok, errores: err, sesionCaducada: sesion });
  };

  /* ---------- Mensajes personales (mensajes.py) ---------- */
  API.guardarMensajes = async function (mapaIn, hoy) {
    const mapa = parse(mapaIn);
    const f = await ultimaFotoDoc();
    let n = 0;
    for (const [num, texto] of Object.entries(mapa)) {
      if (!f.rows[num]) continue;
      const u = f.rows[num].u;
      await set("mensajes", `${num}-${u}`, { num, caseUlt: u, texto, escrito: hoy });
      n++;
    }
    return n + " mensajes guardados";
  };

  /* ---------- Limpieza de fotos del día (CHECK paso 8) ---------- */
  // Deja de HOY la foto más antigua (base de la mañana) y la más reciente; borra las de en medio y sus informes.
  API.limpiezaHoy = async function (hoy) {
    const deHoy = (await ids("snapshots")).filter((id) => id.startsWith(hoy + "T")).sort();
    const borrar = deHoy.slice(1, -1);
    const infIds = new Set(await ids("informes"));
    for (const id of borrar) { await del("snapshots", id); if (infIds.has(id)) await del("informes", id); }
    return JSON.stringify({ borradas: borrar });
  };

  /* ---------- Condiciones de las MIA de Eva (RUNBOOK 7d) ---------- */
  API.condicionesPendientes = async function (hoy) {
    const f = await ultimaFotoDoc();
    const casos = await all("socias");
    const out = [];
    for (const [num, r] of Object.entries(f.rows)) {
      const c = casos[num] || {};
      const dias = diff(hoy, r.u);
      if (r.pb || r.nc || c.estado === "excluida" || dias < MIN_DIAS) continue;
      const sc = (c.caseUlt || c.ultEntreno) === r.u;
      const deEva = (sc && c.escalada) || c.ownerManual === "Eva" || c.ownerManual === "Viviana" || dias > 30;
      if (!deEva) continue;
      const leido = c.condiciones && c.condiciones.leido;
      if (!leido || diff(hoy, leido) > 7) out.push(num);
    }
    return JSON.stringify(out);
  };
  // lineas = "num|oferta|importe|inicioCompromiso|inicioOferta|formaPago|proximoPago" (una por línea, o array)
  API.guardarCondiciones = async function (lineasIn, hoy) {
    const lineas = Array.isArray(lineasIn) ? lineasIn : String(lineasIn).split("\n");
    let n = 0;
    for (const l of lineas) {
      const p = l.split("|");
      if (p.length < 7 || !/^\d+$/.test(p[0].trim())) continue;
      const [num, oferta, importe, inicioCompromiso, inicioOferta, formaPago, proximoPago] = p.map((x) => x.trim());
      await merge("socias", num, { condiciones: { oferta, importe, inicioCompromiso, inicioOferta, formaPago, proximoPago, leido: hoy } });
      n++;
    }
    return n + " condiciones guardadas";
  };

  /* ---------- estado/* (avisos una vez al día) ---------- */
  API.estadoGet = async (id) => JSON.stringify(await one("estado", id));
  API.estadoSet = async (id, data) => { await set("estado", id, parse(data)); return "ok"; };

  /* ---------- Limpieza mensual (pedir confirmación a Eva antes) ---------- */
  API.limpiezaMensualPreview = async function (hoy) {
    const limite = addDays(hoy, -30);
    const viejas = (await ids("snapshots")).filter((id) => id.slice(0, 10) < limite);
    const f = await ultimaFotoDoc();
    const vivos = new Set(Object.entries(f ? f.rows : {}).map(([n, r]) => `${n}-${r.u}`));
    const msgs = (await ids("mensajes")).filter((id) => !vivos.has(id));
    return JSON.stringify({ snapshots: viejas, mensajes: msgs });
  };
  API.limpiezaMensual = async function (hoy) {
    const p = JSON.parse(await API.limpiezaMensualPreview(hoy));
    for (const id of p.snapshots) await del("snapshots", id);
    for (const id of p.mensajes) await del("mensajes", id);
    return JSON.stringify({ snapshots: p.snapshots.length, mensajes: p.mensajes.length });
  };

  API._internals = { analizar, cortesia, etiquetas, addWorkdays, pyRound, nm };
  window.MIASYNC = API;
})();
