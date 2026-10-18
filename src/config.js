// 阈值都在这里。地址后面加 ?debug，右下角显示实时读数。

export const CONFIG = {
  calibrateFrames: 45,

  // ---- 离合：握拳抓住，手移动，松拳停下 ----
  grabEnter: 0.40, // 四指伸直程度低于这个值算握拳
  grabExit: 0.55, // 高于这个值算松拳

  // ---- 抓住期间，手移动多少对应转多少度 ----
  // 手横移 0.26 个画面宽度 = 转 180 度。一次抓握够转半圈，两三次转一圈。
  yawPerUnit: 700,
  pitchPerUnit: 260,
  pitchLimit: 38,
  invertYaw: false, // 默认手往右画面往右转；想反过来改成 true
  invertPitch: false, // 默认手往上画面往上翻；想反过来改成 true

  // ---- 抓住期间，手掌大小变化对应缩放 ----
  // 手掌宽度已经做了平滑，再加一层死区，手静止时画面不会来回抖
  zoomDeadZone: 0.06, // 手掌宽度变化超过 6% 才算动作
  zoomGain: 1.5, // 手掌变化 20% 对应画面变化 21%
  zoomNear: 0.52,
  zoomFar: 1.32,

  // ---- 切片：比耶进入，手上下移动推进 ----
  peaceEnterIndex: 0.70,
  peaceEnterCurl: 0.38,
  slicePerUnit: 3.0,
  sliceMin: -0.85,

  lostTimeoutMs: 260,
  debug: new URLSearchParams(location.search).has('debug'),
};
