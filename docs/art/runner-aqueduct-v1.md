# 奶蛙逃亡 · 写实水渠场景

2026-11-13，使用内置 `image_gen.imagegen` 生图功能生成。全部成品以原尺寸、原始 PNG 字节复制到项目，未用代码重绘或替换画面。

- `public/assets/runner/aqueduct-scene-v1.png`：真实世界风格的峡谷、古水渠、植被和晨光；用于实际游戏背景及首页入口。
- `public/assets/runner/wet-stone-v1.png`：正交俯视湿石板材质，用于动态地面透视投影。
- `public/assets/runner/obstacles-v1.png`：透明 2×2 障碍与泡泡币图集，依次为木箱、横梁、断桥、金币。

代码只负责既有图像的贴图投影、位移、碰撞和 HUD，不绘制纯色场景代替生图。角色复用项目既有图集；本批未重画奶蛙。

完整尺寸、字节数、SHA-256 和透明度记录见 `public/assets/runner/manifest.json`。

## 场景完整提示词

```text
Use case: photorealistic-natural.
Asset type: production background painting for a third-person endless runner game, portrait 1536x2048 composition.
Primary request: a believable real-world ancient aqueduct footbridge through a humid subtropical limestone gorge at early morning. Photographic, physically based materials and natural indirect light, like a high-end real-time game captured in a real location, not a flat illustration.
Composition: centered one-point perspective, vanishing point exactly at 50% width and 32% height. A broad flat walkable wet stone causeway with three equally wide UNMARKED lanes occupies the lower 68 percent, converging to a tiny distant arch. At the bottom, road left/right edges sit at 4% and 96% image width; at 32% height they converge around center. The path must remain empty and free of fixed obstacles so game-controlled objects can be placed there. On both sides: shallow running water channels, weathered stone balustrades, moss-covered masonry, ferns and hanging vines. Towering eroded cliffs and dense real foliage frame the sides. Warm dawn light from behind a distant worn stone arch, atmospheric depth, fine mist. Visible stone pores, mineral deposits, chipped edges, subtle puddle reflections; lush muted green and warm limestone tones. A small realistically constructed arched aqueduct is visible in the distance, no impossible architecture.
No frog, no people, no animals, no obstacles or coins in the path, no text, no typography, no logo, no watermark, no UI, no lane paint, no modern road. No simplistic polygons, no pure-color fills, no toon shading. Make this a rich natural environment that can be used as the actual game scene and cropped for the entry poster.
```

## 地面完整提示词

```text
Use case: photorealistic-natural.
Asset type: seamless ground material, square 1024x1024 bitmap for a perspective-mapped ancient aqueduct running track.
Primary request: an orthographic straight-down photograph of a real wet limestone paving surface. Large irregular rectangular hand-hewn grey-beige slabs, restrained dark moss in narrow joints, subtle chips and mineral discoloration, fine pores, damp specular stone surface with thin shallow puddles. Soft diffuse early morning light. Visually compatible with an ancient aqueduct in a green limestone gorge. The texture must tile seamlessly along all four edges. No perspective, no horizon, no large distinctive object, no raised obstacles, no foliage covering the path, no writing, no lane markings, no frame, no label, no grid overlay, no pure flat color. High-resolution natural realistic material.
```

## 道具完整提示词

```text
Use case: photorealistic-natural.
Asset type: production game sprite sheet, four realistic isolated props on genuine transparent background, square image 1024x1024, exactly TWO columns and TWO rows of equal 512x512 cells. Each object wholly inside its own cell with at least 45 pixels of transparent margin. NO labels, NO border, NO grid lines, NO text, NO background environment, NO checkerboard.
Lighting: soft natural dawn illumination from upper left. Style: physically believable photographed real materials, aged aqueduct adventure.
Camera: third-person chase camera looking slightly down, object fronts visible and ground-contact edges aligned horizontally, matching a running player approaching the object.
Top left cell: one sturdy waist-high weathered wooden shipping crate, iron corner bands, wood grain, chipped damp edges, low rectangular three-dimensional box, complete silhouette, ground contact around cell y=460.
Top right cell: one complete freestanding low overhead timber crossbar supported by TWO slender vertical posts, rusty brackets and moss; crossbar positioned in upper third of the prop, clear open space below so a crouching runner can slide under it. Posts stand on ground at y=460.
Bottom left cell: a wide shallow broken limestone path chasm seen slightly from above, jagged rocky lip around dark deep crevice and visible wet rocks and water far below. Ground-level obstacle, wide horizontal silhouette, no huge solid base cube, most of transparent cell unused above the crevice.
Bottom right cell: one beautiful small brass collectible coin with a simple embossed water droplet emblem, real metallic gold texture, no letters or numbers, standing upright and facing the camera, soft rim highlights. Coin centered.
Do not make any cartoon geometry or flat colors. Four clearly separated usable complete game props, no cast shadow extending outside each cell.
```

