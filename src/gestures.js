import { CONFIG } from './config.js';
import { OneEuro, clamp, lerp } from './filter.js';

const IDLE = 'IDLE';
const CALIBRATING = 'CALIBRATING';
const TRACKING = 'TRACKING';

const WRIST = 0;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

const FINGERS = [
  [INDEX_MCP, INDEX_PIP, INDEX_TIP],
  [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP],
  [RING_MCP, RING_PIP, RING_TIP],
  [PINKY_MCP, PINKY_PIP, PINKY_TIP],
];

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 两节指骨的夹角。伸直接近 1，蜷曲接近 0
function fingerStraightness(mcp, pip, tip) {
  const v1x = pip.x - mcp.x, v1y = pip.y - mcp.y;
  const v2x = tip.x - pip.x, v2y = tip.y - pip.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return 0;
  const cos = clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1, 1);
  return clamp(1 - Math.acos(cos) / (Math.PI * 0.8), 0, 1);
}

const mapRange = (v, a, b, c, d) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return c + (d - c) * t;
};

export class GestureController {
  constructor() {
    this.state = IDLE;
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1.0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.zoomVel = 0;
    this.zoomInOpen = 0.95;
    this.zoomOutOpen = 0.55;
    this.slice = 1;

    this.fx = new OneEuro({ minCutoff: 0.85, beta: 0.03, dCutoff: 1.0 });
    this.fy = new OneEuro({ minCutoff: 0.85, beta: 0.03, dCutoff: 1.0 });
    this.fopen = new OneEuro({ minCutoff: 1.8, beta: 0.03, dCutoff: 1.0 });
    this.fpalm = new OneEuro({ minCutoff: 1.2, beta: 0.015, dCutoff: 1.0 });

    this.lastSeen = -Infinity;
    this.calib = null;
    this.calibSamples = [];

    this.peace = false;
    this.peaceAnchorY = 0;
    this.grab = false;
    this.anchorX = 0;
    this.anchorY = 0;
    this.anchorPalm = 0;
    this.anchorZoom = 1;

    this.metrics = {
      openness: 0, palmWidth: 0, pinch: 0,
      cx: 0.5, cy: 0.5, fingers: [0, 0, 0, 0],
    };
  }

  reset() {
    this.state = IDLE;
    this.peace = false;
    this.grab = false;
    this.fx.reset();
    this.fy.reset();
    this.fopen.reset();
    this.fpalm.reset();
  }

