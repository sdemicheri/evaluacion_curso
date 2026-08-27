(function() {
      var bodyId = document.body ? document.body.id : '';
  var enIntento = /^page-mod-quiz-(attempt|summary|review)/.test(bodyId);
  if (!enIntento) return;
      var style = document.createElement('style');
      style.textContent =
        '#ayd-overlay{display:none;position:fixed;inset:0;background:rgba(150,0,0,0.94);color:#fff;z-index:99999;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:20px;box-sizing:border-box;}' +
        '#ayd-overlay h2{font-size:1.6rem;margin-bottom:14px;font-weight:600;letter-spacing:0.3px;}' +
        '#ayd-overlay p{font-size:1.05rem;max-width:540px;line-height:1.5;}' +
        '#ayd-overlay #ayd-btnEntendido{margin-top:22px;padding:10px 28px;font-size:1rem;font-weight:600;background:#fff;color:#960000;border:none;border-radius:6px;cursor:pointer;}';
      document.head.appendChild(style);

      var overlay = document.createElement('div');
      overlay.id = 'ayd-overlay';
      overlay.innerHTML =
        '<h2 id="ayd-overlayTitulo">Aviso de integridad acad\u00e9mica</h2>' +
        '<p id="ayd-overlayMensaje"></p>' +
        '<button id="ayd-btnEntendido" type="button">Entendido, continuar</button>';
      document.body.appendChild(overlay);

      document.getElementById('ayd-btnEntendido').addEventListener('click',
        function() {
          document.getElementById('ayd-overlay').style.display = 'none';
        });

      var GAS_URL =
        'https://script.google.com/macros/s/AKfycbxqYaRJpAaIYwKffqUWG-_Jsd7kWT5EYJAyTuVuTBWI0ITKEk-VNt3CGHd0EKrr_6I8/exec';
      var VERSION_SCRIPT = '1.5.5';
      var TOLERANCIA_MS = 2000;
      var blurTimeout = null;
      var yaEnviado = false;
      var payloadEnviado = false;
      var DEBUG_USUARIO = '';
      var incidentes = [];
      var audioCtx = null;
      var datosCacheados = {
        nombre: '',
        email: '',
        curso: '',
        cuestionario: '',
        pregunta_id: ''
      };

      function desbloquearAudio() {
        if (!audioCtx) {
          audioCtx = new(window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
      }
      document.addEventListener('pointerdown', desbloquearAudio);
      document.addEventListener('keydown', desbloquearAudio);

      function reproducirAlerta() {
        try {
          if (audioCtx && audioCtx.state !== 'closed') {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.6);
          }
        } catch (e) {}
        if (navigator.vibrate) {
          try {
            navigator.vibrate(300);
          } catch (e) {}
        }
      }

      /* ============ Extraccion de datos de la sesion de Moodle ============ */

      function texto(el) {
        return el ? (el.textContent || '').trim() : '';
      }

      function colapsarEspacios(t) {
        return t.split(' ').filter(function(s) {
          return s;
        }).join(' ');
      }

      function tituloPagina() {
        var t = document.title || '';
        t = t.split('&amp;').join('&').split('&nbsp;').join(' ');
        return colapsarEspacios(t);
      }

      function limpiarNombre(t) {
        t = t || '';
        var p = t.indexOf('(');
        if (p !== -1) t = t.substring(0, p);

        var antes = ['autentificado como', 'logged in as'];
        for (var i = 0; i < antes.length; i++) {
          var idxA = t.toLowerCase().indexOf(antes[i]);
          if (idxA !== -1) {
            t = t.substring(idxA + antes[i].length);
            break;
          }
        }

        var despues = ['log out', 'salir', 'cerrar sesion',
          'cerrar sesi\u00f3n', 'logout'
        ];
        for (var j = 0; j < despues.length; j++) {
          var idxD = t.toLowerCase().indexOf(despues[j]);
          if (idxD !== -1) {
            t = t.substring(0, idxD);
            break;
          }
        }

        return colapsarEspacios(t).trim();
      }

      function nombreValido(t) {
        if (!t) return false;
        if (t.length < 3 || t.length > 80) return false;
        if (t.indexOf('@') !== -1) return false;
        if (t.indexOf('://') !== -1) return false;
        var tl = t.toLowerCase();
        if (tl.indexOf('perfil') !== -1) return false;
        if (tl.indexOf('profile') !== -1) return false;
        if (tl.indexOf('mensaje') !== -1) return false;
        if (tl.indexOf('message') !== -1) return false;
        if (tl.indexOf('salir') !== -1) return false;
        if (tl.indexOf('logout') !== -1) return false;
        return true;
      }

      function obtenerNombreCompleto() {
        var params = new URLSearchParams(window.location.search);
        var desdeURL = params.get('nombre_completo');
        if (desdeURL) return limpiarNombre(decodeURIComponent(desdeURL.split(
          '+').join(' ')));

        var candidatos = [];

        function intentar(t) {
          var limpio = limpiarNombre(t);
          if (nombreValido(limpio) && candidatos.indexOf(limpio) === -1) {
            candidatos.push(limpio);
          }
        }

        var selectores = [
          '.usermenu .usertext',
          '.usermenu [data-region="user-menu"] .usertext',
          'header .usertext',
          '#page-header .usertext',
          '.usermenu .loggedinuser',
          '.loggedinuser',
          '.logininfo',
          '[data-region="user-menu"] .usertext',
          '.usertext',
          '[class*="usertext"]',
          '[class*="loggedinuser"]',
          '[class*="logininfo"]',
          '.usermenu',
          'header [class*="user-menu"]',
          'a[href*="user/profile.php"]'
        ];
        for (var i = 0; i < selectores.length; i++) {
          var nodos = document.querySelectorAll(selectores[i]);
          for (var n = 0; n < nodos.length; n++) intentar(texto(nodos[n]));
        }

        var imgs = document.querySelectorAll(
          'img.userpicture, header img.userpicture, .usermenu img.userpicture'
        );
        for (var j = 0; j < imgs.length; j++) {
          var alt = imgs[j].getAttribute('aria-label') || imgs[j]
            .getAttribute('alt') || imgs[j].getAttribute('title');
          if (alt) intentar(alt);
        }

        if (document.body) {
          var textoBody = document.body.innerText || document.body
            .textContent || '';
          var iNom = textoBody.indexOf('autentificado como');
          if (iNom === -1) iNom = textoBody.indexOf('logged in as');
          if (iNom !== -1) {
            var trozo = textoBody.substring(iNom).split('\n')[0];
            var fin = trozo.indexOf('(');
            if (fin !== -1) trozo = trozo.substring(0, fin);
            intentar(trozo);
          }
        }

        for (var k = 0; k < candidatos.length; k++) {
          if (nombreValido(candidatos[k])) return candidatos[k];
        }
        return '';
      }

      function dividirTitulo() {
        var t = tituloPagina();
        var em = String.fromCharCode(8212);
        var en = String.fromCharCode(8211);
        t = t.split(em).join('#').split(en).join('#').split(':').join('#')
          .split('-').join('#');
        return t.split('#').map(function(s) {
          return s.trim();
        }).filter(function(s) {
          return s;
        });
      }

      function itemsBreadcrumb() {
        return Array.prototype.slice.call(
          document.querySelectorAll(
            '.breadcrumb li, .breadcrumb .breadcrumb-item')
        ).map(function(el) {
          var a = el.querySelector('a[href]');
          return {
            texto: texto(el),
            href: a ? a.getAttribute('href') : ''
          };
        }).filter(function(i) {
          return i.texto;
        });
      }

      function obtenerCurso() {
        var items = itemsBreadcrumb();
        for (var j = 0; j < items.length; j++) {
          if (items[j].href.indexOf('course/view.php') !== -1) return items[j]
            .texto;
        }
        for (var i = 0; i < items.length; i++) {
          if (items[i].href.indexOf('/mod/quiz/') !== -1 && i > 0 && items[i -
              1].texto) {
            return items[i - 1].texto;
          }
        }
        var h1 = document.querySelector(
          '#page-header h1, .page-header-headings h1, header h1');
        if (h1 && texto(h1)) return texto(h1);
        var partes = dividirTitulo();
        if (partes.length > 1) return partes[0];
        return '';
      }

      function obtenerCuestionario() {
        var infoAct = document.querySelector(
          '[data-region="activity-information"] [data-activityname], [data-activityname]'
        );
        var nomAct = infoAct ? infoAct.getAttribute('data-activityname') : '';
        if (nomAct) return nomAct;

        var h2 = document.querySelector(
          '#maincontent h2, .activity-header h2');
        if (h2 && texto(h2)) return texto(h2);

        var items = itemsBreadcrumb();
        for (var i = 0; i < items.length; i++) {
          if (items[i].href.indexOf('/mod/quiz/') !== -1) return items[i]
            .texto;
        }
        for (var j = 0; j < items.length; j++) {
          var lt = items[j].texto.toLowerCase();
          var esIntento = lt.indexOf('intento') !== -1 || lt.indexOf(
            'attempt') !== -1 || lt.indexOf('revis') !== -1;
          if (esIntento && j > 0) return items[j - 1].texto;
        }
        var partes = dividirTitulo();
        if (partes.length > 1) return partes[1];
        var tit = tituloPagina();
        var par = tit.indexOf('(');
        if (par !== -1) tit = tit.substring(0, par);
        var barra = tit.indexOf('|');
        if (barra !== -1) tit = tit.substring(0, barra);
        tit = tit.trim();
        if (tit) return tit;
        return tituloPagina();
      }

      function esDigitos(t) {
        if (!t) return false;
        for (var i = 0; i < t.length; i++) {
          var c = t.charCodeAt(i);
          if (c < 48 || c > 57) return false;
        }
        return true;
      }

      function buscarQidEn(nodo) {
        var inputs = (nodo || document).querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          var vl = inputs[i].getAttribute('value') || '';
          var p = vl.indexOf('qid=');
          if (p !== -1) {
            var resto = vl.substring(p + 4);
            var fin = resto.indexOf('&');
            if (fin !== -1) resto = resto.substring(0, fin);
            if (esDigitos(resto)) return resto;
          }
        }
        return '';
      }

      function obtenerPregunta() {
        var contenedor = null;
        if (document.currentScript) {
          contenedor = document.currentScript.closest('.que');
        }
        if (!contenedor) contenedor = document.querySelector('.que');

        if (contenedor) {
          var qid = buscarQidEn(contenedor);
          if (qid) return qid;
          var id = contenedor.getAttribute('data-questionid');
          if (id && esDigitos(id)) return id;
          var queId = contenedor.getAttribute('id') || '';
          var piezas = queId.split('-');
          if (piezas.length > 1) {
            var ultima = piezas[piezas.length - 1];
            if (esDigitos(ultima)) return ultima;
          }
        }

        var qid2 = buscarQidEn(document.body);
        if (qid2) return qid2;

        return '';
      }

      function descodificarEntidades(s) {
        var out = '';
        var i = 0;
        while (i < s.length) {
          if (s.charAt(i) === '&' && s.charAt(i + 1) === '#') {
            var j = i + 2;
            var codigo = '';
            while (j < s.length && s.charAt(j) !== ';') {
              codigo += s.charAt(j);
              j++;
            }
            if (codigo.length > 0) {
              out += String.fromCharCode(parseInt(codigo, 10));
            }
            i = (j < s.length) ? j + 1 : j;
          } else {
            out += s.charAt(i);
            i++;
          }
        }
        return out;
      }

      function descodificarURL(s) {
        var out = '';
        var i = 0;
        while (i < s.length) {
          if (s.charAt(i) === '%' && i + 2 < s.length) {
            var hex = s.substring(i + 1, i + 3);
            var val = parseInt(hex, 16);
            if (!isNaN(val)) {
              out += String.fromCharCode(val);
              i += 3;
            } else {
              out += s.charAt(i);
              i++;
            }
          } else {
            out += s.charAt(i);
            i++;
          }
        }
        return out;
      }

      function obtenerUsuarioMoodle() {
        var cfg = window.M && window.M.cfg;
        if (!cfg || !cfg.userId) {
          DEBUG_USUARIO = 'SIN_USER_ID';
          return Promise.resolve(null);
        }
        var wwwroot = cfg.wwwroot || window.location.origin;
        var url = wwwroot + '/user/profile.php?id=' +
          encodeURIComponent(String(cfg.userId));
        return fetch(url)
          .then(function(r) {
            if (r.status !== 200) {
              DEBUG_USUARIO = 'PERFIL_STATUS=' + r.status;
              return null;
            }
            return r.text();
          })
          .then(function(html) {
            if (!html) return null;
            var nombre = '';
            var email = '';
            var titulo = '';
            var t = html.indexOf('<title>');
            if (t !== -1) {
              var cierre = html.indexOf('</title>', t);
              if (cierre !== -1) {
                titulo = descodificarEntidades(html.substring(t + 7,
                  cierre));
                var dosP = titulo.indexOf(':');
                nombre = (dosP === -1 ? titulo : titulo.substring(0, dosP))
                  .trim();
              }
            }
            var etiqueta = 'Direcci' + String.fromCharCode(243) +
              'n de correo';
            var idx = html.indexOf(etiqueta);
            if (idx !== -1) {
              var desde = html.indexOf('href="', idx);
              if (desde !== -1) {
                var fin = html.indexOf('"', desde + 6);
                if (fin !== -1) {
                  var href = html.substring(desde + 6, fin);
                  href = descodificarURL(descodificarEntidades(href));
                  email = (href.indexOf('mailto:') === 0) ? href.substring(
                    7) : href;
                }
              }
            }
            DEBUG_USUARIO = 'title=' + titulo + ', email=' +
              (email || 'NO_ENCONTRADO');
            return {
              nombre: nombre,
              email: email
            };
          })
          .catch(function(e) {
            DEBUG_USUARIO = 'FETCH_ERROR: ' + (e && e.message ? e.message :
              String(e));
            return null;
          });
      }

      function capturarDepuracion() {
        var partes = [];
        partes.push('title=' + document.title);
        partes.push('url=' + window.location.href);

        var items = itemsBreadcrumb();
        partes.push('breadcrumb=' + items.map(function(i) {
          return i.texto + '[' + i.href + ']';
        }).join(' | '));

        var h1 = document.querySelector(
          '#page-header h1, .page-page-header h1, .page-header-headings h1, header h1'
        );
        partes.push('h1=' + (h1 ? texto(h1) : 'NONE'));

        var queEl = document.querySelector('.que');
        partes.push('que=' + (queEl ?
          ('data-questionid=' + (queEl.getAttribute('data-questionid') ||
              '') +
            ', id=' + (queEl.getAttribute('id') || '')) :
          'NONE'));

        var claves = ['Test', 'Algoritmos', 'finales', 'Finales', 'AntiCopia',
          'Alg#1'
        ];
        var html = document.documentElement.outerHTML || '';
        for (var i = 0; i < claves.length; i++) {
          var clave = claves[i];
          var ap = [];
          var pos = 0;
          var saltos = 0;
          while (saltos < 4) {
            var idx = html.indexOf(clave, pos);
            if (idx === -1) break;
            var ini = idx - 60;
            if (ini < 0) ini = 0;
            var fin = idx + 90;
            if (fin > html.length) fin = html.length;
            var trozo = html.substring(ini, fin).split('\n').join(' ');
            ap.push(trozo);
            pos = idx + clave.length;
            saltos++;
          }
          partes.push('buscar_' + clave + '=' +
            (ap.length ? ap.join(' ||| ') : 'NO_ENCONTRADO'));
        }

        var form = document.getElementById('responseform') ||
          document.querySelector('form[action*="processattempt.php"]');
        if (form) {
          var inputs = form.querySelectorAll('input');
          var lista = [];
          for (var j = 0; j < inputs.length && j < 30; j++) {
            var nm = inputs[j].getAttribute('name') || '';
            var vl = (inputs[j].getAttribute('value') || '').substring(0, 40);
            lista.push(nm + '=' + vl);
          }
          partes.push('inputs=' + lista.join(';'));
        }

        var scr = document.querySelectorAll('script');
        var menciones = [];
        for (var k = 0; k < scr.length && menciones.length < 6; k++) {
          var txt = scr[k].textContent || '';
          var tl = txt.toLowerCase();
          if (tl.indexOf('attempt') !== -1 || tl.indexOf('userid') !== -1 ||
            tl.indexOf('quiz') !== -1 || tl.indexOf('email') !== -1) {
            menciones.push(txt.substring(0, 200).split('\n').join(' '));
          }
        }
        partes.push('scripts=' + (menciones.length ?
          menciones.join(' ||| ') :
          'NINGUNO'));

        var g = [];
        if (window.M && window.M.cfg) {
          Object.keys(window.M.cfg).forEach(function(kk) {
            g.push(kk);
          });
          partes.push('M.cfg=' + g.join(','));
        } else {
          partes.push('M.cfg=NO');
        }

        return partes.join('\n');
      }

      function refrescarCache() {
        var c = {
          nombre: obtenerNombreCompleto(),
          curso: obtenerCurso(),
          cuestionario: obtenerCuestionario(),
          pregunta_id: obtenerPregunta()
        };
        for (var k in c) {
          if (c[k]) datosCacheados[k] = c[k];
        }
      }

      (function iniciarCaptura() {
        try {
          refrescarCache();
        } catch (e) {}
        obtenerUsuarioMoodle().then(function(u) {
          if (u) {
            if (u.nombre) datosCacheados.nombre = u.nombre;
            if (u.email) datosCacheados.email = u.email;
          }
        });
        var veces = 0;
        var timer = setInterval(function() {
          veces++;
          if (!datosCacheados.nombre && veces < 8) {
            try {
              refrescarCache();
            } catch (e) {}
          } else {
            clearInterval(timer);
          }
        }, 500);
      })();

      /* ================================================================ */

      function mostrarOverlay(motivo, nombreCompleto) {
        var primer = (nombreCompleto || '').split(' ')[0];
        document.getElementById('ayd-overlayTitulo').textContent =
          'Aviso de integridad acad\u00e9mica para ' +
          (primer || 'estudiante');
        document.getElementById('ayd-overlayMensaje').textContent =
          'Se registr\u00f3 que la p\u00e1gina perdi\u00f3 el foco (' +
          motivo + '). ' +
          'Esta instituci\u00f3n promueve la honestidad acad\u00e9mica como parte fundamental de la formaci\u00f3n de sus estudiantes: ' +
          'la evaluaci\u00f3n tiene como fin genuino comprobar su propio aprendizaje, y omitir ese proceso le resta valor a su propio desarrollo. ' +
          'El incidente qued\u00f3 registrado con nombre, email y hora exacta, y ser\u00e1 revisado por el/la docente.';
        document.getElementById('ayd-overlay').style.display = 'flex';
      }

      function armarPayload() {
        refrescarCache();
        var curso = datosCacheados.curso || obtenerCurso();
        var paramsURL = new URLSearchParams(window.location.search);
        var cfg = (window.M && window.M.cfg) || {};
        return {
          version_script: VERSION_SCRIPT,
          nombre: datosCacheados.nombre || obtenerNombreCompleto(),
          email: datosCacheados.email || paramsURL.get('nombre') || '',
          curso: curso,
          materia: curso,
          cuestionario: datosCacheados.cuestionario || obtenerCuestionario(),
          pregunta_id: datosCacheados.pregunta_id || obtenerPregunta(),
          titulo_pagina: tituloPagina(),
          url_actual: window.location.href,
          attempt: paramsURL.get('attempt') || '',
          cmid: paramsURL.get('cmid') || '',
          course_id: cfg.courseId || '',
          user_id: cfg.userId || '',
          estado: 'sospechoso',
          incidentes: incidentes.map(function(i) {
            return i.motivo + ' (' + i.hora + ')';
          }).join(' | '),
          timestamp: new Date().toISOString(),
          depuracion: capturarDepuracion(),
          debug_usuario: DEBUG_USUARIO
        };
      }

      function realizarEnvio(payload) {
        if (payloadEnviado) return;
        payloadEnviado = true;

        console.log('[AyD] Datos capturados y enviados:', payload);
        console.log('[AyD] DEPURACION:\n' + capturarDepuracion());

        var qs = Object.keys(payload).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(payload[
            k]);
        }).join('&');

        fetch(GAS_URL + '?' + qs, {
            method: 'POST',
            body: JSON.stringify(payload)
          })
          .then(function() {})
          .catch(function(e) {
            yaEnviado = false;
            payloadEnviado = false;
          });
      }

      function enviarIncidente(motivo) {
        if (yaEnviado) return;
        yaEnviado = true;
        incidentes.push({
          motivo: motivo,
          hora: new Date().toISOString()
        });

        var payload = armarPayload();

        mostrarOverlay(motivo, payload.nombre);

        if (payload.email) {
          realizarEnvio(payload);
          return;
        }

        obtenerUsuarioMoodle().then(function(u) {
          if (u) {
            if (u.nombre) payload.nombre = u.nombre;
            if (u.email) payload.email = u.email;
          }
          realizarEnvio(payload);
        });

        setTimeout(function() {
          realizarEnvio(payload);
        }, 3000);
      }

      function armarIncidente(motivo) {
        if (blurTimeout) return;
        reproducirAlerta();
        blurTimeout = setTimeout(function() {
          blurTimeout = null;
          enviarIncidente(motivo);
        }, TOLERANCIA_MS);
      }

      function cancelarIncidente() {
        if (blurTimeout) {
          clearTimeout(blurTimeout);
          blurTimeout = null;
        }
      }

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          armarIncidente('cambio de pesta\u00f1a o minimizado');
        } else {
          cancelarIncidente();
        }
      });
      window.addEventListener('blur', function() {
        armarIncidente('la p\u00e1gina perdi\u00f3 el foco');
      });
      window.addEventListener('focus', cancelarIncidente);
    })();
