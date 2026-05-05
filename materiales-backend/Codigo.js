// IU Materiales · v1.1 · 5 mayo 2026 · sesion persistente
// Subprograma de lista de la compra colaborativa.
// Backend autocontenido. Lectura compartida de IU Gestion.
// NO toca proyecto Gestion ni Gestion TEST.

var SS_LISTA   = '1Rfb08YSEV0ZCQNJ3BcMRKoibFsCWSvvMHftCWWzZaAk';
var SS_GESTION = '149oOxa3Xm23Xh2-Kd0BBChb0Hj0nun42ceIM7UPaYfo';
var TZ         = 'Europe/Madrid';

// ---------- entry points ----------

function doGet() {
  var t = HtmlService.createTemplateFromFile('index');
  t.scriptUrl = ScriptApp.getService().getUrl();
  return t.evaluate()
    .setTitle('IU Materiales')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return _json({ ok: false, error: 'JSON invalido' });
  }

  try {
    switch (body.action) {
      case 'getTrabajadores':  return _json(handleGetTrabajadores(body));
      case 'login':            return _json(handleLogin(body));
      case 'getMateriales':    return _json(handleGetMateriales(body));
      case 'crearMaterial':    return _json(handleCrearMaterial(body));
      case 'cerrarMateriales': return _json(handleCerrarMateriales(body));
      default: return _json({ ok: false, error: 'Accion desconocida' });
    }
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- handlers ----------

function handleGetTrabajadores() {
  var sh = _sheet(SS_GESTION, 'CONFIGURACION');
  var data = _readObjects(sh);
  var out = [];
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    var nombre = String(r['Nombre'] || '').trim();
    var idUrl  = String(r['ID_URL'] || '').trim();
    if (nombre && idUrl) out.push({ nombre: nombre, id_url: idUrl });
  }
  return { ok: true, trabajadores: out };
}

function handleLogin(body) {
  var user = _findUser(body.id);
  if (!user) return { ok: false, error: 'Usuario no encontrado' };
  if (String(user['PIN']) !== String(body.pin)) {
    return { ok: false, error: 'PIN incorrecto' };
  }
  var obrasSh = _sheet(SS_GESTION, 'OBRAS');
  var obrasData = _readObjects(obrasSh);
  var obras = [];
  for (var i = 0; i < obrasData.rows.length; i++) {
    var n = String(obrasData.rows[i]['Nombre'] || '').trim();
    if (n) obras.push(n);
  }
  return {
    ok: true,
    nombre: String(user['Nombre'] || '').trim(),
    id: String(user['ID_URL'] || '').trim(),
    puede_cerrar: _hasPermisoCompras(user),
    obras: obras
  };
}

function handleGetMateriales(body) {
  var user = _findUser(body.id);
  if (!user) return { ok: false, error: 'Usuario no encontrado' };

  var sh = _sheet(SS_LISTA, 'MATERIALES_LISTA');
  var data = _readObjects(sh);
  var idLower = String(user['ID_URL']).toLowerCase().trim();
  var puedeCerrar = _hasPermisoCompras(user);

  var items = [];
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    var estado = String(r['Estado'] || '').trim().toUpperCase();
    if (estado !== 'PENDIENTE') continue;

    var solicitante = String(r['Solicitante'] || '').trim();
    var fecha = r['Fecha_Solicitud'];
    items.push({
      id_solicitud:    String(r['ID_Solicitud'] || '').trim(),
      fecha_solicitud: _fmtDate(fecha),
      _ts:             fecha instanceof Date ? fecha.getTime() : 0,
      solicitante:     solicitante,
      articulo:        String(r['Articulo'] || '').trim(),
      cantidad:        String(r['Cantidad'] || '').trim(),
      obra_destino:    String(r['Obra_Destino'] || '').trim(),
      comentario:      String(r['Comentario'] || '').trim(),
      es_propia:       solicitante.toLowerCase() === idLower
    });
  }
  items.sort(function (a, b) { return b._ts - a._ts; });
  for (var j = 0; j < items.length; j++) delete items[j]._ts;

  var obrasSh = _sheet(SS_GESTION, 'OBRAS');
  var obrasData = _readObjects(obrasSh);
  var obras = [];
  for (var o = 0; o < obrasData.rows.length; o++) {
    var n = String(obrasData.rows[o]['Nombre'] || '').trim();
    if (n) obras.push(n);
  }

  return {
    ok: true,
    items: items,
    permisos: { puede_cerrar: puedeCerrar },
    nombre: String(user['Nombre'] || '').trim(),
    obras: obras
  };
}

