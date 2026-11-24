# 跑酷树木与道具贴图

六种树木和两张拾取物图标由内置 imagegen 逐张生成。游戏版做了透明边缘清理、缩放和 WebP 压缩。树木贴图位于 `public/assets/runner/trees/`，沿跑道两侧轮换，各场景实例使用自己的两种贴图。

## 树木

每棵树使用以下共通提示词，配合表中对应的主体描述。

> Render one single complete tree or woody root asset viewed at standing eye level from a three-quarter angle, full trunk from root tips to crown, all silhouettes contained inside the image with room around it. Realistic photographic bark and foliage details, soft overcast light, neutral unobtrusive exposure and believable color. Ground anchor at the very bottom of the trunk around 91% down the image. Isolated truly transparent RGBA backdrop, including between leaves and branches. No ground, no horizon, no scenery, no rock mound, no sky, scene lighting, labels, frames, lettering or watermark. Silhouette must read at small game sizes. No painted white matte.

| 场景与文件 | 主体提示词 |
| --- | --- |
| 峡谷水渠 `river-cypress-v1.webp` | A mature riverbank bald cypress, upright tapered crown of feathery soft dark sage leaves in irregular clumps, a few wet exposed woody roots and textured ridged gray bark, with open patches between some branches. |
| 峡谷水渠 `river-willow-v1.webp` | A leaning, open-crowned riverside weeping willow, thin drooping strands of yellow-green leaves, divided gray-brown trunk, and visible fine exposed roots. |
| 遗迹长廊 `temple-banyan-v1.webp` | A sprawling ancient subtropical banyan beside a ruined stone temple, rounded asymmetric dark jade canopy and intricate interwoven aerial roots and twisted brown trunk. |
| 遗迹长廊 `temple-maple-v1.webp` | A mature woodland maple with restrained burnt-orange and rusty red foliage, an irregular spreading crown, splayed roots and charcoal brown naturally crooked branches, suitable for a humid mountain temple trail. |
| 矿洞轨道 `mine-dead-birch-v1.webp` | A weathered gray-white dead birch trunk with split top, several slender leafless side branches and exposed curving root fingers, suitable for lying against the walls of a disused underground mine. No leaves. |
| 矿洞轨道 `mine-old-root-v1.webp` | A low battered pine stump with thick bark and broken asymmetrical branches, tangled dark weathered roots with hints of moss at the base. Suitable as a root cluster protruding from an old quarry wall or mine entrance. No broad canopy. |

## 道具

两张图标放在 `public/assets/runner/`。共同提示词要求独立透明底、四分之三视角、完整居中、真实材质、在 24 像素下仍可识别，无文字、底座和投影。

| 文件 | 主体提示词 |
| --- | --- |
| `pickup-hourglass-v1.webp` | A little antique brass hourglass with amethyst-purple glass and violet sand, crisp slender bronze ribs, visibly recognizable hourglass shape. |
| `pickup-double-score-v1.webp` | Two overlapping old golden coins with a small bright amber jewel between them, embossed simple rim and raised blank centers, warm brass highlights. |
