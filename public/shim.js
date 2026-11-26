/*
 * MIA Sant Cugat — capa de datos sobre Supabase.
 * La app original usa window.claude.use("db") (API tipo Firestore).
 * Este archivo implementa esa misma API sobre la tabla `docs` de Supabase,
 * con login (Supabase Auth) y tiempo real, para que la app funcione igual fuera de Claude.
 */
(function () {
  "use strict";
  const cfg = window.MIA_CONFIG || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.insertAdjacentHTML("afterbegin",
        '<div style="background:#b3261e;color:#fff;padding:12px;font:600 14px system-ui">Falta configurar SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.</div>');
    });
    window.claude = { use: async () => null };
    return;
  }
  const sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  window.MIA_SB = sb;

  /* ---------- Login ---------- */
  const CSS = `
  #mia-login{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(160deg,#ece6f7,#f6e9f2);font-family:"Nunito Sans",system-ui,sans-serif}
  #mia-login form{background:#fff;border-radius:18px;padding:28px 24px;width:min(92vw,360px);
    box-shadow:0 10px 40px rgba(90,40,120,.18);display:flex;flex-direction:column;gap:12px}
  #mia-login h2{margin:0;color:#5b2a86;font:900 22px "Nunito",system-ui}
  #mia-login small{color:#7a6a8a}
  #mia-login input{font:16px inherit;padding:12px;border:1px solid #d8cfe6;border-radius:10px}
  #mia-login button{font:800 16px "Nunito",system-ui;padding:12px;border:0;border-radius:10px;background:#a3238e;color:#fff;cursor:pointer}
  #mia-login .err{color:#b3261e;font-size:14px;min-height:1em}
  #mia-logout{position:fixed;right:10px;bottom:70px;z-index:50;font:600 12px system-ui;background:#fff;
    border:1px solid #d8cfe6;border-radius:999px;padding:6px 10px;color:#5b2a86;cursor:pointer;opacity:.8}`;

  function injectCss() {
    if (document.getElementById("mia-shim-css")) return;
    const st = document.createElement("style");
    st.id = "mia-shim-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function domReady() {
    return document.readyState === "loading"
      ? new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }))
      : Promise.resolve();
  }
  function showLogout() {
    if (document.getElementById("mia-logout")) return;
    const b = document.createElement("button");
    b.id = "mia-logout";
    b.type = "button";
    b.textContent = "Salir";
    b.onclick = async () => { await sb.auth.signOut(); location.reload(); };
    document.body.appendChild(b);
  }

  let sessionPromise = null;
  function ensureSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      const { data } = await sb.auth.getSession();
      await domReady();
      injectCss();
      if (data && data.session) { showLogout(); return data.session; }
      return await new Promise((resolve) => {
        const wrap = document.createElement("div");
        wrap.id = "mia-login";
        wrap.innerHTML =
          '<form autocomplete="on"><h2>Socias MIA</h2><small>Curves Sant Cugat · entra con tu usuario</small>' +
          '<input type="email" name="email" placeholder="Email" required autocomplete="username">' +
          '<input type="password" name="password" placeholder="Contraseña" required autocomplete="current-password">' +
          '<button type="submit">Entrar</button><div class="err" role="alert"></div></form>';
        document.body.appendChild(wrap);
        const form = wrap.querySelector("form");
        const err = wrap.querySelector(".err");
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          err.textContent = "";
          const btn = form.querySelector("button");
          btn.disabled = true;
          const { data: d, error } = await sb.auth.signInWithPassword({
            email: form.email.value.trim(), password: form.password.value,
          });
          btn.disabled = false;
          if (error) { err.textContent = "Email o contraseña incorrectos."; return; }
          wrap.remove();
          showLogout();
          resolve(d.session);
        });
      });
    })();
    return sessionPromise;
  }

  /* ---------- Utilidades ---------- */
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function getPath(o, p) {
    if (!p.includes(".")) return o == null ? undefined : o[p];
    return p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
  }
  function setPath(o, p, v) {
    const ks = p.split(".");
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) {
      if (!isObj(cur[ks[i]])) cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    if (v === undefined) delete cur[ks[ks.length - 1]];
    else cur[ks[ks.length - 1]] = v;
  }
  function deepMerge(a, b) {
    const out = isObj(a) ? clone(a) : {};
    for (const k of Object.keys(b || {})) {
      if (b[k] === undefined) continue;
      out[k] = isObj(b[k]) && isObj(out[k]) ? deepMerge(out[k], b[k]) : clone(b[k]);
    }
    return out;
  }
  function newId() {
    const c = "abcdefghijklmnopqrstuvwxyz0123456789";
    const a = new Uint8Array(20);
    crypto.getRandomValues(a);
    return Array.from(a, (x) => c[x % c.length]).join("");
  }
  function mkErr(error) {
    const e = new Error((error && error.message) || "Error de base de datos");
    const code = error && (error.code || "");
    e.code = code === "42501" || /permission|row-level security|JWT/i.test(e.message)
      ? "invalid_argument" : code === "PGRST116" ? "not_found" : "unavailable";
    e.cause = error;
    return e;
  }
  function cmp(a, b) {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
    if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
    const sa = typeof a === "string" ? a : JSON.stringify(a);
    const sb2 = typeof b === "string" ? b : JSON.stringify(b);
    return sa < sb2 ? -1 : sa > sb2 ? 1 : 0;
  }
  function test(v, op, x) {
    switch (op) {
      case "==": return JSON.stringify(v) === JSON.stringify(x);
      case "!=": return v !== undefined && JSON.stringify(v) !== JSON.stringify(x);
      case "<": return v !== undefined && v !== null && cmp(v, x) < 0;
      case "<=": return v !== undefined && v !== null && cmp(v, x) <= 0;
      case ">": return v !== undefined && v !== null && cmp(v, x) > 0;
      case ">=": return v !== undefined && v !== null && cmp(v, x) >= 0;
      case "in": return Array.isArray(x) && x.some((y) => JSON.stringify(y) === JSON.stringify(v));
      case "not-in": return Array.isArray(x) && v !== undefined && !x.some((y) => JSON.stringify(y) === JSON.stringify(v));
      case "array-contains": return Array.isArray(v) && v.some((y) => JSON.stringify(y) === JSON.stringify(x));
      case "array-contains-any": return Array.isArray(v) && Array.isArray(x) && v.some((y) => x.some((z) => JSON.stringify(z) === JSON.stringify(y)));
      default: throw Object.assign(new Error("Operador no soportado: " + op), { code: "invalid_argument" });
    }
  }

  /* ---------- Caché por colección + tiempo real ---------- */
  const colls = new Map(); // name -> {rows: Map(id -> {data, version}), loaded: Promise, listeners: Set}
  function coll(name) {
    let c = colls.get(name);
    if (!c) { c = { rows: new Map(), loaded: null, listeners: new Set(), timer: null }; colls.set(name, c); }
    return c;
  }
  async function load(name) {
    const c = coll(name);
    if (c.loaded) return c.loaded;
    c.loaded = (async () => {
      await ensureSession();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from("docs").select("id,data,version")
          .eq("collection", name).order("id").range(from, from + PAGE - 1);
        if (error) { c.loaded = null; throw mkErr(error); }
        for (const r of data) c.rows.set(r.id, { data: r.data || {}, version: r.version || 1 });
        if (data.length < PAGE) break;
      }
    })();
    return c.loaded;
  }
  function notify(name) {
    const c = coll(name);
    if (c.timer) return;
    c.timer = setTimeout(() => {
      c.timer = null;
      for (const l of c.listeners) { try { l(); } catch (e) { console.error(e); } }
    }, 30);
  }
  let channelStarted = false;
  function startRealtime() {
    if (channelStarted) return;
    channelStarted = true;
    sb.channel("mia-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, (p) => {
        const row = p.eventType === "DELETE" ? p.old : p.new;
        if (!row || !row.collection || !colls.has(row.collection)) return;
        const c = coll(row.collection);
        if (p.eventType === "DELETE") c.rows.delete(row.id);
        else {
          const cur = c.rows.get(row.id);
          if (!cur || (row.version || 0) >= cur.version) c.rows.set(row.id, { data: row.data || {}, version: row.version || 1 });
        }
        notify(row.collection);
      })
      .subscribe((status) => {
        // Si se corta la conexión, recargar colecciones al reconectar.
        if (status === "SUBSCRIBED") {
          for (const [name, c] of colls) if (c.listeners.size) {
            c.loaded = null;
            load(name).then(() => notify(name)).catch(() => {});
          }
        }
      });
  }

  /* ---------- Snapshots ---------- */
  function docSnap(id, row) {
    return {
      id, exists: !!row,
      data: () => (row ? clone(row.data) : undefined),
      get: (f) => (row ? clone(getPath(row.data, f)) : undefined),
    };
  }
  function querySnap(list) {
    const docs = list.map(([id, row]) => docSnap(id, row));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
  }

  /* ---------- Query ---------- */
  function Query(name, wh, ord, lim) {
    this._n = name; this._w = wh || []; this._o = ord || []; this._l = lim;
  }
  Query.prototype.where = function (f, op, v) { return new Query(this._n, this._w.concat([[f, op, v]]), this._o, this._l); };
  Query.prototype.orderBy = function (f, dir) { return new Query(this._n, this._w, this._o.concat([[f, dir === "desc" ? -1 : 1]]), this._l); };
  Query.prototype.limit = function (n) { return new Query(this._n, this._w, this._o, n); };
  Query.prototype._run = function () {
    const c = coll(this._n);
    let list = [...c.rows.entries()].filter(([, r]) =>
      this._w.every(([f, op, v]) => test(getPath(r.data, f), op, v)) &&
      this._o.every(([f]) => getPath(r.data, f) !== undefined));
    list.sort((a, b) => {
      for (const [f, d] of this._o) { const k = cmp(getPath(a[1].data, f), getPath(b[1].data, f)); if (k) return k * d; }
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    if (this._l != null) list = list.slice(0, this._l);
    return querySnap(list);
  };
  Query.prototype.get = async function () { await load(this._n); return this._run(); };
  Query.prototype.onSnapshot = function (next, errCb) {
    const c = coll(this._n);
    const fire = () => { try { next(this._run()); } catch (e) { if (errCb) errCb(e); else console.error(e); } };
    let alive = true;
    const l = () => { if (alive) fire(); };
    c.listeners.add(l);
    startRealtime();
    load(this._n).then(() => alive && fire()).catch((e) => { if (errCb) errCb(e); else console.error(e); });
    return () => { alive = false; c.listeners.delete(l); };
  };

  function Collection(name) { Query.call(this, name); }
  Collection.prototype = Object.create(Query.prototype);
  Collection.prototype.doc = function (id) { return new DocRef(this._n, id || newId()); };
  Collection.prototype.add = async function (data) {
    const ref = new DocRef(this._n, newId());
    await ref.set(data);
    return ref;
  };

  /* ---------- Documentos ---------- */
  function DocRef(name, id) { this._n = name; this.id = id; this.path = name + "/" + id; }
  DocRef.prototype._fetch = async function () {
    const { data, error } = await sb.from("docs").select("data,version")
      .eq("collection", this._n).eq("id", this.id).maybeSingle();
    if (error) throw mkErr(error);
    return data ? { data: data.data || {}, version: data.version || 1 } : null;
  };
  DocRef.prototype.get = async function () {
    await ensureSession();
    const row = await this._fetch();
    if (row) coll(this._n).rows.set(this.id, row);
    return docSnap(this.id, row);
  };
  DocRef.prototype._write = async function (mutate) {
    await ensureSession();
    const c = coll(this._n);
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = await this._fetch();
      const next = clone(mutate(cur ? clone(cur.data) : null));
      if (!cur) {
        const { error } = await sb.from("docs").insert({ collection: this._n, id: this.id, data: next, version: 1 });
        if (!error) { c.rows.set(this.id, { data: next, version: 1 }); notify(this._n); return; }
        if (error.code === "23505") continue; // alguien lo creó a la vez: reintentar
        throw mkErr(error);
      }
      const { data, error } = await sb.from("docs").update({ data: next, version: cur.version + 1 })
        .eq("collection", this._n).eq("id", this.id).eq("version", cur.version).select("version");
      if (error) throw mkErr(error);
      if (data && data.length) { c.rows.set(this.id, { data: next, version: cur.version + 1 }); notify(this._n); return; }
      // conflicto de versión: otra persona guardó a la vez; reintentar sobre lo último
    }
    throw Object.assign(new Error("Otra persona está guardando esta ficha. Vuelve a intentarlo."), { code: "aborted" });
  };
  DocRef.prototype.set = function (data, opts) {
    return this._write((cur) => (opts && opts.merge ? deepMerge(cur || {}, data) : clone(data)));
  };
  DocRef.prototype.update = function (a, b) {
    const patch = typeof a === "string" ? { [a]: b } : a;
    return this._write((cur) => {
      if (!cur) throw Object.assign(new Error("No existe el documento " + this.path), { code: "not_found" });
      for (const k of Object.keys(patch)) setPath(cur, k, clone(patch[k]));
      return cur;
    });
  };
  DocRef.prototype.delete = async function () {
    await ensureSession();
    const { error } = await sb.from("docs").delete().eq("collection", this._n).eq("id", this.id);
    if (error) throw mkErr(error);
    coll(this._n).rows.delete(this.id);
    notify(this._n);
  };
  DocRef.prototype.onSnapshot = function (next, errCb) {
    const self = this;
    return new Query(this._n).onSnapshot((q) => {
      const d = q.docs.find((x) => x.id === self.id);
      next(d || docSnap(self.id, null));
    }, errCb);
  };

  function splitPath(p) {
    const s = String(p).split("/").filter(Boolean);
    if (s.length < 2 || s.length % 2) throw Object.assign(new Error("Ruta de documento no válida: " + p), { code: "invalid_argument" });
    return [s.slice(0, -1).join("/"), s[s.length - 1]];
  }

  const db = Object.freeze({
    collection: (name) => new Collection(name),
    doc: (path) => { const [n, id] = splitPath(path); return new DocRef(n, id); },
  });

  window.claude = Object.freeze({
    use: async (name) => {
      if (name === "db") { await ensureSession(); return db; }
      // "sample" (sugerencias y traducciones con Claude) no está disponible fuera de Claude.
      return null;
    },
  });
})();
