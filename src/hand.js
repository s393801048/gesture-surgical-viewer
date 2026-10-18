import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// MediaPipe 手部 21 点连线
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: 'user',
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  await new Promise((resolve) => {
    if (videoEl.videoWidth > 0) return resolve();
    videoEl.onloadedmetadata = () => resolve();
  });
  return stream;
}

export async function createHandLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/models/hand_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
}

export class PipRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(video, landmarks) {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    ctx.save();
    // 镜像绘制，像照镜子
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    if (!landmarks) {
      ctx.fillStyle = 'rgba(4,7,11,.25)';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // 骨架：把关键点按视频画面比例映射到小窗
    const toX = (p) => (1 - p.x) * w;
    const toY = (p) => p.y * h;

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(94,234,212,.85)';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      ctx.moveTo(toX(landmarks[a]), toY(landmarks[a]));
      ctx.lineTo(toX(landmarks[b]), toY(landmarks[b]));
    }
    ctx.stroke();

    ctx.fillStyle = '#5eead4';
    for (const p of landmarks) {
      ctx.beginPath();
      ctx.arc(toX(p), toY(p), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
