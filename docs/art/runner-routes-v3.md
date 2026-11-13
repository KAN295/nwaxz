# 奶狗跑酷 · 新场景与强制动作障碍

2026-11-13，使用内置 `image_gen.imagegen` 生成。场景用于实际游玩，非入口展示图；代码只进行贴图投影、运动、镜头和提示，不用纯色形状替代场景。

## 资产与接入

- `public/assets/runner/temple-scene-v1.png`：遗迹长廊，低机位、大面积可跑地面。
- `public/assets/runner/mine-scene-v1.png`：矿洞轨道，木支架、灯具与碎石地面。
- `public/assets/runner/mandatory-obstacles-v1.png`：2×2透明图集，倒木、低门、矿车、横断沟。
- 保留原峡谷背景，调整镜头裁切和地面透视。菜单可选择起点场景，每450米切换到下一场景。
- 整路倒木/断沟必须跳，低门必须下滑；用独立的全宽碰撞判定，不因换道或换道中间位置漏判。可继续使用护盾和冲刺。
- 恐怖奶蛙复用原八向行走图集中的背面第4/12帧，撞击后才从奶狗后方逼近；正面图只用于菜单角色介绍。
- 奶狗渲染尺寸由176提高到200逻辑像素，保留原体型；根据窄屏调整轨道间距，避免大角色被裁出画面。

九张运行PNG均保留生成原尺寸和原字节，尺寸、字节数与SHA-256见 `public/assets/runner/manifest.json`。

## 遗迹长廊提示词

```text
Use case: photorealistic-natural.
Asset type: actual playable portrait background for third-person endless runner, 3:4 composition, NOT a cover illustration.
Primary request: a believable ancient weathered stone temple corridor in a humid subtropical gorge, open-sided tall stone arches, fern-covered pillars, wet aged limestone paving and warm shafts of morning light. Natural photorealistic materials, real-world scale, physically believable architecture, cinematic game environment photographed on location.
CRITICAL PLAYABLE FRAMING: very LOW chase camera, centered one-point perspective. Vanishing point at x50%, y22% of image. The CLEAR walkable path occupies the lower 78% of image. At y50% the playable paving spans x12% to88%; at the bottom it extends beyond BOTH image edges (x-10% to110%). Broad unobstructed unmarked three-lane floor, close paving texture large and readable. Side pillars and greenery stay outside the clear running corridor, never obscure the path. Do NOT make a tiny distant walkway with most of image filled by sky or cliffs. Close to the action, wide road, shallow horizon.
Empty running path with no coins, no crates, no barriers, no characters, no text, no arrows, no interface, no watermark. No copied game assets or recognizable branded landmarks. Fine realistic stone chips, moss in joints, puddles, worn steps flush with floor, subtle atmosphere. Rich detailed photographic image, no pure-color shapes, no cartoon polygons.
```

## 矿洞轨道提示词

```text
Use case: photorealistic-natural.
Asset type: actual playable portrait background for a third-person endless runner, 3:4 image.
Primary request: a realistic abandoned mountain mine tunnel with an extra-wide level gravel-and-stone running track. Weathered timber supports, rough excavated rock, rusted mine rails FLUSH with the floor, amber industrial lamps on sidewalls, faint cool daylight from a far tunnel mouth, realistic dust and damp surfaces. Believable old mine, not a fantasy dungeon. Natural photographic materials and cinematic realistic lighting, clear readable running floor.
CRITICAL CAMERA/COMPOSITION: low chase camera, centered one-point perspective, vanishing point x50%, y22%. Broad clear floor occupies lower78% of the picture. At y50% the unobstructed running surface spans x12%-88%; bottom edges extend beyond both image sides. Rails split the clear floor into approximately three routes but must not be raised hazards. Side support pillars stay outside running surface. Make the player feel inside the scene, not staring at a tiny road in a huge background.
No characters, no carts on the track, no fixed obstacles, no coins, no signage, no writing, no UI, no logo, no watermark. Detailed real textures, no flat colored geometry, no cartoon render. Darker than daylight but floor remains clearly lit and legible.
```

## 强制障碍提示词

```text
Use case: photorealistic-natural.
Asset type: genuine transparent game obstacle sprite atlas, exactly TWO columns and TWO rows of equal square cells, no text, no grid lines, no background, generous margins, physically realistic aged wood/stone/metal, consistent chase camera slightly looking down at the fronts.
Top left: one very WIDE low fallen tree trunk lying HORIZONTALLY ACROSS a running path. The log spans almost the full cell width, low height, about 3.5 times wider than tall. Real bark, moss, broken branch stubs contained inside silhouette. It is a mandatory JUMP obstacle, not a tall impassable wall.
Top right: one WIDE LOW overhead lattice iron gate held by two slim side posts. Spans almost entire cell width. The overhead gate hangs low, with a clearly visible crawl-space underneath. A dog must DUCK under it, not jump over. Real rusty iron, no spikes. Complete silhouette including posts and feet.
Bottom left: one single sturdy old minecart filled with rocks, three-quarter frontal view, rusty metal sides and real wheels. Whole cart inside cell, with coherent ground contact near bottom.
Bottom right: one broad shallow broken path crevasse stretching horizontally across the full cell width, dark rocky drop, jagged limestone edges, visible shadows and rocks below. Shallow-on-image ground-level cutout seen from chase perspective, not a raised block, no surrounding huge ground rectangle.
All four props are separate, entirely contained in their cells with at least5% transparent margin. Natural realistic surfaces, no flat-colored geometry. No people, no characters, no lettering, no UI, no logos, no fake checkerboard.
```
