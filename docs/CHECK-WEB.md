# Comprobación cada hora (versión web): respuestas de WhatsApp, socias que ya han venido y respuestas apuntadas en OSE

App: https://retencionsocias.vercel.app (Supabase). Motor: pestaña «MIA web» = https://retencionsocias.vercel.app/sync (ver RUNBOOK-WEB.md, apartado «Pestaña MIA web»). La app antigua de Claude está congelada: NO usar ArtifactData para MIA.
Solo lectura de OSE: NO se vuelca nada al Histórico ni se escriben mensajes (eso lo hace la sincronización completa de 7:40 y 21:40).

URL de acceso a OSE (Eva pide que vaya SIEMPRE en el aviso cuando haya que entrar): https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx

## Pasos
1. `project_read` de `claude/mia-sync/ose-sync.js`, `ose-respuestas.js`, `ose-keepalive.js`, `wa-leer.js` y `claude/mia-sync/RUNBOOK-WEB.md` (apartado «Pestaña MIA web»). HOY = fecha local Europe/Madrid (YYYY-MM-DD), HORA = HH:MM local, AHORA = «HOY HORA».
2. Pestaña «MIA web» (RUNBOOK-WEB). Si `SIN_SESION`: avisar a Eva SOLO en la ejecución de las 8:07 y en la de las 15:07 (PushNotification + SendUserMessage: «La web MIA ha cerrado la sesión: entra en https://retencionsocias.vercel.app/sync en el navegador de Claude con tu usuario para que la sincronización siga funcionando.»); en las demás terminar en silencio.
3. Respuestas de WhatsApp (se hace SIEMPRE, antes de OSE, aunque OSE esté caducado):
   - Claude in Chrome (ToolSearch `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool`). `tabs_context_mcp` con `createIfEmpty: true`; si en el grupo ya hay una pestaña de web.whatsapp.com, usarla; si no, `navigate` a https://web.whatsapp.com en la pestaña del grupo. NUNCA abrir un chat, escribir ni enviar nada en WhatsApp: solo se lee la lista de chats.
   - Pegar `wa-leer.js` entero en `javascript_tool`. Si devuelve el JSON, úsalo tal cual. Si devuelve `LARGO n`, el JSON está en `window.__wa`: leerlo por trozos (`window.__wa.slice(0,900)`, `slice(900,1800)`…) y juntarlo exacto.
   - MIA web: `await MIASYNC.wa(<ese JSON>, 'AHORA')` → `{respuestasNuevas, riesgosNuevos, ...}` (guarda `ultWA` en las socias MIA que han contestado y los posibles riesgos de baja de cualquier socia; quita solo las filas «Cargando…»). NO se avisa a Eva por los riesgos (lo ve en la app) y NO se escribe nada en OSE.
   - Si Chrome no responde: seguir en silencio. Si devuelve `WHATSAPP_SIN_SESION`: MIA web `await MIASYNC.estadoGet('waCaducada')`; si es null o su `fecha` ≠ HOY, `await MIASYNC.estadoSet('waCaducada', {fecha:'HOY', hora:'HORA'})` y PushNotification: «WhatsApp Web se ha desconectado: abre web.whatsapp.com en Chrome y escanea el QR con el móvil del club para que la app MIA siga recogiendo las respuestas.» Si ya se avisó hoy, seguir en silencio.
4. OSE en el navegador integrado: `tabs_context`; si hay una pestaña de `sys.oseurope.com` que NO esté en la pantalla de login, usarla SIN navegar. Solo si no hay ninguna, abrir https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx. Si el navegador no responde: terminar en silencio.
   - Pantalla de login: NO teclear nada. MIA web `await MIASYNC.estadoGet('oseCaducada')`; si es null o su `fecha` ≠ HOY: `await MIASYNC.estadoSet('oseCaducada', {fecha:'HOY', hora:'HORA'})` y PushNotification + SendUserMessage: «La sesión de OSE ha caducado: entra en OSE en el navegador de Claude (https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx) para que la lista MIA siga quitando a las que vienen.» Si ya se avisó hoy, terminar en silencio.
4b. Mantener viva la sesión: en la pestaña de OSE, `JSON.stringify(window.__oseKA||null)`. Si es `null`, `caducada` es true o `ultimo` tiene más de 10 minutos, pegar `ose-keepalive.js` entero (debe devolver «KEEPALIVE activo (cada 8 min)»). No navegar después esa pestaña.
5. Pegar `ose-sync.js` ('OSE listo') y `ose-respuestas.js` en la pestaña de OSE.
6. MIA web `await MIASYNC.prevkeys()` → cadena; OSE `await OSE.extraerDelta('<cadena>')` → delta.
7. Respuestas apuntadas a mano en OSE: OSE `await OSE.llamadas('<HOY-2>', 'HOY', window.__ext.socias.filter(s=>!s[8]).map(s=>[s[1],s[3]]))` → llamadas.
8. Si el delta trae `changed` y `gone` vacíos: no hay cambios en la foto → saltar al paso 10.
9. MIA web: `await MIASYNC.sync(<delta>, <llamadas>, 'HOY', 'HORA')` (si lanza `RECONSTRUCCION`, repetir 6 con `extraerDelta('')`) y después `await MIASYNC.limpiezaHoy('HOY')`.
10. MIA web: `await MIASYNC.respuestas(<llamadas>, 'HOY')`.
11. Silencio salvo que algo falle (OSE caído, error del motor, web sin sesión): entonces PushNotification con qué ha fallado y qué hace falta.

## Reglas
- Nunca escribir en OSE ni teclear credenciales (ni de OSE, ni de la web MIA, ni de Supabase).
- WhatsApp: solo leer la lista de chats. Nunca abrir chats, escribir ni enviar.
- Esta comprobación no toca `gestiones` ni `mensajes`.
