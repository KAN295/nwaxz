# 奶蛙爱洗澡（nwaxz）

面向手机浏览器的 H5 游戏。浴场模式包含泡泡浴场12关、午夜浴场6关，以及万圣浴场和地狱浴场各3关限时引水；逃生模式为第一人称下水道逃生。奶娃峡谷提供3v3客户端、原创四术与本机阵容预演；战斗尚未开放。

## 当前功能

0.32.0 候选：新增“奶蛙逃亡”三轨跑酷，奶狗四足奔跑，恐怖奶蛙从身后追赶；默认可直接进入无限模式，另有千米挑战；新增遗迹/矿洞场景、必须跳跃或下滑的全路障碍、大箭头转弯及更近的镜头。新增磁铁、护盾、冲刺和连续收币加分，保留写实生图场景、触控、暂停及独立本机纪录；千米结算保留原奶蛙捧腹大笑。[玩法与验证](docs/RUNNER_GAME.md) · [奶狗动作与提示词](docs/art/runner-milk-dog-v2.md)。尚未发布。 最新候选保留真实3D道路、障碍、天气和转弯，奶狗/奶蛙及抓捕恢复原2D形象；加入二段跳、致命障碍、抓捕与死亡提示、手机倾斜控制、雨雪天气和千米后交替的路灯夜景。真机传感器与帧率尚未验证。

