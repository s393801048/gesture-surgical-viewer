import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uVol;
  uniform vec3 uSize;
  uniform float uSliceY;
  uniform float uDensity;
  uniform vec3 uKeyDir;

  varying vec3 vWorld;

  vec4 transfer(float v) {
    vec3 lungCol = vec3(0.26, 0.60, 0.80);
    vec3 softCol = vec3(0.92, 0.74, 0.60);
    vec3 boneCol = vec3(1.00, 0.97, 0.90);

    float lung = smoothstep(0.090, 0.20, v) * (1.0 - smoothstep(0.42, 0.60, v));
    float soft = smoothstep(0.58, 0.72, v) * (1.0 - smoothstep(0.85, 0.92, v));
    float bone = smoothstep(0.89, 0.96, v);

    vec3 col = lungCol * lung + softCol * soft + boneCol * bone;
    float wsum = lung + soft + bone;
    if (wsum > 1e-4) col /= wsum;

    float a = lung * 0.016 + soft * 0.016 + bone * 0.42;
    return vec4(col, a);
  }

  void main() {
    vec3 hbox = uSize * 0.5;
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);

    vec3 inv = 1.0 / rd;
    vec3 ta = (-hbox - ro) * inv;
    vec3 tb = ( hbox - ro) * inv;
    vec3 tmin = min(ta, tb);
    vec3 tmax = max(ta, tb);

    float tNear = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
    float tFar  = min(min(tmax.x, tmax.y), tmax.z);
    if (tFar <= tNear) discard;

    if (abs(rd.y) > 1e-5) {
      float tp = (uSliceY - ro.y) / rd.y;
      if (rd.y > 0.0) tFar = min(tFar, tp);
      else            tNear = max(tNear, tp);
    } else if (ro.y > uSliceY) {
      discard;
    }
    if (tFar <= tNear) discard;

    const int STEPS = 168;
    float dt = (tFar - tNear) / float(STEPS);

    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 p = ro + rd * (tNear + dt * jitter);

    vec3 accum = vec3(0.0);
    float alpha = 0.0;
    vec3 keyDir = normalize(uKeyDir);
    float e = 1.0 / 160.0;

    for (int i = 0; i < STEPS; i++) {
      vec3 uvw = (p + hbox) / uSize;
      float v = texture(uVol, uvw).r;

      vec4 c = transfer(v);
      // 靠近体数据边界时淡出，避免看见立方体的六个面
      float edge = min(
        min(min(uvw.x, 1.0 - uvw.x), min(uvw.y, 1.0 - uvw.y)),
        min(uvw.z, 1.0 - uvw.z)
      );
      c.a *= smoothstep(0.0, 0.10, edge);
      if (c.a > 0.0008) {
        vec3 rgb = c.rgb;

        if (v > 0.52) {
          vec3 g = vec3(
            texture(uVol, uvw + vec3(e, 0.0, 0.0)).r - texture(uVol, uvw - vec3(e, 0.0, 0.0)).r,
            texture(uVol, uvw + vec3(0.0, e, 0.0)).r - texture(uVol, uvw - vec3(0.0, e, 0.0)).r,
            texture(uVol, uvw + vec3(0.0, 0.0, e)).r - texture(uVol, uvw - vec3(0.0, 0.0, e)).r
          );
          vec3 n = normalize(-g + vec3(1e-5));
          float diff = 0.45 + 0.55 * max(dot(n, keyDir), 0.0);
          float rim = pow(1.0 - abs(dot(n, normalize(ro - p))), 2.0);
          rgb *= diff;
          rgb += vec3(0.10, 0.22, 0.26) * rim * 0.5;
        }

        float a = c.a * uDensity;
        accum += (1.0 - alpha) * a * rgb;
        alpha += (1.0 - alpha) * a;
        if (alpha > 0.96) break;
      }

      p += rd * dt;
    }

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(accum, alpha);
  }
`;

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);

    this.azimuthOffset = 90;   // 让手势的 0 度对应冠状面正视
    this.azimuth = 90;
    this.baseElevation = 8;
    this.elevation = 8;
    this.distMul = 1.48;
    this.baseDist = 2.3;
    this.halfHeight = 0.8;

    this._buildCutRing();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _buildCutRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 0.995, 96),
      new THREE.MeshBasicMaterial({
        color: 0x5eead4,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    this.scene.add(ring);
    this.cutRing = ring;
  }

  async loadVolume(binUrl, metaUrl) {
    const meta = await fetch(metaUrl).then((r) => r.json());
    const buf = await fetch(binUrl).then((r) => r.arrayBuffer());
    const data = new Uint8Array(buf);

    const w = meta.width, h = meta.height, d = meta.depth;
    const expected = w * h * d;
    if (data.length !== expected) {
      throw new Error(`体数据尺寸不符：拿到 ${data.length}，期望 ${expected}`);
    }

    const tex = new THREE.Data3DTexture(data, w, h, d);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;

    const sx = w, sy = h, sz = d;
    const longest = Math.max(sx, sy, sz);
    const k = 1.62 / longest;

    this.sizeV = new THREE.Vector3(sx * k, sy * k, sz * k);
    this.halfHeight = this.sizeV.y / 2;

    this.uniforms = {
      uVol: { value: tex },
      uSize: { value: this.sizeV },
      uSliceY: { value: this.halfHeight * 1.2 },
      uDensity: { value: 1.0 },
      uKeyDir: { value: new THREE.Vector3(0.45, 0.8, 0.65) },
    };

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.volume = new THREE.Mesh(geo, mat);
    this.volume.scale.copy(this.sizeV);
    this.scene.add(this.volume);

    this.fitCamera();
    return meta;
  }

  fitCamera() {
    const h = Math.tan((this.camera.fov * Math.PI) / 360);
    // 用体数据对角线的投影来定距离，保证整块都进画面
    const diag = this.sizeV.length();
    this.baseDist = diag / (2 * h);
    this.camera.near = 0.05;
    this.camera.far = 50;
    this.camera.updateProjectionMatrix();
    this.updateCamera();
  }

  updateCamera() {
    const az = THREE.MathUtils.degToRad(this.azimuth);
    const el = THREE.MathUtils.degToRad(this.elevation);
    const r = this.baseDist * this.distMul;
    this.camera.position.set(
      r * Math.cos(el) * Math.sin(az),
      r * Math.sin(el),
      r * Math.cos(el) * Math.cos(az)
    );
    this.camera.lookAt(0, 0, 0);
  }

  setYaw(deg) {
    this.azimuth = this.azimuthOffset + deg;
    this.updateCamera();
  }

  setPitch(deg) {
    this.elevation = this.baseElevation + deg;
    this.updateCamera();
  }

  setCameraDistance(mul) {
    this.distMul = mul;
    this.updateCamera();
  }

  setSlice(t) {
    if (!this.uniforms) return;
    const y = t >= 0.995 ? this.halfHeight * 1.25 : t * this.halfHeight;
    this.uniforms.uSliceY.value = y;

    const visible = t < 0.995;
    this.cutRing.visible = visible;
    this.cutRing.position.y = y;
    const r = Math.max(this.sizeV.x, this.sizeV.z) * 0.52;
    this.cutRing.scale.setScalar(r / 0.985);
  }

  setDensity(v) {
    if (this.uniforms) this.uniforms.uDensity.value = v;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
