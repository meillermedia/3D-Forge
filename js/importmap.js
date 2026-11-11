// Use a local three.js from lib/three/ if present, otherwise the CDN
(function () {
  var local = new URL('lib/three/', document.baseURI).href;
  var ok = false;
  try {
    var x = new XMLHttpRequest();
    x.open('GET', local + 'build/three.module.js', false);
    x.overrideMimeType('text/plain');
    x.send();
    ok = x.status === 200 && x.responseText.indexOf('REVISION') >= 0;
  } catch (e) {}
  var cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
  var base = ok ? local : cdn;
  window.__THREE_BASE__ = base;
  var el = document.createElement('script');
  el.type = 'importmap';
  el.textContent = JSON.stringify({ imports: {
    'three': base + 'build/three.module.js',
    'three/addons/': base + 'examples/jsm/'
  } });
  document.head.appendChild(el);
})();
