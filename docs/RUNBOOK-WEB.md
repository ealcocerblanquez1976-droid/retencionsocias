# Sincronización MIA ↔ OSE — versión web (Curves Sant Cugat)

Desde el 26/11/2026 la app de las entrenadoras es la WEB: https://retencionsocias.vercel.app (datos en Supabase, proyecto `supabase-retencionsocias`). La app antigua de Claude (artefacto) está congelada: NO se lee ni se escribe en su base de datos (nada de ArtifactData para MIA).

Toda la lógica que antes hacían `sync.py`, `respuestas.py`, `wa.py`, `riesgo.py`, `mensajes.py`, `prevkeys.py` y `nombres.py` vive ahora en la propia web, en la página **https://retencionsocias.vercel.app/sync** (pestaña «MIA web» del navegador integrado), como `window.MIASYNC`. La tarea solo lee OSE / WhatsApp y le pasa lo leído. Desde el espacio de trabajo de Claude no hay acceso a Supabase: todo pasa por esa pestaña.

URL de acceso a OSE (Eva pide que vaya SIEMPRE en el aviso cuando haya que entrar): https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx

Colecciones (tabla `docs` de Supabase, mismas que antes): `socias/<num>`, `gestiones/<id>` (`ose`: pendiente | volcada | error), `snapshots/<YYYY-MM-DDTHHMM>`, `informes/<id>`, `vueltas/<num>-<abiertaDesde>`, `mensajes/<num>-<ultEntreno>`, `riesgos/<tel>`, `estado/<clave>`.

Archivos del kit que siguen haciendo falta (Proyecto, `claude/mia-sync/`): `ose-sync.js`, `ose-respuestas.js`, `ose-condiciones.js`, `ose-keepalive.js`, `wa-leer.js`. Código del motor: repo GitHub `ealcocerblanquez1976-droid/retencionsocias`, `public/sync.js` (copia en el Proyecto: `claude/mia-vercel/sync.js`).

Reglas de negocio (sin cambios): ver la sección «Reglas MIA», «Ausencias», «ESTILO de los mensajes personales» y «Reglas» más abajo.

## Pestaña «MIA web» (paso común a todas las tareas)
1. Navegador integrado (skill `built-in-browser`; ToolSearch `mcp__remote-devices__Claude_Browser__`, max_results 64). `tabs_context`: si hay una pestaña en `retencionsocias.vercel.app/sync`, úsala; si no, `preview_start` con https://retencionsocias.vercel.app/sync.
2. `javascript_tool`: `await new Promise(r=>setTimeout(r,1500)); typeof MIASYNC==='object' ? await MIASYNC.estado() : 'CARGANDO'`.
   - `OK <email>` → seguir.
   - `SIN_SESION` (sale la pantalla de login): NO teclear nada. Avisar a Eva (PushNotification + SendUserMessage): «La web MIA ha cerrado la sesión: entra en https://retencionsocias.vercel.app/sync en el navegador de Claude con tu usuario para que la sincronización siga funcionando.» y terminar.
   - `CARGANDO`: esperar 3 s y repetir una vez; si sigue, avisar de que la web no carga y terminar.
3. Todas las llamadas a `MIASYNC.*` devuelven texto (JSON). Los parámetros JSON se pasan como texto entre comillas simples o como objeto literal. Si un texto lleva comillas simples, pasarlo con plantilla `String.raw` o como objeto.

