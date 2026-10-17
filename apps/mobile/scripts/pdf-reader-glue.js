/*
 * The page-side half of the statement PDF reader. It runs inside a hidden
 * WebView next to pdf.js (see build-pdf-reader.mjs) and speaks the small
 * protocol in src/lib/statementImport/pdfReaderProtocol.ts.
 *
 * Plain ES5 on purpose: older Android WebViews run it as it is. It never logs,
 * and it keeps the password only for the length of one getDocument call.
 */
(function () {
  var pdfjs = window.pdfjsLib;
  // The worker is inlined and runs on this thread (window.pdfjsWorker), so no
  // Worker is ever started; the source just has to be non-empty.
  pdfjs.GlobalWorkerOptions.workerSrc = 'about:blank';

  var parts = [];
  var bytes = null;
  var task = null;
  var doc = null;

  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function fail(error) {
    // Name and code only: a message can carry file content.
    post({
      t: 'error',
      name: (error && error.name) || 'Error',
      code: error && typeof error.code === 'number' ? error.code : null,
    });
  }

  function decode(base64) {
    var binary = atob(base64);
    var out = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }

  function dispose() {
    try {
      if (task) task.destroy();
    } catch (e) {}
    task = null;
    doc = null;
  }

  function open(password) {
    dispose();
    if (!bytes) {
      fail({ name: 'InvalidPDFException' });
      return;
    }
    var options = {
      data: bytes.slice(),
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    };
    if (password) options.password = password;
    task = pdfjs.getDocument(options);
    task.promise.then(function (opened) {
      doc = opened;
      post({ t: 'opened', pages: opened.numPages });
    }, fail);
  }

  function pageItems(n) {
    doc
      .getPage(n)
      .then(function (page) {
        return page.getTextContent();
      })
      .then(function (content) {
        var items = [];
        for (var i = 0; i < content.items.length; i += 1) {
          var it = content.items[i];
          if (typeof it.str !== 'string') continue;
          items.push([
            it.str,
            Math.round(it.transform[4] * 10) / 10,
            Math.round(it.transform[5] * 10) / 10,
            Math.round(it.width * 10) / 10,
            Math.round(it.height * 10) / 10,
          ]);
        }
        post({ t: 'items', n: n, items: items });
      })
      .catch(fail);
  }

  function renderPage(n, maxWidth) {
    doc
      .getPage(n)
      .then(function (page) {
        var base = page.getViewport({ scale: 1 });
        var scale = Math.min(2.5, Math.max(0.5, maxWidth / base.width));
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        var context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        return page
          .render({ canvasContext: context, viewport: viewport })
          .promise.then(function () {
            var url = canvas.toDataURL('image/jpeg', 0.85);
            canvas.width = 0;
            canvas.height = 0;
            post({ t: 'image', n: n, base64: url.slice(url.indexOf(',') + 1) });
          });
      })
      .catch(fail);
  }

  window.__rx = function (m) {
    try {
      if (m.t === 'begin') {
        parts = [];
        bytes = null;
      } else if (m.t === 'chunk') {
        parts.push(decode(m.data));
      } else if (m.t === 'open') {
        var total = 0;
        for (var i = 0; i < parts.length; i += 1) total += parts[i].length;
        bytes = new Uint8Array(total);
        var at = 0;
        for (var j = 0; j < parts.length; j += 1) {
          bytes.set(parts[j], at);
          at += parts[j].length;
        }
        parts = [];
        open(m.password);
      } else if (m.t === 'password') {
        open(m.password);
      } else if (m.t === 'page') {
        pageItems(m.n);
      } else if (m.t === 'render') {
        renderPage(m.n, m.maxWidth);
      } else if (m.t === 'close') {
        dispose();
        bytes = null;
        parts = [];
      }
    } catch (e) {
      fail(e);
    }
  };

  post({ t: 'ready' });
})();
