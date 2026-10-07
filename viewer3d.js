/* Interactive 3D specimen viewer (Three.js r128 + OrbitControls).
 * Drag = rotate · wheel/pinch = zoom · right-drag / shift-drag = pan · double-click = reset.
 * Exposes window.Specimen3D = { available, show(host, glyph, hue, detail), hide() }.
 * If Three.js failed to load, `available` is false and the page keeps its SVG silhouettes. */
(() => {
  "use strict";
  const T = window.THREE;
  if (!T || !T.OrbitControls) { window.Specimen3D = { available: false }; return; }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;

  /* ---------- small helpers ---------- */
  function rng(seed) { // deterministic noise so a model looks the same every time
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function canvasTex(w, h, draw, color) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = T.RepeatWrapping;
    t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    if (color) t.encoding = T.sRGBEncoding;
    return t;
  }

  const col = (c) => new T.Color(c).convertSRGBToLinear(); // r128 treats Color as linear
  const V = (x, y) => new T.Vector2(x, y);
  const spline = (pts, n) => new T.SplineCurve(pts.map((p) => V(p[0], p[1]))).getPoints(n);
  const poly = (pts) => pts.map((p) => V(p[0], p[1]));

  /* Lathe whose V coordinate follows arc length, so textures line up with the profile. */
  function lathe(points, material, segs) {
    const g = new T.LatheGeometry(points, segs || 96);
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
    const total = cum[cum.length - 1] || 1;
    const uv = g.attributes.uv, n = points.length;
    for (let i = 0; i < uv.count; i++) uv.setY(i, cum[i % n] / total);
    uv.needsUpdate = true;
    const m = new T.Mesh(g, material);
    return m;
  }

  /* ---------- procedural surface textures (canvas) ---------- */
  function speckle(ctx, w, h, rand, count, colors, rMin, rMax, alpha) {
    for (let i = 0; i < count; i++) {
      const x = rand() * w, y = rand() * h, r = rMin + rand() * (rMax - rMin);
      ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
      ctx.fillStyle = colors[(rand() * colors.length) | 0];
      for (const dx of [-w, 0, w]) { ctx.beginPath(); ctx.arc(x + dx, y, r, 0, TAU); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function squareSpiral(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    let len = s, dir = 0;
    const dx = [1, 0, -1, 0], dy = [0, 1, 0, -1];
    let cx = x, cy = y;
    for (let i = 0; i < 9; i++) {
      cx += dx[dir] * len; cy += dy[dir] * len;
      ctx.lineTo(cx, cy);
      dir = (dir + 1) % 4;
      if (i % 2 === 1) len -= s / 4.2;
      if (len <= 0.5) break;
    }
    ctx.stroke();
  }

  function dingTexture(hue, detail) {
    const rand = rng(11);
    return canvasTex(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = hue; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, rand, 900, ["#cfe6d6", "#2d4f40", "#8fc0a4", "#5a3d22"], 2, 14, 0.22);
      // taotie frieze: drawn where the vessel is widest (arc-length fraction ≈ 0.6–0.9)
      const y0 = h * 0.1, y1 = h * 0.38;
      ctx.fillStyle = detail; ctx.globalAlpha = 0.28; ctx.fillRect(0, y0, w, y1 - y0); ctx.globalAlpha = 1;
      ctx.strokeStyle = detail; ctx.lineWidth = 2.4; ctx.lineCap = "square";
      for (let x = 0; x < w; x += 22) for (let y = y0 + 6; y < y1 - 16; y += 22) squareSpiral(ctx, x + 4, y, 15);
      ctx.lineWidth = 4;
      ctx.strokeRect(-6, y0, w + 12, y1 - y0);
      // three taotie masks
      for (let k = 0; k < 3; k++) {
        const cx = w * (k + 0.5) / 3, cy = (y0 + y1) / 2;
        ctx.fillStyle = hue; ctx.globalAlpha = 0.9; ctx.fillRect(cx - 62, y0 + 6, 124, y1 - y0 - 12); ctx.globalAlpha = 1;
        ctx.strokeStyle = detail; ctx.lineWidth = 3.5;
        ctx.strokeRect(cx - 62, y0 + 6, 124, y1 - y0 - 12);
        ctx.fillStyle = detail;
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.arc(cx + s * 28, cy - 6, 11, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.moveTo(cx + s * 12, cy - 34); ctx.lineTo(cx + s * 52, cy - 34); ctx.lineTo(cx + s * 46, cy - 20); ctx.stroke();
        }
        ctx.fillRect(cx - 5, cy - 34, 10, 40);
        ctx.beginPath(); ctx.moveTo(cx - 28, cy + 22); ctx.lineTo(cx + 28, cy + 22); ctx.stroke();
      }
    }, true);
  }

  function celadonTextures(hue) {
    const rand = rng(23);
    const petals = (ctx, w, h, fill) => {
      const rows = [0.2, 0.42];
      const n = 14;
      for (let row = 0; row < rows.length; row++) {
        const vy = rows[row];
        for (let i = 0; i < n; i++) {
          const x = ((i + (row % 2) * 0.5) / n) * w, pw = (w / n) * 0.92, y = h * (1 - vy);
          ctx.beginPath();
          ctx.moveTo(x - pw / 2, y);
          ctx.quadraticCurveTo(x - pw / 2, y - h * 0.34, x, y - h * 0.46);
          ctx.quadraticCurveTo(x + pw / 2, y - h * 0.34, x + pw / 2, y);
          ctx.closePath();
          fill(ctx, x, y, pw);
        }
      }
    };
    const color = canvasTex(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = hue; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, rand, 200, ["#ffffff", "#5f8f7b"], 6, 40, 0.1);
      petals(ctx, w, h, (c) => { c.strokeStyle = "rgba(30,70,55,.75)"; c.lineWidth = 3; c.stroke(); });
      // fine crackle
      ctx.strokeStyle = "rgba(60,90,76,.28)"; ctx.lineWidth = 0.8;
      for (let i = 0; i < 160; i++) {
        let x = rand() * w, y = rand() * h; ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }, true);
    const bump = canvasTex(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, w, h);
      petals(ctx, w, h, (c, x, y, pw) => {
        const g = c.createLinearGradient(x, y - h * 0.46, x, y);
        g.addColorStop(0, "#d8d8d8"); g.addColorStop(1, "#a0a0a0"); c.fillStyle = g; c.fill();
        c.strokeStyle = "#404040"; c.lineWidth = 3; c.stroke();
      });
    });
    return { color, bump };
  }

  function jadeTexture(hue) {
    const rand = rng(5);
    return canvasTex(1024, 1024, (ctx, w, h) => {
      ctx.fillStyle = hue; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, rand, 600, ["#c9d3ad", "#7f8b65", "#e9e6cf"], 4, 30, 0.14);
      // cream calcified patches near the outer edge (texture covers -1.5..1.5)
      for (let i = 0; i < 70; i++) {
        const a = rand() * TAU, r = (0.8 + rand() * 0.22) * (w / 2) * 0.98;
        const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r, rr = 10 + rand() * 40;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, "rgba(236,228,200,.75)"); g.addColorStop(1, "rgba(236,228,200,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill();
      }
    }, true);
  }

  function meipingTexture(detail) {
    const rand = rng(7);
    return canvasTex(2048, 1024, (ctx, w, h) => {
      ctx.fillStyle = "#EEF2F4"; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, rand, 150, ["#cfdbe4", "#ffffff"], 6, 36, 0.12);
      ctx.strokeStyle = detail; ctx.fillStyle = detail; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const band = (v, th) => { ctx.lineWidth = th; ctx.beginPath(); ctx.moveTo(0, h * (1 - v)); ctx.lineTo(w, h * (1 - v)); ctx.stroke(); };
      [0.045, 0.075, 0.37, 0.4, 0.78, 0.81, 0.9, 0.92].forEach((v, i) => band(v, i % 2 ? 4 : 7));
      // lotus panels near the foot
      for (let i = 0; i < 16; i++) {
        const x = ((i + 0.5) / 16) * w, y = h * (1 - 0.08), pw = w / 16 * 0.78;
        ctx.lineWidth = 4; ctx.beginPath();
        ctx.moveTo(x - pw / 2, y); ctx.quadraticCurveTo(x - pw / 2, y - h * 0.2, x, y - h * 0.26); ctx.quadraticCurveTo(x + pw / 2, y - h * 0.2, x + pw / 2, y); ctx.stroke();
        ctx.globalAlpha = 0.4; ctx.fill(); ctx.globalAlpha = 1;
      }
      // peony scroll: sine vine, flower heads and leaves (integer number of periods → tiles round the vase)
      const cy = h * (1 - 0.58), amp = h * 0.075, per = 8;
      ctx.lineWidth = 6; ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const y = cy + Math.sin((x / w) * per * TAU) * amp;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (let i = 0; i < per; i++) {
        const x = ((i + 0.25) / per) * w, y = cy + Math.sin(((i + 0.25) / per) * per * TAU) * amp - 0;
        ctx.save(); ctx.translate(x, y - h * 0.045);
        for (let p = 0; p < 6; p++) { ctx.rotate(TAU / 6); ctx.beginPath(); ctx.ellipse(0, -h * 0.03, h * 0.022, h * 0.034, 0, 0, TAU); ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 2.5; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(0, 0, h * 0.012, 0, TAU); ctx.fill();
        ctx.restore();
        const lx = ((i + 0.75) / per) * w, ly = cy + Math.sin(((i + 0.75) / per) * per * TAU) * amp;
        for (const s of [-1, 1]) {
          ctx.save(); ctx.translate(lx, ly); ctx.rotate(s * 0.9);
          ctx.beginPath(); ctx.ellipse(0, s * -h * 0.04, h * 0.018, h * 0.045, 0, 0, TAU); ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1; ctx.restore();
        }
      }
      // ruyi-head collar under the neck
      for (let i = 0; i < 12; i++) {
        const x = ((i + 0.5) / 12) * w, y = h * (1 - 0.88);
        ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, w / 12 * 0.34, 0, Math.PI); ctx.stroke();
      }
    }, true);
  }

  /* ---------- models ---------- */
  function buildDing(hue, detail) {
    const g = new T.Group();
    const bronze = new T.MeshStandardMaterial({ map: dingTexture(hue, detail), roughness: 0.62, metalness: 0.2 });
    const plain = new T.MeshStandardMaterial({ color: col(hue).multiplyScalar(0.7), roughness: 0.75, metalness: 0.2, side: T.DoubleSide });
    const outer = spline([[0.02, 0.0], [0.45, 0.04], [0.8, 0.22], [0.98, 0.5], [1.03, 0.8], [1.04, 0.97]], 34);
    g.add(lathe(outer, bronze));
    g.add(lathe(poly([[1.04, 0.97], [1.13, 1.0], [1.13, 1.12], [0.95, 1.12]]), bronze));
    g.add(lathe(spline([[0.95, 1.12], [0.93, 0.8], [0.8, 0.45], [0.5, 0.22], [0.02, 0.16]], 24), plain));
    const legMat = new T.MeshStandardMaterial({ color: col(hue), roughness: 0.7, metalness: 0.2 });
    const legGeo = new T.CylinderGeometry(0.17, 0.1, 1.35, 28);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + Math.PI / 6;
      const leg = new T.Mesh(legGeo, legMat);
      leg.position.set(Math.cos(a) * 0.62, -0.42, Math.sin(a) * 0.62);
      g.add(leg);
    }
    for (const sgn of [-1, 1]) {
      const h = new T.Group();
      const post = new T.BoxGeometry(0.1, 0.62, 0.16);
      for (const dx of [-0.13, 0.13]) { const m = new T.Mesh(post, bronze); m.position.set(dx, 0.31, 0); h.add(m); }
      const bar = new T.Mesh(new T.BoxGeometry(0.36, 0.1, 0.16), bronze); bar.position.set(0, 0.67, 0); h.add(bar);
      h.position.set(sgn * 1.04, 1.1, 0);
      g.add(h);
    }
    return g;
  }

  function buildBowl(hue, detail) {
    const g = new T.Group();
    const { color, bump } = celadonTextures(hue);
    const glaze = new T.MeshPhysicalMaterial({ map: color, bumpMap: bump, bumpScale: 2.2, roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const inner = new T.MeshPhysicalMaterial({ color: col(hue), roughness: 0.22, clearcoat: 0.6, side: T.DoubleSide });
    const foot = poly([[0.0, 0.12], [0.5, 0.12], [0.5, 0.0], [0.6, 0.0]]);
    const body = spline([[0.6, 0.0], [0.64, 0.16], [0.85, 0.3], [1.15, 0.58], [1.38, 0.92], [1.48, 1.18]], 36);
    g.add(lathe(foot.concat(body.slice(1)), glaze));
    g.add(lathe(poly([[1.48, 1.18], [1.44, 1.2], [1.4, 1.18]]), inner));
    g.add(lathe(spline([[1.4, 1.18], [1.3, 0.92], [1.06, 0.6], [0.76, 0.34], [0.4, 0.24], [0.02, 0.22]], 30), inner));
    return g;
  }

  function buildBi(hue) {
    const g = new T.Group();
    const R = 1.5, r = 0.36, D = 0.17;
    const shape = new T.Shape(); shape.absarc(0, 0, R, 0, TAU, false);
    const hole = new T.Path(); hole.absarc(0, 0, r, 0, TAU, true); shape.holes.push(hole);
    const geo = new T.ExtrudeGeometry(shape, { depth: D, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3, curveSegments: 96 });
    geo.translate(0, 0, -D / 2);
    const tex = jadeTexture(hue);
    tex.repeat.set(1 / (2 * R), 1 / (2 * R)); tex.offset.set(0.5, 0.5);
    const jade = new T.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const disc = new T.Mesh(geo, jade);
    disc.position.y = R + 0.16;
    g.add(disc);
    const wood = new T.MeshStandardMaterial({ color: col("#4a3426"), roughness: 0.7 });
    const stand = new T.Mesh(new T.BoxGeometry(1.1, 0.16, 0.6), wood); stand.position.y = 0.08; g.add(stand);
    const slot = new T.Mesh(new T.BoxGeometry(0.4, 0.14, 0.26), wood); slot.position.y = 0.2; g.add(slot);
    return g;
  }

  function buildMeiping(hue, detail) {
    const g = new T.Group();
    const porcelain = new T.MeshPhysicalMaterial({ map: meipingTexture(detail), roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.08 });
    const white = new T.MeshPhysicalMaterial({ color: col("#EEF2F4"), roughness: 0.16, clearcoat: 0.8, side: T.DoubleSide });
    const foot = poly([[0.0, 0.05], [0.44, 0.05], [0.44, 0.0], [0.52, 0.0], [0.53, 0.1]]);
    const body = spline([[0.53, 0.1], [0.58, 0.5], [0.76, 1.1], [0.93, 1.7], [0.98, 2.1], [0.86, 2.5], [0.58, 2.72], [0.42, 2.82], [0.37, 2.95]], 56);
    g.add(lathe(foot.concat(body.slice(1)), porcelain, 128));
    g.add(lathe(poly([[0.37, 2.95], [0.43, 3.0], [0.47, 3.08], [0.4, 3.12], [0.31, 3.1]]), white));
    g.add(lathe(poly([[0.31, 3.1], [0.3, 2.8], [0.2, 2.6]]), white));
    return g;
  }

  const BUILDERS = { ding: buildDing, bowl: buildBowl, bi: buildBi, meiping: buildMeiping };

  /* ---------- viewer (single shared WebGL context) ---------- */
  let V3 = null;

  function create() {
    const root = document.createElement("div");
    root.className = "viewer3d";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
        root.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", "Interactive 3D model of the specimen. Drag to rotate, scroll to zoom, right-drag to pan, double-click to reset.");
    renderer.domElement.tabIndex = 0;

    const hint = document.createElement("div");
    hint.className = "viewer3d-hint";
    hint.textContent = "Drag to rotate · scroll to zoom";
    root.appendChild(hint);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(35, 4 / 3, 0.1, 100);
    scene.add(new T.HemisphereLight(0xffffff, 0x7d8c88, 0.55));
    const key = new T.DirectionalLight(0xffffff, 1.25); key.position.set(3, 5, 4); scene.add(key);
    const fill = new T.DirectionalLight(0xcfe6ff, 0.35); fill.position.set(-4, 2, -2); scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, 0.4); rim.position.set(0, 3, -5); scene.add(rim);

    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 1.4;
    controls.addEventListener("start", () => { controls.autoRotate = false; hint.dataset.used = "true"; });

    const shadowTex = canvasTex(128, 128, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, "rgba(0,0,0,.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    });
    const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    const view = { model: null, dist: 8, target: new T.Vector3() };

    function frame() {
      camera.position.set(0.55, 0.45, 1).normalize().multiplyScalar(view.dist);
      controls.target.copy(view.target);
      camera.position.add(view.target);
      camera.near = view.dist / 50; camera.far = view.dist * 20; camera.updateProjectionMatrix();
      controls.minDistance = view.dist * 0.35; controls.maxDistance = view.dist * 3;
      controls.update();
    }
    renderer.domElement.addEventListener("dblclick", () => { frame(); });

    function setModel(glyph, hue, detail) {
      if (view.model) {
        scene.remove(view.model);
        view.model.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { for (const k of ["map", "bumpMap"]) o.material[k] && o.material[k].dispose(); o.material.dispose(); }
        });
      }
      const m = (BUILDERS[glyph] || BUILDERS.ding)(hue, detail);
      const box = new T.Box3().setFromObject(m);
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      m.position.sub(center); // centre on origin
      scene.add(m);
      view.model = m;
      const radius = Math.max(size.x, size.y, size.z) / 2;
      view.dist = radius * 4.6;
      view.target.set(0, 0, 0);
      shadow.position.y = -size.y / 2 - 0.01;
      shadow.scale.set(size.x * 1.15, size.x * 1.15, 1);
      controls.autoRotate = !reduceMotion;
      delete hint.dataset.used;
      frame();
    }

    let visible = true, raf = 0;
    function resize() {
      const w = root.clientWidth, h = root.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    function loop() {
      raf = 0;
      if (!visible || document.hidden || !root.isConnected) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(loop); }
    new ResizeObserver(resize).observe(root);
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; kick(); }).observe(root);
    document.addEventListener("visibilitychange", kick);

    return { root, setModel, kick, resize };
  }

  window.Specimen3D = {
    available: true,
    show(host, glyph, hue, detail) {
      if (!V3) V3 = create();
      host.replaceChildren(V3.root);
      V3.setModel(glyph, hue, detail);
      V3.resize();
      V3.kick();
    }
  };
})();
