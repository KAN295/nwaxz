# 奶狗与跑酷道具

2026-11-13，使用内置 `image_gen.imagegen`。玩家改为用户提供的奶狗；最后一次体型调整为躯干稍长、腰腹稍圆。恐怖奶蛙仅为追赶者。生成的玩家动作均为四足犬类动作，不以缩放或上下移动站姿充当奔跑。

## 交付资产

- `public/assets/runner/milk-dog-run-v2.png`：4×2 八帧连续犬类奔跑周期，含蹬地、伸展腾空、前足落地、收拢腾空、后足承重。
- `public/assets/runner/milk-dog-actions-v2.png`：4×2，待机、跳跃、落地、低身钻过、正面笑脸、失误、左转、右转。
- `public/assets/runner/powerups-v1.png`：2×2，磁铁、护盾、冲刺鞋、保护泡泡。
- 追赶者复用 `public/assets/character/haunted-frog-directions-walk-v1.webp`；千米结算保留原普通奶蛙图集的捧腹大笑，与奶狗同屏庆祝。

三张新增PNG保留生成原尺寸与原始字节，未裁切、拉伸重画或重编码；最终资源SHA、尺寸见 `public/assets/runner/manifest.json`。跑步通过八帧循环显示，按速度调整周期；跳跃、落地与低身动作使用独立图，暂停不推进步态。无窗口浏览器检查不等于真实动物运动捕捉或真机验收。

## 跑步首稿提示词

三张用户参考图仅作为角色身份参考，非动作模板。

```text
Use case: identity-preserve.
Asset type: production transparent eight-frame QUADRUPED GALLOP cycle sprite atlas for an endless runner game.
Input images 1, 2 and 3 are identity references of the same original character named Milk Dog. Preserve its recognizable golden-yellow smooth body, cream chest/belly, floppy dark brown ears, dark brown rounded paws, short curved upright tail, broad joyful rounded head, cute soft toy-like 3D materials and proportions. It is a DOG with FOUR legs and a horizontal canine spine, NEVER a bipedal frog or person.
Create EXACTLY FOUR columns and TWO rows of equal SQUARE cells, wide 2:1 sheet; eight sequential frames of ONE natural dog running gallop. True transparent alpha outside figures. No floor, no shadows, no lettering, no grid, no background, no border.
Camera: consistent rear three-quarter view from a slightly elevated chase camera, dog moving straight AWAY into the screen with its head oriented away, slight left-side visibility to make ALL FOUR legs readable. No turning to look at camera. Same camera angle and scale in all eight frames. Fixed root position in every cell, feet ground baseline at 88%, silhouette contained within 12%-88% horizontal and 12%-90% vertical margins.
CRITICAL motion: anatomically credible canine double-suspension gallop, eight DISTINCT sequential phases:
0 rear paws gather under hips preparing push, forepaws reaching forward;
1 hind-leg push-off, forelegs extended;
2 stretched airborne phase with forelegs forward and hindlegs trailing backward;
3 leading forepaw contact, other forepaw starting to plant, hindlegs folding;
4 front legs support and bend, hips swing forward;
5 gathered airborne phase with all four paws tucked under torso;
6 first hind paw lands beneath body, forelegs folding back;
7 both hind paws load for the next push, approaching frame0 continuously.
Real dog weight transfer and shoulder/hip flexion, horizontal back flexes subtly; two front and two hind legs remain distinct; ears lag behind body acceleration and tail moves gently. Do not simply translate or squash a single standing dog; DO NOT repeat poses. Do not make human walking, skating, standing upright, or hopping with all four legs rigid. Keep the dog identity consistent and paws at coherent ground contact height. Entire animal including floppy ears and tail visible in every frame. Warm soft natural lighting identical in all cells.
```

## 体型调整提示词

编辑对象为上一张八帧跑步图集。

