import { CONFIG } from './config.js';
import { OneEuro, clamp } from './filter.js';

const IDLE = 'IDLE';
const CALIBRATING = 'CALIBRATING';
const TRACKING = 'TRACKING';

const WRIST = 0;
const THUMB_TIP = 4;
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

export class GestureController {
  constructor() {
    this.state = IDLE;
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1.0;
    this.zoomTarget = 1.0;
    this.slice = 1;

    // 每只手各一套滤波器，按左右手分开存，两只手的数据不能混在一起滤
    this.handFilters = new Map();
    this.handPinch = new Map();
    this.fdist = new OneEuro({ minCutoff: 0.8, beta: 0.02, dCutoff: 1.0 });

    this.lastSeen = -Infinity;
    this.calib = null;
    this.calibSamples = [];

    this.peace = false;
    this.peaceAnchorY = 0;
    this.grab = false;
    this.anchorX = 0;
    this.anchorY = 0;

    this.zoomActive = false;
    this.zoomStartDist = 0;
    this.zoomStartValue = 1;

    this.handCount = 0;
    this.pinchCount = 0;
    this.handInfo = [];
    this.pinchSpan = 0;

    this.metrics = {
      openness: 0, opennessSmooth: 0, palmWidth: 0, pinch: 0,
      cx: 0.5, cy: 0.5, fingers: [0, 0, 0, 0],
    };
  }

  _filters(label) {
    let f = this.handFilters.get(label);
    if (!f) {
      f = {
        fx: new OneEuro({ minCutoff: 0.85, beta: 0.03, dCutoff: 1.0 }),
        fy: new OneEuro({ minCutoff: 0.85, beta: 0.03, dCutoff: 1.0 }),
        fopen: new OneEuro({ minCutoff: 1.8, beta: 0.03, dCutoff: 1.0 }),
        fpalm: new OneEuro({ minCutoff: 1.2, beta: 0.015, dCutoff: 1.0 }),
      };
      this.handFilters.set(label, f);
    }
    return f;
  }

  _metrics(landmarks, label, t) {
    const P = landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
    const fingers = FINGERS.map(([m, p, q]) => fingerStraightness(P[m], P[p], P[q]));
    const opennessRaw = fingers.reduce((a, b) => a + b, 0) / fingers.length;
    const f = this._filters(label);

    // 手的长度基准：手腕到中指根。手一伸一缩，分子分母一起变，比值不受影响
    const handSize = Math.max(1e-4, dist2(P[WRIST], P[MIDDLE_MCP]));
    const palmWidth = f.fpalm.filter(dist2(P[INDEX_MCP], P[PINKY_MCP]), t);
    const pinchRatio = dist2(P[THUMB_TIP], P[INDEX_TIP]) / handSize;
    // 中指伸出的程度。握拳时很小，捏合时接近伸直
    const reachRatio = dist2(P[WRIST], P[MIDDLE_TIP]) / handSize;

    const cx = f.fx.filter((P[WRIST].x + P[MIDDLE_MCP].x) / 2, t);
    const cy = f.fy.filter((P[WRIST].y + P[MIDDLE_MCP].y) / 2, t);
    const openness = f.fopen.filter(opennessRaw, t);

    return { label, P, fingers, opennessRaw, openness, palmWidth, pinchRatio, reachRatio, cx, cy };
  }

  _pinchPoint(P) {
    return {
      x: (P[THUMB_TIP].x + P[INDEX_TIP].x) / 2,
      y: (P[THUMB_TIP].y + P[INDEX_TIP].y) / 2,
    };
  }

  reset() {
    this.state = IDLE;
    this.peace = false;
    this.grab = false;
    this.zoomActive = false;
    for (const f of this.handFilters.values()) {
      f.fx.reset();
      f.fy.reset();
      f.fopen.reset();
      f.fpalm.reset();
    }
    this.handPinch.clear();
    this.fdist.reset();
  }

