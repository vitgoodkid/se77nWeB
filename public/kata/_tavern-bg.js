/* _tavern-bg.js — Three.js animated background for the tavern page.
   A domain-warped nebula + drifting candle-dust particles, tuned to the kata
   palette (warm dark #0d0a08, purple #8a4fff, gold #D4A858) instead of the
   design's cool violet. Plain JS against the UMD THREE global; mounts to
   <canvas id="bg">. Respects prefers-reduced-motion (renders one static frame).*/
(function () {
  if (!window.THREE) { console.warn('[tavern-bg] THREE not loaded'); return; }
  var THREE = window.THREE;
  var canvas = document.getElementById('bg');
  if (!canvas) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x0d0a08, 1);
  renderer.autoClear = true;

  function hexToVec3(hex) {
    var c = new THREE.Color(hex);
    return new THREE.Vector3(c.r, c.g, c.b);
  }

  // ---- nebula fullscreen quad (orthographic) ----
  var nebScene = new THREE.Scene();
  var nebCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  var uniforms = {
    uTime:   { value: 0 },
    uRes:    { value: new THREE.Vector2(1, 1) },
    uMouse:  { value: new THREE.Vector2(0.5, 0.5) },
    uAccent: { value: hexToVec3('#8a4fff') },   // tavern purple
    uGold:   { value: hexToVec3('#D4A858') },   // se77n gold
  };

  var frag = [
    'precision highp float;',
    'uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse;',
    'uniform vec3 uAccent; uniform vec3 uGold; varying vec2 vUv;',
    'float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p);',
    '  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));',
    '  vec2 u=f*f*(3.-2.*f); return mix(mix(a,b,u.x),mix(c,d,u.x),u.y); }',
    'float fbm(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }',
    'void main(){',
    '  vec2 uv=vUv; vec2 p=(uv-.5)*vec2(uRes.x/uRes.y,1.0);',
    '  vec2 m=(uMouse-.5);',
    '  p += m*0.12;',
    '  float t=uTime*0.04;',
    '  vec2 q=vec2(fbm(p*1.4+t), fbm(p*1.4+vec2(5.2,1.3)-t));',
    '  vec2 r=vec2(fbm(p*1.4+q*1.6+vec2(1.7,9.2)+t*0.5), fbm(p*1.4+q*1.6+vec2(8.3,2.8)-t*0.5));',
    '  float f=fbm(p*1.4+r*1.5);',
    '  vec3 base=vec3(0.051,0.039,0.031);',   // #0d0a08
    '  vec3 col=base;',
    '  col=mix(col, uAccent*0.42, smoothstep(0.28,0.95,f));',
    '  col=mix(col, uGold*0.36, smoothstep(0.58,1.05,r.x));',
    '  float d=length(p-m*1.25);',
    '  col += uAccent*0.13*exp(-d*2.8);',
    '  float vig=smoothstep(1.35,0.15,length((uv-.5)*1.45));',
    '  col*=mix(0.5,1.0,vig);',
    '  col=mix(base, col, 0.92);',
    '  float g=hash(uv*uRes.xy+t)*0.022-0.011;',
    '  col+=g;',
    '  gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  var vert = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }';

  var nebMat = new THREE.ShaderMaterial({ uniforms: uniforms, vertexShader: vert, fragmentShader: frag, depthTest: false });
  nebScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), nebMat));

  // ---- drifting candle-dust particles (perspective, parallax) ----
  var partScene = new THREE.Scene();
  var partCam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  partCam.position.z = 18;

  function sprite() {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,248,230,1)');
    grd.addColorStop(0.3, 'rgba(240,220,170,0.55)');
    grd.addColorStop(1, 'rgba(255,248,230,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    var tex = new THREE.Texture(c); tex.needsUpdate = true; return tex;
  }

  var N = 260;
  var pos = new Float32Array(N * 3);
  var spd = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    pos[i*3]   = (Math.random() - 0.5) * 46;
    pos[i*3+1] = (Math.random() - 0.5) * 30;
    pos[i*3+2] = (Math.random() - 0.5) * 26;
    spd[i] = 0.4 + Math.random() * 1.1;
  }
  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var pMat = new THREE.PointsMaterial({
    size: 0.5, map: sprite(), transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color('#efe2c4'),
  });
  var points = new THREE.Points(pGeo, pMat);
  partScene.add(points);

  // ---- mouse / state ----
  var mouse = { x: 0.5, y: 0.5 }, tgt = { x: 0.5, y: 0.5 };
  window.addEventListener('pointermove', function (e) {
    tgt.x = e.clientX / window.innerWidth;
    tgt.y = e.clientY / window.innerHeight;
  });

  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    uniforms.uRes.value.set(w, h);
    partCam.aspect = w / h; partCam.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function draw() {
    renderer.autoClear = true;
    renderer.render(nebScene, nebCam);
    renderer.autoClear = false;
    renderer.render(partScene, partCam);
  }

  // Reduced-motion: paint one frame and stop (no animation loop).
  if (reduce) { uniforms.uTime.value = 4.0; draw(); return; }

  var running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) loop(); });

  var clock = new THREE.Clock();
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;

    mouse.x += (tgt.x - mouse.x) * 0.04;
    mouse.y += (tgt.y - mouse.y) * 0.04;
    uniforms.uTime.value = t;
    uniforms.uMouse.value.set(mouse.x, 1 - mouse.y);

    var arr = pGeo.attributes.position.array;
    for (var i = 0; i < N; i++) {
      arr[i*3+1] += spd[i] * dt;
      if (arr[i*3+1] > 16) arr[i*3+1] = -16;
    }
    pGeo.attributes.position.needsUpdate = true;
    points.rotation.y = t * 0.02;
    partCam.position.x += ((mouse.x - 0.5) * 6 - partCam.position.x) * 0.05;
    partCam.position.y += ((0.5 - mouse.y) * 4 - partCam.position.y) * 0.05;
    partCam.lookAt(0, 0, 0);

    draw();
  }
  loop();
})();
