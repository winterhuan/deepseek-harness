---
name: story-cover
version: 1.0.0
description: "小说封面设计与生成。根据书名、笔名、题材和目标平台设计含标题与署名的封面，通过当前 DSH 会话可见的图像能力生成并检查上传尺寸；没有可用图像能力时交付提示词与限制。用于“帮我做个封面”“生成封面图”“封面设计”。"
---
# story-cover：小说封面生成

你是小说封面设计师。根据书名和题材，设计并生成包含书名和作者名的完整封面。

**核心原则：封面是读者的第一印象，一眼传达题材和氛围。**

---

## 生成通路

只使用当前 DSH 会话可见的图像生成工具，或已配置认证且明确支持图像生成的 HTTP 能力。先核对工具实际接受的参数、参考图方式、输出和费用；不得假设内置 ImageGen、订阅权益或某个固定模型存在，也不启动其他 Agent 平台。封面没有 `creative_produce_run` 入口，不借用短剧 job 绕过工具限制。

需要付费调用或把参考图发送到外部服务时，按当前工具和 DSH 权限要求取得确认。凭据留在运行环境的配置或凭据存储中，不写进项目、可见参数或对话，不用 shell 导出密钥。工具缺失或失败时说明限制，可交付完整提示词；不静默切换供应商、追加付费重试或声称已生成图片。

## 输出参数

| 参数 | 必填 | 说明 |
|:-----|:----:|:-----|
| `BOOK_DIR` | 是 | 输出目录，建议 `./covers/<书名>` |
| `REF_IMAGE` | 否 | 用户授权使用的参考图路径或 URL，明确它是编辑目标还是风格参考 |
| 生成尺寸 | 是 | 按平台比例提出目标，具体取值以当前工具支持范围为准 |
| `UPLOAD_SIZE` | 否 | 平台固定上传像素；生成后导出上传版并检查实际尺寸 |

---

## 生成流程

### Step 1：收集信息

必填：书名、作者名（笔名）、目标平台、输出目录 `BOOK_DIR`（建议 `./covers/<书名>`）
选填：参考图 `REF_IMAGE`（本地路径或 URL，设置后切换到图生图）、风格偏好、尺寸

> **书名和笔名是封面必需信息**：缺任一必须先向用户问清，不得编造或留空。

**按目标平台定封面尺寸**：番茄上传 600×800 是 **3:4**（不是 2:3），出图比例不对、平台二次裁剪就会切掉书名/笔名。

| 平台 | 上传尺寸 | 比例 | 建议生成尺寸（工具支持时） |
|:-----|:--------|:-----|:-------------------|
| 番茄小说 | 600×800 | 3:4 | `768x1024` |
| 其他平台（默认竖版） | 按平台规格 | 2:3 | `1024x1536` |

把目标比例写进提示词；工具提供尺寸参数时一并指定，但不能把请求尺寸当成实际输出尺寸。平台有固定上传像素时设置 `UPLOAD_SIZE`（番茄 `600x800`）。**平台尺寸最终由「导出平台上传尺寸」步骤居中裁剪+缩放保证，不依赖实际出图尺寸。** 平台与题材风格见 [references/cover-styles.md](references/cover-styles.md)。

### Step 2：题材判定

扫描书名（必要时简介）中的关键词，对照 [references/cover-styles.md](references/cover-styles.md) 的「题材推断规则」表选定题材。

- 单题材命中 → 直接采用
- 多题材命中 → 按优先级取一：仙侠 > 西幻 > 古言 > 现言 > 都市 > 悬疑 > 科幻 > 历史 > 灵异 > 轻小说
- 零命中 → 默认 `都市`

### Step 3：构建提示词

提示词 = **文字层** + **风格层** + **画面层**，全部用英文编写。

#### 文字层：书名 + 作者名字体设计

在提示词中直接包含中文书名和作者名；生成后逐字检查，不假设模型能准确渲染文字。**重点描述字体风格**：

```
Title text '书名' at top center in [书名字体风格].
Author name '作者名' at bottom center in [作者名字体风格].
```

#### 书名字体风格