function handleCrearMaterial(body) {
  var user = _findUser(body.id);
  if (!user) return { ok: false, error: 'Usuario no encontrado' };
  var articulo = String(body.articulo || '').trim();
  var cantidad = String(body.cantidad || '').trim();
  if (!articulo) return { ok: false, error: 'Articulo obligatorio' };
  if (!cantidad) return { ok: false, error: 'Cantidad obligatoria' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _sheet(SS_LISTA, 'MATERIALES_LISTA');
    var nextId = _nextId(sh);
    _appendByHeaders(sh, {
      'ID_Solicitud':    nextId,
      'Fecha_Solicitud': new Date(),
      'Solicitante':     String(user['ID_URL']).trim(),
      'Articulo':        articulo,
      'Cantidad':        cantidad,
      'Obra_Destino':    String(body.obra_destino || '').trim(),
      'Comentario':      String(body.comentario || '').trim(),
      'Estado':          'PENDIENTE',
      'Validador':       '',
      'Fecha_Validacion': ''
    });
    return { ok: true, id_solicitud: nextId };
  } finally {
    lock.releaseLock();
  }
}

function handleCerrarMateriales(body) {
  var user = _findUser(body.id);
  if (!user) return { ok: false, error: 'Usuario no encontrado' };

  var accion = String(body.accion || '').trim().toUpperCase();
  if (accion !== 'COMPLETADO' && accion !== 'CANCELADO') {
    return { ok: false, error: 'Accion invalida' };
  }
  var ids = body.ids;
  if (!Array.isArray(ids) || !ids.length) {
    return { ok: false, error: 'IDs vacios' };
  }
  var puedeCerrar = _hasPermisoCompras(user);
  if (accion === 'COMPLETADO' && !puedeCerrar) {
    return { ok: false, error: 'Sin permisos para completar' };
  }
  var idLower = String(user['ID_URL']).toLowerCase().trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _sheet(SS_LISTA, 'MATERIALES_LISTA');
    var data = _readObjects(sh);
    var headers = data.headers;
    var iEstado    = headers.indexOf('Estado');
    var iValidador = headers.indexOf('Validador');
    var iFechaVal  = headers.indexOf('Fecha_Validacion');
    if (iEstado < 0 || iValidador < 0 || iFechaVal < 0) {
      return { ok: false, error: 'Cabeceras faltan en MATERIALES_LISTA' };
    }

    var byId = {};
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      byId[String(r['ID_Solicitud']).trim()] = r;
    }

    var cerrados = 0;
    var errores = [];
    var now = new Date();

    for (var k = 0; k < ids.length; k++) {
      var id = String(ids[k]).trim();
      var row = byId[id];
      if (!row) { errores.push({ id: id, error: 'No existe' }); continue; }

      var estadoActual = String(row['Estado'] || '').trim().toUpperCase();
      if (estadoActual !== 'PENDIENTE') {
        errores.push({ id: id, error: 'Ya cerrada' });
        continue;
      }
      var esPropia = String(row['Solicitante'] || '').trim().toLowerCase() === idLower;
      if (accion === 'CANCELADO' && !puedeCerrar && !esPropia) {
        errores.push({ id: id, error: 'Sin permisos para cancelar' });
        continue;
      }

      var rowIdx = row._rowIndex;
      sh.getRange(rowIdx, iEstado    + 1).setValue(accion);
      sh.getRange(rowIdx, iValidador + 1).setValue(String(user['ID_URL']).trim());
      sh.getRange(rowIdx, iFechaVal  + 1).setValue(now);
      cerrados++;
    }

    return { ok: true, cerrados: cerrados, errores: errores, accion: accion };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

function _sheet(ssId, name) {
  var ss = SpreadsheetApp.openById(ssId);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Pestania no existe: ' + name);
  return sh;
}

function _readObjects(sh) {
  var values = sh.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i];
    var obj = { _rowIndex: i + 1 };
    for (var j = 0; j < headers.length; j++) obj[headers[j]] = raw[j];
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function _appendByHeaders(sh, obj) {
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var k = String(headers[i]).trim();
    row.push(obj.hasOwnProperty(k) ? obj[k] : '');
  }
  sh.appendRow(row);
}

function _findUser(id) {
  if (!id) return null;
  var idLower = String(id).toLowerCase().trim();
  var sh = _sheet(SS_GESTION, 'CONFIGURACION');
  var data = _readObjects(sh);
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    if (String(r['ID_URL'] || '').toLowerCase().trim() === idLower) return r;
  }
  return null;
}

function _hasPermisoCompras(user) {
  return String(user['Permisos_Compras'] || '').trim().toUpperCase() === 'SI';
}

function _nextId(sh) {
  var data = _readObjects(sh);
  var max = 0;
  for (var i = 0; i < data.rows.length; i++) {
    var v = String(data.rows[i]['ID_Solicitud'] || '').trim();
    var m = /^M(\d+)$/i.exec(v);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  var next = max + 1;
  var s = String(next);
  while (s.length < 4) s = '0' + s;
  return 'M' + s;
}

function _fmtDate(d) {
  if (!(d instanceof Date)) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm');
}