```text
Use case: identity-preserve.
Image 1 is the EDIT TARGET, an eight-frame 4x2 transparent galloping Milk Dog sprite atlas.
Modify only the dog's body proportions consistently in ALL EIGHT frames: make the torso approximately 15% LONGER from shoulders to rump along the horizontal canine spine, and approximately 15% CHUBBIER through the ribcage, waist and lower belly. A gently sagging round cream underside and plump barrel body, still a cute healthy chunky short-legged dog, not exaggerated or inflated.
Keep the exact golden-yellow Milk Dog identity, dark brown floppy ears, dark brown short paws, curled tail, smooth soft 3D material, lighting and palette unchanged. Keep the same eight distinct natural quadruped gallop phases in the same reading order, same rear three-quarter camera, same cell grid, same fixed root anchor and ground baseline. Adapt limb placement anatomically to support the slightly longer/heavier body while preserving foreleg/hindleg differentiation, push-off, suspension, landing and gathering. Do not merely stretch the whole image: head and paws must retain their sizes, legs stay short, torso changes in three dimensions.
Preserve real transparent alpha, exact 4 columns x 2 rows equal square-cell layout, generous transparent margins; all ears, paws and tails fully inside cells, no cropping. No new elements, no text, no floor, no grid lines, no opaque background.
```

## 动作提示词

参考为调整后的跑步图集和用户奶狗正面图。

```text
Use case: identity-preserve.
Asset type: transparent production action sprite atlas for Milk Dog, FOUR columns x TWO rows, eight equal square cells.
Image 1: canonical UPDATED Milk Dog body proportions and material, source for identity. Images 2 and 3: source face/character references. Preserve the slightly LONG AND CHUBBY golden-yellow dog torso, horizontal canine spine, short four legs with dark brown paws, floppy brown ears, cream chest/belly, curled tail, joyful rounded face. Real dog anatomy, never upright humanoid or frog.
Same soft 3D materials and lighting as image1, generous transparent margins around each whole body, no floor, no drop shadow, no text, no grid, no opaque background. Stable size/anchor/ground baseline at88% for standing poses; suspended actions retain same root.
Reading-order cells:
0 rear three-quarter chase camera: standing on ALL FOUR PAWS, facing away from camera, relaxed tail.
1 same rear chase view: long jumping pose, forepaws stretched forward, hindlegs trailing, belly above obstacle.
2 same rear chase view: landing pose, forelegs bend to absorb landing while hindfeet are about to come down, short legs anatomically connected.
3 same rear chase view: crawling low under a beam, four knees flexed, belly near ground and head forward, a dog crouching rather than sliding on its back.
4 FRONT THREE-QUARTER full-body portrait standing on all four paws, friendly happy open laughing mouth and closed crescent eyes exactly like the original user reference.
5 FRONT THREE-QUARTER full-body startled stumble, front paws spread, still four-legged, no scary teeth.
6 rear three-quarter chase view: leaning naturally to LEFT while cornering on four paws, torso bends subtly and tail counterbalances.
7 rear three-quarter chase view: leaning naturally to RIGHT while cornering on four paws.
Do not turn the dog into a different breed or thin athletic dog. Keep the long plump torso and recognizably cheerful Milk Dog identity consistent in all frames.
```

## 道具提示词

```text
Use case: product-mockup.
Asset type: transparent game collectible sprite atlas, square image, TWO columns and TWO rows of equal square cells. Four complete isolated objects, generous transparent margins, photorealistic materials with a slightly polished adventure-game finish, natural soft warm light, front-three-quarter camera, no text, no labels, no background, no grid, no opaque panels. Objects will float above an ancient wet stone aqueduct.
Top left: classic red horseshoe magnet with polished steel ends, recognizable U shape, chunky compact silhouette.
Top right: a beautiful small round antique bronze shield with blue-green glass center, worn metal rim, no writing or heraldry.
Bottom left: a golden winged running shoe talisman, small bronze ankle wings, clearly a shoe pointing sideways, warm amber crystal accent, suggesting a speed boost.
Bottom right: a single large clear iridescent soap bubble, fine rainbow edge and natural soft reflected highlights, transparent center. Usable as an in-game protective bubble.
Keep all four objects fully inside their own cells, centered, no protrusion across cell boundaries. Genuine transparent alpha around each object. High clarity silhouettes at small sizes.
```