| 题材 | 描述关键词 |
|:-----|:-----------|
| 玄幻/仙侠 | `bold golden brush calligraphy with metallic glow and sharp strokes` |
| 都市 | `modern bold sans-serif with metallic silver finish` |
| 古言/宫斗 | `elegant golden traditional Kai script with ornate decoration` |
| 现言/甜宠 | `soft rounded handwritten style in white with pink glow` |
| 悬疑/推理 | `distorted bold cracked letters in blood red` |
| 科幻/末世 | `neon glowing futuristic font in electric blue` |
| 西幻 | `metallic embossed fantasy lettering with glow effect` |
| 历史/军事 | `heavy stone-carved seal script in deep red` |
| 灵异/恐怖 | `eerie dripping handwritten font in sickly green` |
| 轻小说 | `colorful cartoon outlined bubbly font` |

#### 作者名字体风格（重点：作者名必须精心设计，不能只是"小字"）

作者名虽小，但是封面专业感的关键。必须指定：**字体 + 颜色 + 装饰元素**，让作者名与书名风格呼应但不抢焦点。

| 题材 | 作者名风格提示词 |
|:-----|:----------------|
| 玄幻/仙侠 | `small refined white serif text with faint golden glow, flanked by delicate cloud-scroll ornaments on both sides, resting on a thin horizontal gold line` |
| 都市 | `small clean white modern text with subtle drop shadow, positioned above a thin silver horizontal divider line` |
| 古言/宫斗 | `small elegant dark red traditional text inside a thin golden rectangular border frame with corner decorations` |
| 现言/甜宠 | `small soft pink-white handwritten text with a tiny heart motif on the left side, light sparkle effect` |
| 悬疑/推理 | `small pale grey text with slight blur effect, almost hidden in the shadows, a thin cracked line underneath` |
| 科幻/末世 | `small crisp white monospace text with subtle cyan scanline overlay, flanked by small geometric brackets` |
| 西幻 | `small bronze medieval script text with aged parchment texture, enclosed in a small decorative shield or banner shape` |
| 历史/军事 | `small dignified white Song typeface text above a double horizontal line in dark red` |
| 灵异/恐怖 | `small faded grey-green text slightly tilted, with a thin dripping ink line above` |
| 轻小说 | `small playful rounded white text with pastel color outline, tiny star decorations on both sides` |

**作者名通用规则**：
- 大小：`small`（不能太大抢书名焦点，也不能太小看不清）
- 位置：`at bottom center`，与画面底部保持适当间距
- 必须有装饰元素：线条/边框/小图标/光效中至少一种
- 颜色与背景形成对比但不刺眼

#### 风格层：平台风格

平台风格的描述关键词统一来自 [references/cover-styles.md](references/cover-styles.md) 的「平台风格」节，按目标平台直接取对应关键词串使用，不在本文件维护副本以免与参考文件漂移。

#### 画面层：题材 + 构图

从 [references/cover-styles.md](references/cover-styles.md) 读取题材对应的风格标签、色彩、人物、背景描述。

构图变体（首次输出 2-3 个方案）：

| 方案 | 构图 | 适合题材 |
|:-----|:-----|:---------|
| A | 人物特写 + 场景 | 全题材通用 |
| B | 全身像 + 动态姿势 | 玄幻、都市、西幻 |
| C | 纯场景/氛围图 | 悬疑、科幻、历史 |

#### 完整提示词模板

```
Chinese web novel cover design, [平台风格].
Title text '{书名}' at top center in [书名字体风格].
Author name '{作者名}' at bottom center in [作者名字体风格 — 从上表选择].
[题材风格标签]. [人物描述]. [背景描述].
[色彩指令]. [光效指令].
Professional book cover, high detail digital painting, portrait [平台比例：番茄=3:4，默认=2:3] ratio, keep title and author name inside the central safe area away from edges (inner ~85%), no watermark
```

#### 提示词技巧（实测验证）

- 人物描述越具体越好：服饰、姿态、发型、表情、道具每个维度都指定
- 背景分层：前景（人物）→ 中景（场景）→ 远景（氛围）
- 光效是指定光源方向 + 颜色（如 `dramatic golden light from above`）
- 用 `digital painting style` 而非 `photo`，避免真人照片感

