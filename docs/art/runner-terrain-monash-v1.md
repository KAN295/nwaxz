# 奶狗快跑地形素材和莫纳什皮肤

素材通过 Codex 内置 ImageGen 生成。入库前压缩为 WebP，倒木树皮的纹理方向对齐树干轴向。莫纳什图集沿用现有 1024×512 格式，并清理透明区域的低透明度噪点。

## 倒木树皮

`public/assets/runner/obstacle-cedar-bark-v1.webp`

> Use case photorealistic-natural. A square seamless game PBR diffuse material tile showing the side of a fallen weathered cedar log in a rainy stone aqueduct. Deep irregular longitudinal bark fissures, splintered dark brown fiber, patches with bark peeled off to show raw honey-gray wood, subtle damp sheen baked out, weathered warm-brown palette. The linear wood grain runs from left edge to right edge across the full tile. Extreme close-up flat orthographic macro photograph, neutral even diffuse diffuse lighting, rich natural microdetail, realistic field texture readable at medium distance. Repeatable left/right and top/bottom. Fill every pixel with wood, no silhouette, blank margins, trunk object, text, horizon, or dramatic shadows.

## 倒木端面

`public/assets/runner/obstacle-cedar-ring-v1.webp`

> Use case photorealistic-natural. A square orthographic game texture photo looking straight at the weathered fractured cut end of a fallen cedar log, with warm gray tan annual growth rings, damp torn splinters and radial cracks from an eccentric center. Single tightly framed timber cross section with the rings continuing to every edge, fill all pixels, organic imperfections, diffuse neutral lighting, realistic macro detail. No white border, no text, no colored background, no strong shadows.

## 障碍岩石

`public/assets/runner/obstacle-fractured-rock-v1.webp`

> Use case photorealistic-natural. Generate a square seamless diffuse game texture for natural angular boulders lying in an old rain-wet canyon and underground. Orthographic close-up material sample covering the full image of one continuous gray olive slate and weathered basalt surface, fractured striations with fine winding mineral veins, tiny pits and subtle mossy patches. Include believable charcoal through gray olive variation and fine chipped details readable in a 3D runner game, neutral diffuse light, minimal baked shadows. Fill to all edges and make it tile. No cobblestone tiles, borders, other objects, text or horizon.

## 矿洞矿物

`public/assets/runner/mine-amethyst-v1.webp`

> Use case photorealistic-natural. An isolated single detailed amethyst geode cluster for a realistic dark mine in a 3D running game, to stand upright along the walls. Irregular compact dark-gray raw basalt bed with several recognizable tall pointed purple amethyst prisms in front and smaller quartz prisms around their bases, natural crystal growth, translucent mineral tips, subtle violet and lilac facet reflections, a few pale orange calcite chips, physically grounded geology. Full single object, crystal tips upward, straight-on slight three-quarter game prop view, its base touching the bottom of the cluster. Strong clean silhouette, fill 88% of a square image with some clear padding. True transparent alpha background, no ground plane, no cast shadow, no background at all, no words or luminous aura.

## 莫纳什夜跑奶狗

`public/assets/runner/qs2027/skins/qs031.webp`

> Use case stylized-concept. Premium original 2D game sprite-texture atlas, an exclusive Monash University Night Circuit skin for the specific fictional 奶狗 mascot in reference image one. Use the first reference for the recognizable buttery-gold round chubby long torso, cream chest, short broad paws, rounded taupe drop ears, upturned tail, no projecting muzzle, closed crescent eyes and toothy laughing face. Use the second reference only for the black/white heraldic shield on the back. Freely redesign the equipment into a genuinely cool high-end night-runner outfit: fitted sculptural satin graphite-black segmented back armor with a strong asymmetric silhouette, tasteful narrow electric-cobalt blue illuminated edges, dark ultramarine fabric panels, a pale shield inset flush on the shoulder blades, subtle blue accents under one ear and a short reinforced front chest strap. One coherent futuristic sportswear design, no silly cape, no full helmet or face cover, no real dog breed anatomy. Keep the charming original sunny mascot visible with cool blue rim light that feels naturally integrated into the texture. One perfectly regular wide 2:1 atlas, exactly 4 equal columns by 2 equal rows, one separate full-body pose per cell. All four poses in row 1 are sequential gallop phases rendered in the SAME rear three-quarter view with head toward upper left and tail toward screen right (reach, contact, gather, push); row 2 is front three-quarter idle with iconic grin, rear jump stretched, rear second jump paws tucked, rear low slide. Maintain the exact same vest shapes and shield placement from pose to pose. Leave at least 9% transparent margins around the full dog in every cell, common ground baseline, consistent fifth-cell portrait proportions, centered full body, no clipping, zero contact shadows outside character, true transparent alpha, no captions, no grid, no extra props. Polished 3D-looking shading baked into a flat 2D illustration, strong readable colors even at small size.

## 莫纳什 TRX 局部修改

`public/assets/runner/qs2027/skins/qs031.webp`

> Use case precise-object-edit and text placement. EDIT the supplied 1774 by 887 exact 4×2 sprite atlas; keep all eight character poses, camera directions, body shapes, grin, dark graphite and electric-blue armor with Monash heraldic shield, outlines, scale and placement pixel-close to the supplied atlas. Make only three small local additions on the puppy's head: one crisp solid matte WHITE capital letter T on the outward face of its left brown floppy ear, one crisp solid matte WHITE capital R centered on the visible golden BACK of the head between and just below the two ear roots, and one crisp solid matte WHITE capital X on the outward face of its right brown floppy ear. Rear-view cells read T R X from screen left to screen right. In front-facing cells keep R hidden because it is painted on the occiput, and the small white letters on the anatomically correct ears remain as visible, X on screen left and T on screen right. Use simple clean white sans-serif stencil markings with exactly one glyph per location, conform slightly to the curves, leave the black-white Monash shield unchanged, keep all other body surfaces unchanged. No new text anywhere else, no new logos, no other effects. Preserve the exact 4 columns and 2 rows, the same gutters and silhouette. The outside of the character should be actual transparent alpha without gray fill or ground shadow. Preserve the current character appearance and lighting in every frame; do not redesign the puppy.
