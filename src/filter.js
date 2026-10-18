// One Euro 滤波：慢速移动时平滑力度大，快速移动时放宽平滑减少延迟。
// 每个量配一个持久实例，不要每帧新建，否则滤波状态会丢。

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x, t) {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    // 时间步长做钳制：切标签页回来时不要一次跳很远的 dt
    let dt = t - this.tPrev;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);

    const dx = (x - this.xPrev) / dt;
    const aD = alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }
}

export class ScalarFilter {
  constructor(opts) {
    this.f = new OneEuro(opts);
  }
  reset() {
    this.f.reset();
  }
  update(v, t) {
    return this.f.filter(v, t);
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
