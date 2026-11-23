# 联机逃生者美术

## 雨衣青年 v2

当前只开放雨衣青年。房间使用正面待机循环，头像从同一张正面图裁切。对局中的五套无损透明 WebP 位于 `public/assets/character/raincoat-v2/`。每套按四个动作阶段索引，每个阶段包含八个方向；裁切矩形与各角度站高记录在 `src/escape/raincoat-frames.json`。走、跑和蹲走按队友的本地插值位移推进，静止时按时间呼吸。

使用内置 ImageGen，以旧黄雨衣青年为造型参考，逐个角度生成。提示词要求保持黑发、立领旧黄雨衣、斜挎包、深色长裤和工作靴，哑光、自然人体比例，透明底、全身、不带字或地面投影。每张固定一个视角，四列五行；五行分别为待机呼吸、步行、奔跑、蹲伏呼吸、低姿蹲走。行走画出左右脚的接触和通过姿势。最后依据透明轮廓裁切排版，保留原始像素。

## v1 素材归档

## 角色与资源

所有角色均为成熟成年人，使用旧浴场的脏白、黄绿、褐色和昏暖灯光风格。八向全身图为透明 WebP，尺寸 1536×1024，每张按 4 列×2 行切分为 384×512 的格子。格子按顺时针排列：正面、右前 45°、右侧、右后 45°、背面、左后 45°、左侧、左前 45°。

| avatar | 外观 | 全身八向图 |
| --- | --- | --- |
| 0 | 褪色黄雨衣青年 | `/assets/character/escape-survivors-0.webp` |
| 1 | 旧浴袍幸存者 | `/assets/character/escape-survivors-1.webp` |
| 2 | 蒙脸维修员 | `/assets/character/escape-survivors-2.webp` |
| 3 | 旧制服巡夜人 | `/assets/character/escape-survivors-3.webp` |

联机 roster 使用单独的深色头肩头像图 `/assets/character/escape-survivor-portraits.webp`，同为 2×2 网格，阅读顺序对应 avatar 0 到 3。背景尺寸 200% 200%，头像 0/1/2/3 分别取左上、右上、左下、右下格。`peerAvatarPortraitStyle(avatar)` 提供这些裁切元数据；实际界面通过外置 CSS 的 `data-avatar` 选择器呈现，遵守现有 CSP，不依赖 inline style。

## 渲染约定

- `EscapeRenderer.drawPeers(peers, selfId, dt)` 在 `draw(world)` 前更新队友 billboard；`clearPeers()` 在离开房间时清理，renderer dispose 也会释放其场景节点和贴图。
- 身体从世界空间绘制，保持默认深度测试，墙体可以遮挡身体；仅 slot 编号使用独立发光材质和 ALWAYS 深度函数，因此编号可穿墙提示队友位置。
- 方向依据队友朝向和相机位置选择八向图格子，不固定正脸；角度插值走最短弧线。身体从楼梯高度函数取脚底位置，蹲姿缩短高度，移动时只有轻微平移和上下摆动，没有额外多帧动作。
- 只显示非本地玩家的 connected/reconnecting 状态；重连时降低不透明度。 caught、eliminated、escaped 或 roster 中消失时会清理实体。世界坐标 billboard 自然离屏，不把队友投射到屏幕边缘。
- slot 1/2/3 的头顶数字颜色分别为淡蓝、淡绿、淡金。编号不改变 roster slot 对应关系。

## 素材生成记录

使用 Codex 内置 image_gen 生成并检查，随后只做 alpha 保留的 PNG→WebP 编码。全身图提示词分别要求同一个成年角色的 4×2 八方向透明游戏 sprite atlas，正面到侧后方向顺时针排列；角色依次为旧黄雨衣青年、旧浴袍幸存者、蒙脸维修员、旧制服巡夜人。头像提示词以这四张 atlas 为参考，生成与角色外观对应的 2×2 深色头肩头像图。没有用脚本绘制或改造角色主体。

这是联机角色素材与渲染约定，不代表联机功能或任何生产发布状态已经验证。