  update(landmarks, now, dt) {
    if (!landmarks || landmarks.length < 21) {
      if (now - this.lastSeen > CONFIG.lostTimeoutMs && this.state !== IDLE) this.reset();
      return this.snapshot();
    }

    this.lastSeen = now;
    const t = now / 1000;

    const P = landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));

    const fingers = FINGERS.map(([m, p, q]) => fingerStraightness(P[m], P[p], P[q]));
    const opennessRaw = fingers.reduce((a, b) => a + b, 0) / fingers.length;
    const palmWidth = this.fpalm.filter(dist2(P[INDEX_MCP], P[PINKY_MCP]), t);
    const pinch = dist2(P[4], P[INDEX_TIP]) / Math.max(1e-4, palmWidth);
    const cx = this.fx.filter((P[WRIST].x + P[MIDDLE_MCP].x) / 2, t);
    const cy = this.fy.filter((P[WRIST].y + P[MIDDLE_MCP].y) / 2, t);
    const openness = this.fopen.filter(opennessRaw, t);

    this.metrics = { openness: opennessRaw, opennessSmooth: openness, palmWidth, pinch, cx, cy, fingers };

    // ---- 校准：把手掌位置记成旋转的中心 ----
    if (!this.calib) {
      this.state = CALIBRATING;
      this.calibSamples.push({ cx, cy, openness });
      if (this.calibSamples.length >= CONFIG.calibrateFrames) {
        const n = this.calibSamples.length;
        this.calib = {
          cx: this.calibSamples.reduce((a, s) => a + s.cx / n, 0),
          cy: this.calibSamples.reduce((a, s) => a + s.cy / n, 0),
          openness: this.calibSamples.reduce((a, s) => a + s.openness / n, 0),
        };
        this.calibSamples = [];
      }
      return this.snapshot();
    }

    this.state = TRACKING;
    const base = this.calib;

    // ---- 比耶：进入切片模式 ----
    const rawIsPeace =
      fingers[0] > CONFIG.peaceEnterIndex &&
      fingers[1] > CONFIG.peaceEnterIndex &&
      fingers[2] < CONFIG.peaceEnterCurl &&
      fingers[3] < CONFIG.peaceEnterCurl;

    if (!this.peace && rawIsPeace) {
      this.peace = true;
      this.peaceAnchorY = cy;
    } else if (this.peace && (fingers[2] > CONFIG.peaceEnterCurl + 0.15 || fingers[0] < 0.4)) {
      this.peace = false;
    }

    if (this.peace) {
      this.grab = false;
      const dy = this.peaceAnchorY - cy;
      if (Math.abs(dy) > 0.003) {
        this.slice = clamp(this.slice - dy * CONFIG.slicePerUnit, CONFIG.sliceMin, 1);
        this.peaceAnchorY = cy;
      }
      return this.snapshot();
    }

    // ---- 握拳：离合接上。松拳：离合断开 ----
    if (!this.grab && opennessRaw < CONFIG.grabEnter) {
      this.grab = true;
      this.anchorX = cx;
      this.anchorY = cy;
      this.anchorPalm = palmWidth;
      this.anchorZoom = this.zoom;
    } else if (this.grab && opennessRaw > CONFIG.grabExit) {
      this.grab = false;
    }

    if (!this.grab) {
      return this.snapshot();
    }

    // 抓住期间才响应移动，按相对位移累积
    const dx = cx - this.anchorX;
    if (Math.abs(dx) > 0.005) {
      // 默认「画面跟着手走」：手往右，模型往右转。和拖拽、转盘、OrbitControls 一致
      this.yaw += dx * CONFIG.yawPerUnit * (CONFIG.invertYaw ? 1 : -1);
      this.yaw = ((this.yaw + 180) % 360 + 360) % 360 - 180;
      this.anchorX = cx;
    }

    const dy2 = cy - this.anchorY;
    if (Math.abs(dy2) > 0.005) {
      // 上下同样跟着手走：手往上，模型正面往上翻，露出底部
      this.pitch = clamp(
        this.pitch + dy2 * CONFIG.pitchPerUnit * (CONFIG.invertPitch ? 1 : -1),
        -CONFIG.pitchLimit,
        CONFIG.pitchLimit
      );
      this.anchorY = cy;
    }

    // 缩放跟着手掌大小走：手推近镜头，手掌变大，画面跟着放大。
    // 死区 6% 之内算没动，避免手静止时来回抖。
    if (this.anchorPalm > 1e-4) {
      const ratio = palmWidth / this.anchorPalm;
      const adj = ratio - 1;
      const dz = CONFIG.zoomDeadZone;
      let eff = 0;
      if (Math.abs(adj) > dz) {
        eff = adj - Math.sign(adj) * dz;
      }
      const target = clamp(
        this.anchorZoom * (1 - eff * CONFIG.zoomGain),
        CONFIG.zoomNear,
        CONFIG.zoomFar
      );
      const kz = 1 - Math.exp(-14 * dt);
      this.zoom += (target - this.zoom) * kz;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      state: this.state,
      mode: this.peace ? 'SLICE' : (this.grab ? 'GRAB' : 'FREE'),
      peace: this.peace,
      grab: this.grab,
      yaw: this.yaw,
      pitch: this.pitch,
      zoom: this.zoom,
      slice: this.slice,
      calib: this.calib,
      calibCount: this.calibSamples.length,
      ...this.metrics,
    };
  }
}