0.31.1 候选：逃生入口改用大厅同背景的全屏等待页，移除浴场固定容器及大厅初始化空卡片；大厅不加载3D引擎模块，真正开局再导入，减少入口卡顿。慢载可返回，迟到任务不会覆盖首页或重复创建大厅。发布见[Issue93](https://github.com/lingyunmo/nwaxz/issues/93)。

0.31.0 候选：首页只准备约324KB启动资源，浴场按关卡加载，逃生3D在开局时准备，取消106MiB全量资源阻塞。已使用资源校验缓存，设置可主动下载完整离线包；原始PNG分段传输且不改清晰度。未下载过的模式断网时需要联网准备。[启动与离线说明](docs/FAST_STARTUP.md) · [Issue91](https://github.com/lingyunmo/nwaxz/issues/91)。

0.30.0 候选：浴场新增万圣/地狱两座独立浴场，各3关，带倒计时、临界心跳和完整超时抓捕。暂停/后台停表，失败保留成绩，成功仍显示原画经典捧腹大笑；五张绘制PNG保留原尺寸原字节。原浴场、逃生、峡谷与本地记录保留。[玩法与时限](docs/SEASONAL_BATHS.md) · [原画与提示词](docs/art/seasonal-baths-v1.md) · [Issue87](https://github.com/lingyunmo/nwaxz/issues/87)。

0.29.0 候选：奶娃峡谷独立客户端含大厅、四只奶娃图鉴与技能页、双队三席选角/换位/锁定、本机昵称和编队保存、四术关系与三只中立奶娃图鉴。8张新原画保留原尺寸PNG与原字节，提供离线体验。仅界面预演，无匹配或3v3战斗，不改变现有浴场/逃生游戏。[世界与规则](docs/VERSUS_DESIGN.md) · [技术选型](docs/VERSUS_TECH.md) · [素材与全部提示词](docs/art/versus-roster-v1.md) · [Issue83](https://github.com/lingyunmo/nwaxz/issues/83)。

0.28.0 候选：首页按实际视口自动铺满，浴场／逃生／对抗三个入口；浴场入口沿用普通封面，进入后再选泡泡或午夜浴场。界面统一改用“逃生模式”，成绩、续关与声音设置保留。对抗模式有独立绘制预告封面，仅标“3v3 · MOBA／筹备中”，不能开始或匹配。首页不强制浏览器全屏。[文案约定](docs/UI_COPY.md) · [预告素材与提示词](docs/art/versus-cover-v1.md)。

0.27.0 候选：恐怖奶蛙新增40个八向动作姿态，施法/干扰狂笑、听声调查、慢速潜行追捕与近身扑抓接入实际状态，经典大笑保留。五张PNG保留生成原尺寸和原始字节。[素材与提示词](docs/art/haunted-frog-performances-v3.md)。按用户要求本批不完整运行游戏，验证范围见[验证记录](docs/VERIFICATION.md)。

0.26.0 候选：单人游戏、设置、存档、操作说明、重开确认和房间关闭页面统一使用角色大厅的外观与导航；从等待房间进入设置后可返回同一房间。只调整局外窗口，局内玩法不变。局域网联机按用户要求暂停，不包含在本次发布中。[发布状态](https://github.com/lingyunmo/nwaxz/issues/76)。

0.25.0 已发布：接入用户1–9号原始PNG地图材质，保留1254×1254和原始字节；移除材质512与画布1100/1600限制，按实际设备像素绘制，门柜/管道/设备同步换材质。原图加入离线缓存。[素材与SHA](docs/art/escape-original-materials-v1.md) · [精确发布证据](https://github.com/lingyunmo/nwaxz/pull/75#issuecomment-6423403706)。

0.24.0 候选：极限恐怖改为角色主菜单、服务器列表和三人全身队伍；最多8房、实际延迟、公开/密码房、游客UID与服务器好友/邀请。HUD精简、探索区汉字、衣柜安全、跨层显形与CG切页恢复一并修正。资料/好友使用 nwaxz 独立卷，游戏存档仍只在本地。发布状态见 [Issue72](https://github.com/lingyunmo/nwaxz/issues/72)，候选验收见[验证记录](docs/VERIFICATION.md)。

0.23.1 候选：联机改用同源 WSS，客户端逐帧预测移动与碰撞，服务器校验共享判定。修复水晶／柜子缺少目标 ID、出柜位置回滚及操作拒绝误报重连；队友透明原画在暗处可读，八方向按实际相对位置，发光编号正向显示。[实现](docs/COOP_GAME.md) · [实玩修正与发布](https://github.com/lingyunmo/nwaxz/issues/71)。

0.23.0 候选：极限恐怖新增单人／多人入口、最多三人的私有房间、四款绘制头像、八方向队友及透墙编号，头像卡显示生命和实际延迟。两人各两条命，三人各一条；任务和水晶共享，淘汰后旁观。联机使用现有 Node 服务权威判定，不提供匹配或多人存档。[房间规则与预算](docs/COOP_GAME.md) · [验收](docs/VERIFICATION.md) · [实际发布状态](https://github.com/lingyunmo/nwaxz/issues/67)。

0.21.1：地下泵房和污水闸的指示灯、手轮与实际任务状态同步；地面恢复供电不会提前点亮地下控制箱。存档代际保持不变。[发布状态](https://github.com/lingyunmo/nwaxz/issues/62)。

0.21.0：负一楼禁区通过16级楼梯连接地面，增加秘密档案、泵房和污水闸任务。场景更暗，手电承担主要照明；奶蛙会感测位置、瞬移，并污染暴露仪表。扫描与冷却只用短警报和进度条，机制线索放在纸条里。脚步听距和声源调查增强，M独立查看两层地图，Esc仅显示功能菜单。整个游戏采用当前存档代际，不匹配的旧记录自动重置，旧备份拒绝导入。[玩法与实现](docs/BASEMENT_GAME.md) · [验收](docs/VERIFICATION.md) · [发布状态](https://github.com/lingyunmo/nwaxz/issues/62)。

0.20.0：恐怖奶蛙新增八方向站立与交替行走原画，侧面和背面随真实朝向显示；冻结后绕行也能看清背影。转头边界防抖，动作过渡保持实体遮挡，正面站立和经典捧腹大笑沿用原素材。追击时视觉也遵守前方视野，声音、光源和追捕记忆继续生效。[美术与提示词](docs/art/escape-directions-v1.md) · [验证](docs/VERIFICATION.md) · [发布状态](https://github.com/lingyunmo/nwaxz/issues/60)。

0.19.0：极限恐怖由声音、灯光和视觉非线性叠加总暴露值，基础0分；45起警觉、感知变为1.5倍，100追击。HUD默认精简，Tab或“详情”展开三路分数、贡献和实际感知状态；水晶、条和数字放大。短按Shift/C切换奔跑/蹲行，离柜和重生站立。[规则](docs/PERCEPTION.md) · [验证](docs/VERIFICATION.md) · [发布状态](https://github.com/lingyunmo/nwaxz/issues/58)。

0.18.0：极限恐怖改为动态游走，行走疲劳过高会喘息引来调查，持续照中奶蛙会累计手电警觉；新增有限的冻结晶与显形晶，各持续10秒。旧逃生存档可继续使用这些机制，原任务进度保留。Luna实现主体、主代理审查验收，实际发布状态见 [Issue #56](https://github.com/lingyunmo/nwaxz/issues/56)。

0.17.0：极限恐怖新增旧更衣室、锅炉房、手轮与三阀泄压谜题；踩响长廊碎玻璃会引来奶蛙，可绕开或蹲行通过。新增内容用于新游戏，旧逃生存档继续原路线。由 Luna 实现、主代理审查和验收，实际发布证据见 [Issue #54](https://github.com/lingyunmo/nwaxz/issues/54)。

0.16.3：电脑点击一次游戏画面后即可移动鼠标转头，无需按住；Esc 暂停并释放鼠标。捕获不可用时，画面内移动鼠标仍可转头；手机滑动和键盘观察保留。操作见[逃生玩法](docs/ESCAPE_GAME.md)，验证与实际发布状态见 [Issue #52](https://github.com/lingyunmo/nwaxz/issues/52)。

0.16.2：极限恐怖每次新游戏从“开场1”和“开场2”中等概率随机播放一段，继续存档不重播；两段均加入启动预加载和离线缓存。素材见[过场视频](docs/ART_CINEMATICS.md)，发布状态见 [Issue50](https://github.com/lingyunmo/nwaxz/issues/50)。

0.16.1：修复手电光斑停在初始位置的问题，移动与上下左右转头时照明随视角更新。小地图和暂停地图显示当前位置；进入房间或长廊时居中显示约1.6秒地名，暂停时保留剩余时间。发布与验证见 [Issue48](https://github.com/lingyunmo/nwaxz/issues/48) 和[验证记录](docs/VERIFICATION.md)。

0.16.0：启动页显示“正在准备浴室”、实际下载百分比与 MB，提前保存全部视频、音乐、地图、模型和游戏代码（196项，约23.66 MiB），再次打开复用缓存。三维浴场在启动时预热，进入及退出后重进复用同一场景；资源超时或失败时提供重试，也可明确选择先进入游戏。四段过场、经典捧腹大笑和 v1 存档保持兼容。`pnpm check`（103项业务测试、1项PWA检查）及启动、首页、逃生、CG、更新浏览器验收通过。实现与发布状态见[开发状态](docs/DEVELOPMENT_STATE.md#0160-资源预缓存与启动预热候选)、[验证记录](docs/VERIFICATION.md)和[Issue46](https://github.com/lingyunmo/nwaxz/issues/46)。

0.15.0：极限恐怖新游戏播放用户提供的开场影片；每次被抓随机播放三段影片之一，结束或跳过后接原画大笑与结算。视频可暂停、静音、跳过，支持按需离线缓存。更新入口改用不受静态JS长期缓存影响的 `/game-worker`，联网/回前台主动检查，在安全菜单应用、游玩时延后。素材来源见[过场视频](docs/ART_CINEMATICS.md)，本批发布状态见[Issue44](https://github.com/lingyunmo/nwaxz/issues/44)。

0.14.0 界面更新：三个同等大小的绘制封面入口，各模式独立续玩；首页不再显示普通模式的全局续关和泡泡币。设置、结算与逃生菜单精简文案，操作和存档工具按需展开。实现与验收见[文案约定](docs/UI_COPY.md)、[验证记录](docs/VERIFICATION.md)；本批线上发布结果见 [Issue #42](https://github.com/lingyunmo/nwaxz/issues/42)。

0.13.0 已发布并公网核对，合并 SHA `df9c58df2eee20c1eaf92dcee260825bed4fdf9b`；[发布证据](https://github.com/lingyunmo/nwaxz/pull/40#issuecomment-6350384629)包含三个成功 CI 作业与15项线上资源逐字节核对。

- 0.11.0 已发布并公网核对；[精确发布证据](https://github.com/lingyunmo/nwaxz/pull/34#issuecomment-6343588123)，历史验证见 [发布验证记录](docs/VERIFICATION.md)。
- 0.12.0 已发布：逃生篇升级为 Babylon.js 9.32 真3D，支持上下看、柜内真实几何和 idle/walk/run/laugh 四段骨骼动画；[发布证据及精确 main SHA `f6f4dee296eb280aa387dbfc440b33024b2287a0`](https://github.com/lingyunmo/nwaxz/pull/38#issuecomment-6349588315)。
- 0.13.0 已发布并公网核对：角色改用极限恐怖原画二维直立图集，仅绕 Y 轴朝向玩家并受墙体遮挡；保留原图集站立和捧腹大笑，新加 4×2 八动作图集及约 120 ms 动作混合。HUD 收起常驻任务/教程，使用图标物品栏、紧凑状态、附近交互和探索小地图。无窗口 Chromium 桌面/手机视口、触控、暂停冻结、衣柜进出、大笑、下一夜、导入导出、离线冷重载均通过，脚本错误为0；本地更新后原画大笑显示正常，IndexedDB 进度字节未变。详见[候选验收记录](docs/VERIFICATION.md#0130-原画动作与探索-hud合并前候选验收2026-10-23)。真实手机帧率和扬声器听感尚未验收。
- 极限恐怖“下水道逃生”包含七个区域、钥匙与电源目标链、巡逻/听声/追逐 AI、柜内藏身、三次机会、体力与手电、石子诱敌、纸条和逃生纪录。使用独立本地会话及备份，不覆盖原洗澡存档。[完整玩法](docs/ESCAPE_GAME.md)、[绘制素材与提示](docs/ART_ESCAPE.md)、[恐怖配乐](docs/AUDIO_ESCAPE.md)。
- 逃生家具模型 `public/assets/models/escape-props-v1.glb` 仍供场景使用；`public/assets/models/extreme-milk-frog-v1.glb` 保留为源资产，0.13.0 运行时与预缓存不再使用角色 GLB。可复现建模脚本为 `ops/build_escape_props.py` 和 `ops/build_escape_character.py`。浏览器候选验收脚本为 `ops/escape-browser.mjs`，使用独立 Playwright 安装或 `PLAYWRIGHT_MODULE`，可选配置 `CHROMIUM_PATH`；脚本始终以 headless 软件渲染和独立 profile 运行。
- 基础清水源包含 208 滴的粒子水流求解器，采用固定 120 Hz 步进和空间分桶；挖掘网格单元为 CELL8，石块不可挖。
- 第二章加入可交互风扇和限量喷水阀：打开风扇可改变局部水流，阀门按固定流速消耗有限水量。
- 清污分流：污水池生成 64 滴紫色污水；水滴接触会传播污染，污水不能收集泡泡币或计入清水进度。污水流入浴缸会失败并可重试，失败局不保存成绩。
- 水草阻挡清水、吸收最多 12 滴污水后枯萎；先开污水阀（12 滴、spread 0），再开清水阀（208 滴），可用屏幕按钮或 `B`/`V`。海绵容量 160 滴，点击或按 `E` 将库存放入队列，以每秒 80 滴向下挤出并保留水的种类；释放后 1 秒内不会被原海绵立即吸回。水量守恒统计包含植物吸收、海绵库存和待释放队列。
- 第四章“暖暖水工坊”组合阀门与风扇、双海绵接力；工坊场景根据关卡配置用于背景、土层贴图和侧边衬景。
- 每关接到 100 滴水即可获胜，可额外收集 3 枚泡泡币。
- 成绩包含分数和用时；计时从首次有效挖土或操作机关开始，暂停及后台不计时。最高分与最快用时独立合并；旧版 v1 存档可继续读取，旧纪录不会补造分数。
- 浏览器 IndexedDB 本地存档，支持导入/导出；通过 BroadcastChannel 合并存档。
- 设置包含音乐、音效、震动、简化动作和画质选项。0.8.3 已将背景音乐替换为原创 FL Studio 配乐《奶蛙泡泡日》，约 42 秒循环；同源录音加入离线缓存，普通音效由 Web Audio 合成，恐怖模式使用独立原创氛围音与合成怪笑录音。音乐默认关闭，可在设置中试听；配乐记录见 [AUDIO.md](docs/AUDIO.md)。
- PWA 静态资源缓存和提示式更新；构建会检查必需离线资源，离线能力以实际浏览器测试为准。
- 透明角色图集 `public/assets/character/milk-frog-atlas.webp`，包含 idle、breath、blink、look、tap、laugh、celebrate 动作。
- 12 种角色姿态（原有 8 种及新增 4 种），姿态间平滑混合并连续呼吸摆动。

0.11.0 已发布第二章“地下回声”和独立逃生篇；恐怖洗澡模式共六关，按章解锁并保留旧纪录。既有恐怖美术见 [ART_HORROR.md](docs/ART_HORROR.md)。0.12.0 发布证据和精确 SHA 见[记录](https://github.com/lingyunmo/nwaxz/pull/38#issuecomment-6349588315)。0.13.0 [已发布并核对](https://github.com/lingyunmo/nwaxz/pull/40#issuecomment-6350384629)；真机帧率与扬声器听感仍未验收，详见[验证记录](docs/VERIFICATION.md#0130-原画动作与探索-hud合并前候选验收2026-10-23)。0.9.1 的 iPhone 声音兼容代码保留。云端同步尚未实现。

线上游戏：[立即游玩](https://nwaxz.bzlom.cn)。版本与 QA 状态见 [DEVELOPMENT_STATE.md](docs/DEVELOPMENT_STATE.md)，玩法说明见 [GAME_DESIGN.md](docs/GAME_DESIGN.md)，已核对的发布证据见 [验证记录](docs/VERIFICATION.md)。绘制资源见 [ART_V2.md](docs/ART_V2.md)、[ART_PROPS.md](docs/ART_PROPS.md)、[ART_WORKSHOP.md](docs/ART_WORKSHOP.md) 和 [ART_BATHROOM.md](docs/ART_BATHROOM.md)。

## 技术栈

前端使用 TypeScript、Vite；洗澡模式使用 Canvas 2D，已发布的逃生篇使用 Babylon.js 9.32 和 WebGL，0.13.0 沿用该 3D 场景并以原画二维角色图集呈现奶蛙。服务端使用 Node.js 24 和 Express 5；包管理器为 pnpm 11.1.3。

## 本地开发

需要 Node.js `>=24.15.0 <25` 和 pnpm 11.1.3。

```sh
pnpm install
pnpm dev
```

开发服务器默认监听 `127.0.0.1:5173`。需要 API 时另开终端运行 `pnpm dev:server`（默认 `127.0.0.1:3000`）；Vite 将 `/api` 代理到本地服务端。

```sh
pnpm test       # Node 原生测试
pnpm build      # TypeScript 检查、Vite 构建及离线清单回归检查
pnpm check      # test + build
pnpm start      # 启动服务端
pnpm smoke      # HTTP 冒烟检查
```

原生测试覆盖关卡路线与全金币、质量守恒、长帧处理、石块不可变和存档收敛。运行 `pnpm check` 可在本地复现测试及构建检查；最近一次发布的具体结果见[验证记录](docs/VERIFICATION.md)。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [开发状态与后续计划](docs/DEVELOPMENT_STATE.md)
- [游戏设计](docs/GAME_DESIGN.md)
- [部署说明](docs/DEPLOYMENT.md)
- [贡献指南](CONTRIBUTING.md)
- [安全问题报告](SECURITY.md)

源码仓库：[lingyunmo/nwaxz](https://github.com/lingyunmo/nwaxz)（公开）。

0.5.0 发布前浏览器验收：两道新关卡均全币通关，手机触摸与键盘操作、暂停画面冻结、离线冷重载和 24/24 本地存档保留通过。线上发布证据见 [验证记录](docs/VERIFICATION.md)。