## Pasos de la sincronización completa (7:40 y 21:40)
1. `project_read` de `ose-sync.js`, `ose-respuestas.js`, `ose-condiciones.js`. HOY = fecha local Europe/Madrid (YYYY-MM-DD), HORA = HH:MM local, AHORA = «HOY HORA».
2. Pestaña «MIA web» (arriba).
3. OSE en el navegador integrado: `tabs_context`; usar una pestaña de `sys.oseurope.com` que NO esté en la pantalla de login, sin navegar. Si no hay ninguna, abrir https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx.
   - Pantalla de login (Nº franquicia / Contraseña): NO teclear credenciales. SendUserMessage: «La sesión de OSE ha caducado. Entra en OSE en el navegador de Claude (panel lateral) en https://sys.oseurope.com/CISCentral/SYS/Main/OSELogin.aspx y dime 'dentro'.» y terminar.
   - Pegar en la pestaña de OSE `ose-sync.js` ('OSE listo'), `ose-respuestas.js` ('respuestas listo') y `ose-condiciones.js` ('condiciones listo').
4. Volcar gestiones pendientes al Histórico de OSE:
   - MIA web: `await MIASYNC.pendientesOSE()` → lista `[{id, num, dia, hora, por, canal, textoOSE}]` (ya aplica las ausencias: las de una entrenadora ausente salen como Eva).
   - OSE: `await OSE.volcar([...])` en lotes de 10 con esos objetos tal cual.
   - MIA web: `await MIASYNC.marcarVolcadas(<todos los resultados juntos, como array>, 'AHORA')` → `{volcadas, errores, sesionCaducada}`. Si `sesionCaducada`: avisar como en el paso 3 y parar (las que faltan siguen pendientes).
5. Foto de OSE:
   - MIA web: `await MIASYNC.prevkeys()` → cadena.
   - OSE: `await OSE.extraerDelta('<cadena>')` → JSON del delta.
   - MIA web: `await MIASYNC.nombres()` → lista; OSE: `await OSE.llamadas('<HOY-90>', 'HOY', <lista>)` → llamadas.
   - MIA web: `await MIASYNC.sync(<delta>, <llamadas>, 'HOY', 'HORA')` → resumen `{snapshot, abiertas, nuevas, vueltas, faltanMensajes:[...], kpi, equipo:{w:[paraHoy, gestionesHoy, atrasadas]}, procesoBaja, pendientesOSE}`. Guarda foto, informe y vueltas nuevas.
     Si lanza `RECONSTRUCCION`: repetir con `OSE.extraerDelta('')` (todo cuenta como nuevo).
   - MIA web: `await MIASYNC.respuestas(<llamadas>, 'HOY')` → `{writes, nuevoEnOSE, lista, porEntrenadora}` (lo apuntado a mano en OSE; la app las pone en «Han contestado»).
6. Mensajes personales de las MIA nuevas (`faltanMensajes` del paso 5, si no está vacío):
   - OSE: `await OSE.contexto([[num, nombre], ...])` → últimas llamadas de OSE de cada una (90 días).
   - Redactar un mensaje para cada socia con su contexto (ficha, `ultimaApp`, llamadas de OSE) siguiendo el ESTILO de abajo.
   - MIA web: `await MIASYNC.guardarMensajes({num: texto, ...}, 'HOY')`.
7. Limpieza: MIA web `await MIASYNC.limpiezaHoy('HOY')` (deja de hoy la foto más antigua y la más reciente; borra las de en medio y sus informes).
8. Condiciones de las MIA de Eva (solo en la de la mañana): MIA web `await MIASYNC.condicionesPendientes('HOY')` → nums; OSE `await OSE.condicionesLista([...])` en lotes de 30 → líneas `num|oferta|importe|inicioCompromiso|inicioOferta|formaPago|proximoPago`; MIA web `await MIASYNC.guardarCondiciones(<líneas juntas, separadas por \n>, 'HOY')`. Nunca leer ni guardar datos de salud, DNI o cuenta bancaria.
9. Mensaje a Eva (SendUserMessage), 4–6 líneas: MIA abiertas, nuevas, han vuelto, gestiones volcadas/errores, han contestado sin clasificar (`respuestas.porEntrenadora`), atrasadas por entrenadora y el KPI que esté peor. Sin adornos.