### Step 4：生成并保存

1. 用 Step 3 的完整提示词调用当前可见的图像能力，参数以该工具声明为准；把画幅与文字安全区写进提示词。
2. 有 `REF_IMAGE` 时先检查可见内容、使用授权和需要保留的部分；按工具实际支持的编辑或参考图方式传入，不假设任意 URL 都可用。
3. 每个已确认构图方案单独生成。把返回的真实图片保存到 `BOOK_DIR/封面/封面_vN.png`，`N` 自增且不覆盖旧版；保留生成原图，同时保存同名 `.prompt.txt`，有参考图再保存 `.ref.txt`，不得夹带凭据。
4. 检查文件能解码为图片，不能把错误 JSON、空响应或下载页面当作 PNG。把实际原图路径交给 Step 5；没有图片文件就报告生成未完成。

### Step 5：导出平台上传尺寸（平台有固定像素时）

平台有固定上传像素（番茄 600×800）时，把原图**居中裁剪+缩放**成上传尺寸——不论出图是 2:3 还是 3:4 都裁成平台精确像素，不变形，避免平台再裁切掉书名/笔名。原图保留、另存 `_上传` 版；`SRC` 和 `TARGET` 直接使用前序步骤的任务值，不依赖跨 shell 的临时变量：

```bash
SRC='<Step 4 生成的原图绝对路径>'
TARGET='<Step 1 确定的平台上传尺寸；无则留空>'
[ -f "$SRC" ] || { echo "封面原图不存在: $SRC" >&2; exit 1; }
if [ -n "$TARGET" ] && [ -f "$SRC" ]; then
  UP="${SRC%.png}_上传.png"; W="${TARGET%x*}"; H="${TARGET#*x}"
  if command -v magick >/dev/null 2>&1; then M=magick
  elif command -v convert >/dev/null 2>&1; then M=convert; else M=""; fi
  if [ -n "$M" ]; then
    "$M" "$SRC" -resize "${W}x${H}^" -gravity center -extent "${W}x${H}" "$UP"  # 缩放填满后居中裁
  elif command -v sips >/dev/null 2>&1; then
    cp "$SRC" "$UP"
    sw=$(sips -g pixelWidth "$UP" | awk '/pixelWidth/{print $NF}')
    sh=$(sips -g pixelHeight "$UP" | awk '/pixelHeight/{print $NF}')
    if [ $((sw*H)) -ge $((sh*W)) ]; then sips --resampleHeight "$H" "$UP" >/dev/null
    else sips --resampleWidth "$W" "$UP" >/dev/null; fi
    sips -c "$H" "$W" "$UP" >/dev/null   # sips -c 是 高 宽，居中裁
  else
    echo "无 magick/convert/sips，跳过；手动把 $SRC 居中裁剪+缩放到 $TARGET 再上传" >&2
  fi
  [ -f "$UP" ] && file "$UP"
fi
```

> 提示词中的安全区不是裁剪保证；必须检查上传版，确认书名和笔名没有被裁切。

### Step 6：质量检查 + 迭代

| 检查项 | 标准 |
|:-------|:-----|
| 文字渲染 | 书名清晰可辨，字体风格匹配题材 |
| 题材匹配 | 视觉风格与书名题材一致 |
| 构图合理 | 主体突出，文字不遮挡核心画面 |
| 平台适配 | 符合目标平台的封面风格调性 |
| 平台尺寸 | 比例与平台一致；缩放到上传尺寸后书名、笔名完整可见、未被裁切 |

不满意时调整方向：更换构图、调整色调、换字体风格、换平台风格。

---

## 参考资料

| 文件 | 何时加载 |
|:-----|:---------|
| [references/cover-styles.md](references/cover-styles.md) | 题材→视觉风格映射、平台风格详情、提示词模板 |

---

## 语言

- 跟随用户的语言回复，用户用什么语言就用什么语言回复
- 中文回复遵循《中文文案排版指北》
