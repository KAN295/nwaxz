# 跑酷夜景与 2D 角色 / 3D 场景

2026-11-13，按用户最后选择，场景、道路、障碍和天气由 Babylon.js 三维渲染，角色恢复原有透明 2D 图集。奶狗使用八帧四足奔跑及独立动作，恐怖奶蛙使用背面追赶帧；被抓住时切换原奶蛙捧腹大笑图与奶狗失误图，整体上移表现举高，属于图片动画，不是骨骼抓取。原素材不改写，普通模式大笑保留。

夜景由内置 image_gen 编辑对应原场景，保留写实材质并加入暖色路灯；保存原始 PNG，未重编码。道路的立体路灯与最低环境光保证夜间可见。三张夜景分别为 `public/assets/runner/aqueduct-night-v1.png`、`temple-night-v1.png`、`mine-night-v1.png`，哈希和尺寸见素材 manifest。

## 峡谷水渠完整提示词

```text
Use case: lighting-weather.
Asset type: playable NIGHT variation of the provided endless runner aqueduct scene.
Input image1 is the edit target. Keep the exact path width, perspective, architecture, cliffs, foliage and empty unobstructed walkable path. Change daylight to a luminous blue night/late blue hour, with gentle cool ambient skylight and a few stars visible above. ADD real old-fashioned metal STREET LAMPS with warm amber glass lanterns regularly spaced along BOTH balustrades. Lamps must illuminate the full road with overlapping warm pools of light, readable wet stone surfaces and bright reflections, never block the route.
CRITICAL GAMEPLAY READABILITY: overall MID-BRIGHT night image, NOT near-black, NOT horror darkness. Every foreground paving joint and both road edges clearly readable, similar luminance to a well-lit city street at night. No deep black areas across the running track. Keep foreground light enough to clearly distinguish dark obstacles and the yellow dog later composited by the game.
No characters, no coins, no fixed obstacles, no text, no UI, no logos, no watermark. Photographic realistic materials. Preserve original image geometry and portrait framing; no new pathways, no camera change.
```

## 遗迹长廊完整提示词

```text
Use case: lighting-weather.
Image1 is the target playable temple corridor background. Preserve exact path, camera, geometry and clear floor. Make a WELL-LIT NIGHT scene: cool blue ambient moonlight through the arches, warm practical brass STREET LAMPS along both sides on slim posts outside the path, and several hanging lanterns beneath the arches. Real pools of light overlap across the whole floor. Rich realistic wet stone reflections and visible details.
Maintain strong overall gameplay readability: mid-bright exposure, foreground floor and road edges clearly visible, NO black stretches, NO deep shadow hiding obstacles, no crushed blacks. Like a safely lit pedestrian arcade at night, NOT a near-dark horror image.
Do not move the camera, narrow the path, add obstacles/characters/coins or text/UI/watermarks. Photographic physical materials, same portrait composition and world layout as original.
```

## 矿洞轨道完整提示词

```text
Use case: lighting-weather.
Edit target image1 is the real mine tunnel runner background. Preserve the exact mine architecture, rails, wide empty floor and chase-camera perspective.
Make the tunnel a well-lit NIGHT stage: deep blue night visible at the far exit, warm ELECTRIC STREET LAMPS on slim side posts regularly spaced beside the tracks and bright hanging practical lanterns on the support beams. A luminous gold/blue mixed-light look with overlapping lamps illuminating all three running lanes.
Keep the overall exposure bright enough for gameplay: gravel stones, rails and floor edges clearly visible across the whole foreground, including the center and lower corners. No black gaps between lamps, no crushed shadows, no dark vignette. Physically plausible mine lighting, rich realistic weathered rock/wood/metal details.
No added obstacles on the floor, no carts, no characters, no coins, no writing, no arrows, no UI, no watermark. Keep same portrait image layout and surface geometry.
```