## Limpieza mensual (pedir confirmación a Eva antes)
MIA web: `await MIASYNC.limpiezaMensualPreview('HOY')` → lo que se borraría (fotos de más de 30 días y mensajes de casos que ya no están en la foto). Solo con el sí de Eva: `await MIASYNC.limpiezaMensual('HOY')`.

## Reglas MIA (Eva, 09/11/2026)
Solo se gestionan desde 6 días sin venir (la foto de OSE sigue siendo de 4+ días). Reparto: 6-15 días Susana, 16-30 Manoli, 31+ Eva. De 6 a 15 días se manda WhatsApp directamente; desde 16 días, llamada primero y WhatsApp si no coge. Las escaladas (Riesgo de baja, Pasar a Eva, 3 sin respuesta, Cursar baja definitiva) van a Eva. Socias en proceso de baja en OSE (`pb`): no se gestionan como MIA.

Ausencias (`AUSENCIAS` en la app `public/index.html` y en el motor `public/sync.js`, siempre iguales): mientras dura la ausencia (hasta esa fecha, sin incluir), las MIA de esa entrenadora las lleva Eva. Vigentes: Viviana hasta el 27/11/2026. Cambiarlas = editar los dos archivos en el repo y hacer push (Vercel publica solo).

El club está CERRADO sábados y domingos: nunca proponer ni confirmar un sábado o domingo.

## ESTILO de los mensajes personales (Eva, 24/11/2026: aprobado este tono)
- Que suene a una persona de verdad escribiendo desde el móvil a alguien a quien aprecia, NO a una plantilla. Cálido, cercano y con alegría, sin presión. Cada mensaje distinto: NO repetir la misma estructura ni el mismo arranque entre socias.
- SIEMPRE decir quién escribe al principio con `Soy {yo}` (la app pone el nombre de la entrenadora). Lo que varía es el saludo de antes y la frase de después: "Hola Puriii! Soy {yo}.", "Hola Loli guapa! Soy {yo}.", "Ei Mireia! Soy {yo}.", "Hola Montse! Soy {yo}, ¿cómo estás?", "Hola Àngels, bon dia! Sóc {yo}." (en catalán, `Sóc {yo}`). NO decir "de Curves Sant Cugat".
- 2–3 frases cortas, máximo 300 caracteres. SIN EMOJIS. Tres puntos normales "...", no el carácter unido.
- Recursos humanos y variados: algo personal, empatía, un toque de humor suave de vez en cuando, ánimo sincero.
- Usa lo que sabemos (día que dijo, cómo sigue si estaba mal: "lo hacemos suavecito"), sin reproche si no contestó. Nunca nombres diagnósticos ni detalles médicos. En OSE "estudio" es el estudio corporal de Curves. La última gestión de la app solo vale si es de DESPUÉS de su último entreno.
- Catalán si la socia escribe en catalán. Diminutivo si la llaman así.
- De 6 a 15 días: sin revisión del entreno, solo cerrar el día. Desde 16 días: propón revisar juntas el entreno, salvo salud, cuidar a un familiar o viaje.
- Las socias en proceso de baja no llevan mensaje. Si habló de dejarlo o de dinero: mensaje de Eva pidiendo hablarlo con calma, sin bromas.
- Nunca ofrezcas pausa ni descuentos. Termina con una pregunta concreta. Nunca sábado ni domingo.

## Reglas
- Nunca escribir en OSE nada que no venga de una gestión registrada en la app.
- Nunca teclear contraseñas ni datos de acceso (ni de OSE ni de la web MIA ni de Supabase).
- Empleada en OSE: Susana, Manoli y Eva existen. Si Viviana no está dada de alta, `registrar` la apunta como Eva y añade "[hecha por Viviana…]".
- Las entradas ya volcadas al Histórico de OSE no se pueden editar; solo borrar. No borrar nada en OSE sin que Eva lo pida.
- No usar ArtifactData con la app MIA antigua: está congelada.
