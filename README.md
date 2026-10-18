# 手势控制三维医学影像查看器

用摄像头识别手部动作，隔空操控一份真实的胸部 CT 三维影像。不戴设备，不碰键鼠。

这是一个**演示项目**，用来讲清楚医院手术室里「隔空调阅影像」这件事是怎么实现的。它不是医疗器械，不能用于任何临床用途。

<!-- 放一张截图：docs/screenshot.png -->

## 它能做什么

| 动作 | 效果 |
| :--- | :--- |
| 张开手掌 | 不操作，可以自由挪手 |
| 握拳 | 抓住画面，离合接上 |
| 抓住后左右移 | 左右旋转 |
| 抓住后上下移 | 上下俯仰 |
| 抓住后往镜头推 / 往回收 | 放大 / 缩小 |
| 松拳 | 松开，画面停在原处 |
| 比耶 | 切片模式，手上下移动逐层切开 |

握拳是离合：接上以后手才控制画面，松开以后手怎么动都不影响。转不够就松拳、把手挪回舒服的位置、再握拳接着转。

## 快速开始

需要 Node.js 18 以上。

```bash
git clone <仓库地址>
cd gesture-surgical-viewer
npm install
npm run dev
```

终端会给一个地址（默认 `http://localhost:5173`），用 Chrome 打开，允许摄像头。

第一次把手放进画面时，底部会提示「正在记住你的手型」。这时候**张开手掌放在画面中间别动**，等它记完。后面所有动作都相对这个基准判断。

打包成离线版本：

```bash
npm run build
npm run preview
```

## 技术栈

- **手部追踪**：[MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)，输出 21 个手部关键点
- **三维渲染**：three.js，用 `Data3DTexture` 加光线步进（raymarching）直接渲染 CT 体数据
- **平滑**：One Euro 滤波，抑制关键点抖动
- **构建**：Vite

## 稳定性怎么保证

手势交互最容易翻车的地方是抖动。这个项目做了几件事：

1. 关键点和派生量都过 One Euro 滤波，慢速移动时平滑力度大，快速移动时放宽以减少延迟。
2. 位移有死区，小于 0.5% 画面宽度不算动作。
3. 缩放有 6% 死区，手静止时手掌宽度的正常波动不会触发。
4. 握拳和比耶用滞回判定，避免在阈值边界反复切换。
5. 离合式操作：只有握住的时候才响应，松手以后画面完全静止。

## 目录结构

```
src/
  main.js       主循环，把手势状态接到三维场景
  gestures.js   手势识别与状态机
  hand.js       MediaPipe 接入、摄像头小窗绘制
  filter.js     One Euro 滤波
  scene.js      three.js 场景与体渲染着色器
  config.js     所有可调阈值
public/
  models/       CT 体数据与手部模型
  wasm/         MediaPipe 运行时
```

## 调参

地址后面加 `?debug`，右下角会显示实时读数，每行都标了当前判定线。所有阈值在 `src/config.js` 里，改完存盘页面自动刷新。

更详细的调试方法见 `拍摄说明.md`。

## 数据来源与许可

- **CT 体数据**：来自 [LIDC-IDRI](https://www.cancerimagingarchive.net/collection/lidc-idri/) 公开数据集（CC BY 3.0），经 [Mes_Poumons_3D_unet](https://huggingface.co/datasets/Yousra0x0/Mes_Poumons_3D_unet) 的 LIDC-IDRI-0575 一例转换而来，已降采样为 190×180×174 的 8 位体数据
- **手部关键点模型**：MediaPipe Hand Landmarker，Apache-2.0
- **三维渲染**：three.js，MIT

## 免责声明

本项目是技术演示，**不是医疗器械，不用于任何诊断或治疗用途**。界面上的「模拟演示 · 非临床系统」角标请保留。

影像数据来自公开科研数据集，不是真实手术病例。

## 许可

代码以 MIT 许可发布，见 [LICENSE](LICENSE)。
