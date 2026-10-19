import { Viewer } from './scene.js';
import { GestureController } from './gestures.js';
import {
  startCamera,
  createHandLandmarker,
  PipRenderer,
} from './hand.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

const viewCanvas = $('view');
const pipCanvas = $('pip');
const boot = $('boot');
const bootMsg = $('boot-msg');

const ui = {
  state: $('r-state'),
  yaw: $('r-yaw'),
  pitch: $('r-pitch'),
  zoom: $('r-zoom'),
  slice: $('r-slice'),
  palm: $('r-palm'),
  open: $('r-open'),
  fps: $('r-fps'),
  trackDot: $('track-dot'),
  trackText: $('track-text'),
  pipStatus: $('pip-status'),
};

const viewer = new Viewer(viewCanvas);
const gestures = new GestureController();
const pip = new PipRenderer(pipCanvas);

const video = document.createElement('video');
video.playsInline = true;
video.muted = true;
video.autoplay = true;
video.style.display = 'none';
document.body.appendChild(video);

let landmarker = null;
let lastVideoTime = -1;
let lastHands = [];
let lastTs = 0;
let fps = 0;
let fpsAccum = 0;
let fpsFrames = 0;
let uiTimer = 0;

const stateText = {
  IDLE: '未检测到',
  CALIBRATING: '校准中',
  TRACKING: '追踪中',
};

function setTrackUI(g) {
  const state = g.state;
  if (state === 'CALIBRATING') {
    ui.trackDot.className = 'zdot grab';
    const left = Math.max(0, CONFIG.calibrateFrames - (g.calibCount || 0));
    ui.trackText.textContent = `正在记住你的手型 · 手掌张开别动 · ${left}`;
  } else if (state === 'TRACKING' && g.peace) {
    ui.trackDot.className = 'zdot grab';
    ui.trackText.textContent = '切片模式 · 手上下移动推进切面';
  } else if (state === 'TRACKING' && g.zoomActive) {
    ui.trackDot.className = 'zdot grab';
    ui.trackText.textContent = '双手捏合 · 拉开放大，合拢缩小';
  } else if (state === 'TRACKING' && g.grab) {
    ui.trackDot.className = 'zdot grab';
    ui.trackText.textContent = '已抓住 · 移动手旋转，松拳后双手捏合缩放';
  } else if (state === 'TRACKING') {
    ui.trackDot.className = 'zdot ready';
    ui.trackText.textContent = '就位 · 握拳抓住画面';
  } else {
    ui.trackDot.className = 'zdot';
    ui.trackText.textContent = '未检测到手';
  }
}

function highlightLegend(g, hasHand) {
  for (const el of document.querySelectorAll('.gesture')) el.classList.remove('on');
  if (!hasHand) return;
  if (g.peace) {
    document.querySelector('.gesture[data-state="SLICE"]')?.classList.add('on');
    return;
  }
  if (g.zoomActive) {
    document.querySelector('.gesture[data-state="ZOOM"]')?.classList.add('on');
    return;
  }
  if (g.grab) {
    document.querySelector('.gesture[data-state="GRAB"]')?.classList.add('on');
    document.querySelector('.gesture[data-state="MOVE"]')?.classList.add('on');
  }
}

function refreshReadout(g) {
  const hasHand = g.state !== 'IDLE';
  ui.state.textContent = stateText[g.state];
  ui.yaw.textContent = `${g.yaw.toFixed(1)}°`;
  ui.pitch.textContent = `${g.pitch.toFixed(1)}°`;
  ui.zoom.textContent = `${Math.round(100 / g.zoom)}%`;
  ui.slice.textContent = `${Math.round(((g.slice + 1) / 2) * 100)}%`;
  ui.palm.textContent = hasHand ? g.palmWidth.toFixed(3) : '—';
  ui.open.textContent = hasHand ? g.opennessSmooth.toFixed(2) : '—';
  ui.fps.textContent = `${Math.round(fps)}`;
  ui.pipStatus.textContent = hasHand ? `手部追踪中 · ${g.handCount || 1} 只手` : '等待手入镜';
  setTrackUI(g);
  highlightLegend(g, hasHand);
}

async function boot_() {
  bootMsg.textContent = '正在载入 CT 影像';

  try {
    await viewer.loadVolume('/models/ct_volume.bin', '/models/ct_volume.json');
  } catch (err) {
    console.error(err);
    bootMsg.textContent = '影像载入失败，检查 public/models/ct_volume.bin';
    return;
  }

  bootMsg.textContent = '正在请求摄像头';

  try {
    await startCamera(video);
  } catch (err) {
    console.error(err);
    bootMsg.textContent = '摄像头没打开。允许权限后刷新页面。';
    boot.classList.add('hide');
    requestAnimationFrame(loop);
    return;
  }

  bootMsg.textContent = '正在载入手势模型';
  try {
    landmarker = await createHandLandmarker();
  } catch (err) {
    console.error(err);
    bootMsg.textContent = '手势模型载入失败，检查 public/models 与 public/wasm';
    return;
  }

  boot.classList.add('hide');
  lastTs = performance.now();
  requestAnimationFrame(loop);
}

function loop(now) {
  requestAnimationFrame(loop);

  const dt = Math.min(0.1, (now - lastTs) / 1000);
  lastTs = now;

  if (video.readyState >= 2) {
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      if (landmarker) {
        try {
          const res = landmarker.detectForVideo(video, now);
          const lms = res.landmarks ?? [];
          const handed = res.handednesses ?? [];
          lastHands = lms
            .map((landmarks, i) => ({ landmarks, label: handed[i]?.[0]?.categoryName ?? String(i) }))
            // 手从画面边缘出画时，21 点会短暂贴边抖动，直接丢掉这只手
            .filter(({ landmarks }) => {
              const xs = landmarks.map((p) => p.x);
              return Math.min(...xs) >= 0.02 && Math.max(...xs) <= 0.98;
            });
        } catch (err) {
          console.error('detect failed', err);
        }
      }
    }
  }

  const g = gestures.update(lastHands, now, dt);

  viewer.setYaw(g.yaw);
  viewer.setPitch(g.pitch);
  viewer.setSlice(g.slice);
  viewer.setCameraDistance(g.zoom);

  pip.draw(video, lastHands);

  if (landmarker) {
    fpsAccum += dt;
    fpsFrames++;
    if (fpsAccum >= 0.5) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }

  uiTimer += dt;
  if (uiTimer > 0.08) {
    uiTimer = 0;
    refreshReadout(g);
  }

  viewer.render();
}

window.__viewer = viewer;
window.__gestures = gestures;

boot_();
