# 跑酷贴图与下坠图集

三张素材均由内置 imagegen 生成，原图保存在 `public/assets/runner/`。

| 文件 | 用途与提示词要点 |
| --- | --- |
| `flame-v2.png` | 透明火焰簇，浅黄火根与向上翻卷的橙色细火舌，要求真实光感和无底座的透明边缘。贴在交错的曲面网格上，各簇以不同节奏缩放、摆动。 |
| `pit-water-v1.png` | 俯视湿岩洞的深青色水面，整张为带细小反光和不规则波纹的表面纹理。不同长度的坑使用不同的重复密度。 |
| `milk-dog-fall-v1.png` | 参考原始黄色奶狗动作图，保持后侧视角、圆身、垂耳和卷尾。4×2 的连续动作从前爪探空、重心前倾到后腿和四爪收拢。 |

## 生图提示词

**火焰**

> Create a real-looking cluster of free air flames as an isolated vertical 2D RGBA texture for curved transparent 3D geometry in an adventure game. One flame cluster only, centered and frontal. A wide ragged translucent pale yellow-orange ignition area at the very bottom, then a few long thin twisting tongues of amber and desaturated orange with airy smoke-free tips. Natural photographic gas or wildfire flame translucency, bright soft center, fine flowing internal turbulent folds, fading transparent low-alpha edges, distinct silhouette. Flame touches down in individual wisps without a straight line. The entire canvas outside and between all visible flames must be genuinely alpha transparent. No source of fuel, logs, stone, floor, rectangular platform, brazier, base, embers or sparks, backdrop, text or frame. Tall square atlas with modest margins, leave top and sides away from frame boundaries.

**水面**

> A seamless square overhead texture tile of deep, still dark teal water inside a wet stone cavern. Surface alone fills the entire image edge-to-edge viewed straight down, with authentic irregular shallow ripple rings, fine sharp little reflective glints in dim cool daylight, gentle surface waves, very subtle pale green undertones. Repeating material with consistent scale and brightness at the edges. You can see the surface but not the lake bottom. Avoid any banks, rocks, pebbles, sky, vegetation, boats, splashes, text, seams, vignette, ambient light gradient or tile pattern. Natural subdued lighting on the water, not a solid-color texture.

**下坠图集**

参考图使用 `public/assets/runner/milk-dog-actions-v2.png`。

> A new 2D transparent 4-column by 2-row eight-frame falling animation of the EXACT same round yellow milk dog with brown floppy ears and small curled tail from the supplied reference. Preserve his soft clay illustration style, yellow original coat, proportions, all four dog legs, and posterior three-quarter camera direction. He is travelling away from the camera toward the upper left in every pose. All eight cells equal, no crops or crowded poses, one dog fully inside each cell at identical scale, isolated transparent background. Each pose is centered and the animation will be moved down by the game engine, do not add a pit or ground. Reading order: 1 front paws step into thin air while hind paws are still stretched back, 2 shoulders dip, forepaws reach downward and the ears lift, 3 snout pitches down further as the forelegs reach and hind legs rise, 4 tuck the hind legs and twist slightly off balance, 5 all four paws bend inward beneath the round body, ears flutter upward, 6 brief shoulder-first downward tumble, 7 compact tucked descent, 8 small further roll while still facing away. Natural weight shift from pose to pose, body deformation only from motion. True transparent background, no scenery, shadow, markings, labels, lettering or borders.
