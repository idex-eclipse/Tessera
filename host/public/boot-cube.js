// Копия математики из plugins/shared/loader/tesseract.ts (тот же тессеракт, те же
// повороты и камеры), чтобы вращение шло ещё до загрузки основного бандла.
// Меняете одно — меняйте и другое. Цикл сам останавливается, когда svg убран из DOM.
(function () {
  var svg = document.querySelector('.boot-cube');
  if (!svg) return;
  var NS = 'http://www.w3.org/2000/svg';
  var V = [], E = [], i, bit;
  for (i = 0; i < 16; i++) V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
  for (i = 0; i < 16; i++) for (bit = 1; bit < 16; bit <<= 1) if ((i ^ bit) > i) E.push([i, i ^ bit]);
  var lines = E.map(function () {
    var l = document.createElementNS(NS, 'line');
    svg.appendChild(l);
    return l;
  });
  function rot(a, b, angle) {
    var c = Math.cos(angle), s = Math.sin(angle);
    return [a * c - b * s, a * s + b * c];
  }
  var t0 = 0;
  function frame(now) {
    if (!svg.isConnected) return;
    if (!t0) t0 = now;
    var t = (now - t0) / 1000;
    var P = V.map(function (v) {
      var x = v[0], y = v[1], z = v[2], w = v[3], r;
      r = rot(x, w, t * 0.9); x = r[0]; w = r[1];
      r = rot(z, w, t * 0.55); z = r[0]; w = r[1];
      r = rot(x, z, t * 0.35); x = r[0]; z = r[1];
      r = rot(y, z, t * 0.22); y = r[0]; z = r[1];
      var k4 = 1 / (3 - w), x3 = x * k4, y3 = y * k4, z3 = z * k4;
      var k3 = 1 / (2.4 - z3), s = 50 * 2.4 * k3;
      return { x: 50 + x3 * s, y: 50 + y3 * s, d: Math.min(1, Math.max(0, (z3 + 0.8) / 1.6)) };
    });
    for (var j = 0; j < E.length; j++) {
      var a = P[E[j][0]], b = P[E[j][1]], l = lines[j];
      l.setAttribute('x1', a.x.toFixed(2));
      l.setAttribute('y1', a.y.toFixed(2));
      l.setAttribute('x2', b.x.toFixed(2));
      l.setAttribute('y2', b.y.toFixed(2));
      l.setAttribute('stroke-opacity', (0.25 + 0.75 * (a.d + b.d) / 2).toFixed(2));
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
