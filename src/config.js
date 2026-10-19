// 阈值都在这里。

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

  // ---- 缩放：双手捏合 ----
  // 拇指尖到食指尖除以手腕到中指根。手离镜头远近、手在画面哪个位置都不影响这个比值。
  // 中指蜷着（握拳）时不算捏合，避免握拳被当成捏住。
  pinchEnter: 0.45, // 低于这个比值算捏住
  pinchExit: 0.60, // 高于这个比值算松开
  pinchReachMin: 1.20, // 中指伸出程度要高于这个值才算捏合
  pinchMinSpan: 0.08, // 两手间距小于这个值不启动缩放
  zoomSmooth: 9,
  zoomDeadZone: 0.02,
  zoomNear: 0.52,
  zoomFar: 1.32,

  // ---- 切片：比耶进入，手上下移动推进 ----
  peaceEnterIndex: 0.70,
  peaceEnterCurl: 0.38,
  slicePerUnit: 3.0,
  sliceMin: -0.85,

  lostTimeoutMs: 260,
};