  update(hands, now, dt) {
    if (!hands || !hands.length) {
      if (now - this.lastSeen > CONFIG.lostTimeoutMs && this.state !== IDLE) this.reset();
      return this.snapshot();
    }

    this.lastSeen = now;
    const t = now / 1000;

    const H = hands.map(({ landmarks, label }) => this._metrics(landmarks, label, t));
    this.handCount = H.length;

    // 每只手判捏合。进入和退出用两个阈值；握拳时中指蜷着，不算捏合
    for (const h of H) {
      const was = this.handPinch.get(h.label) === true;
      const freeHand = h.reachRatio > CONFIG.pinchReachMin;
      const on = was
        ? h.pinchRatio < CONFIG.pinchExit && freeHand
        : h.pinchRatio < CONFIG.pinchEnter && freeHand;
      this.handPinch.set(h.label, on);
      h.pinch = on;
    }

    const pinching = H.filter((h) => h.pinch);
    this.pinchCount = pinching.length;
    this.handInfo = H.map((h) => ({
      label: h.label,
      openness: h.opennessRaw,
      pinchRatio: h.pinchRatio,
      reachRatio: h.reachRatio,
      pinch: h.pinch,
    }));

    // 主手：取握拳的那只。正在捏合的手不算握拳，免得捏合时画面转起来
    const primary = H.find((h) => h.opennessRaw < CONFIG.grabEnter && !h.pinch) ?? H[0];
    this.metrics = {
      openness: primary.opennessRaw,
      opennessSmooth: primary.openness,
      palmWidth: primary.palmWidth,
      pinch: primary.pinchRatio,
      cx: primary.cx,
      cy: primary.cy,
      fingers: primary.fingers,
    };

    // ---- 校准：把手的位置记成旋转的中心 ----
    if (!this.calib) {
      this.state = CALIBRATING;
      this.calibSamples.push({ cx: primary.cx, cy: primary.cy, openness: primary.openness });
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

    // ---- 双手捏合：拉开放大，合拢缩小 ----
    if (pinching.length === 2) {
      const raw = dist2(this._pinchPoint(pinching[0].P), this._pinchPoint(pinching[1].P));
      const span = this.fdist.filter(raw, t);
      this.pinchSpan = span;

      if (!this.zoomActive) {
        if (span > CONFIG.pinchMinSpan) {
          this.zoomActive = true;
          this.zoomStartDist = span;
          this.zoomStartValue = this.zoom;
          this.zoomTarget = this.zoom;
        }
      } else {
        const target = clamp(
          this.zoomStartValue * (this.zoomStartDist / Math.max(1e-4, span)),
          CONFIG.zoomNear,
          CONFIG.zoomFar
        );
        const d = target - this.zoomTarget;
        if (Math.abs(d) > CONFIG.zoomDeadZone) this.zoomTarget = target;
        else this.zoomTarget += d * 0.02; // 死区里的小变化慢慢渗过去
        const kz = 1 - Math.exp(-CONFIG.zoomSmooth * dt);
        this.zoom += (this.zoomTarget - this.zoom) * kz;
      }

      this.grab = false;
      this.peace = false;
      return this.snapshot();
    }
    this.zoomActive = false;
    this.pinchSpan = 0;

    const { fingers, cx, cy, opennessRaw } = primary;

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
      // 手往上，画面往上转；手往下，画面往下转
      this.pitch = clamp(
        this.pitch + dy2 * CONFIG.pitchPerUnit * (CONFIG.invertPitch ? -1 : 1),
        -CONFIG.pitchLimit,
        CONFIG.pitchLimit
      );
      this.anchorY = cy;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      state: this.state,
      mode: this.peace ? 'SLICE' : (this.zoomActive ? 'ZOOM' : (this.grab ? 'GRAB' : 'FREE')),
      peace: this.peace,
      grab: this.grab,
      zoomActive: this.zoomActive,
      handCount: this.handCount,
      pinchCount: this.pinchCount,
      handInfo: this.handInfo || [],
      pinchSpan: this.pinchSpan,
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
