# SVG代码转换工具 (svg-code-convert)

> 面向微信公众号图文场景的 SVG 交互代码转换引擎：`<svg>` `<img>` `<image>` 三态互转 + 图片特征层级量化分析 + 预加载代码自动生成。

[![Version](https://img.shields.io/badge/version-V2-10c366)](https://www.ifsvgtool.com/)
[![License](https://img.shields.io/badge/license-MIT-10c366)](https://github.com/qiruoKING/svg-code-convert/blob/main/LICENSE)
[![Demo](https://img.shields.io/badge/demo-在线体验-10c366)](https://www.ifsvgtool.com/code-converter)
[![Environment](https://img.shields.io/badge/environment-Browser-10c366)](https://www.ifsvgtool.com/code-converter)

## 1. 为什么需要这个工具

微信公众号的 SVG 交互图文存在三类长期痛点：

1. **渲染规则黑盒**：同一套代码，`<svg>` 背景图、`<img>`、`<image>` 三种载体的渲染表现、交互能力（点开大图、长按识别）和审核兼容性各不相同，运营/开发者需要频繁在三种格式间切换验证；
2. **代码写法混乱**：编辑器导出、秀米/135 等第三方工具生成的代码常带有微信专属类名、懒加载属性、裸 `&` 字符、非闭合空标签、小写 SVG 标签名等问题，直接粘贴到公众号后台大概率失效；
3. **图片加载延迟**：交互 SVG 中的关键图片（首屏底图、触发图）常在用户交互时才加载，出现白屏/闪烁，而公众号编辑器不支持手动插入预加载代码。

本工具将这三个问题工程化解决：一套**解析 → 转换 → 合成**的流水线处理格式与规范问题，一套**五维特征评分模型**量化图片在 SVG 中的真实层级并自动生成预加载代码。

## 2. 项目结构

```
svg-code-convert/
├── svg-code-convert.js   # 核心转换引擎，暴露全局对象 svgCC
├── svg-layer-detect.js   # 特征层级分析引擎，暴露全局对象 svgLD（可选模块）
├── proxy-image.php       # 图片代理接口，供异步转换函数突破跨域/防盗链
├── README.md             # 中文文档
├── README.en.md          # English Documentation
└── LICENSE               # MIT License
```

两个 JS 模块**完全解耦**：无相互依赖、无引入顺序要求。只做格式转换引 `svg-code-convert.js` 即可；需要层级分析与预加载时再加 `svg-layer-detect.js`，它直接消费 `svgCC.parse` 产出的树形结构。

## 3. 核心设计

### 3.1 三态互转模型

工具将公众号图文中的图片载体抽象为三种形态，提供 8 个原子转换函数覆盖全部主流转换路径：

```
                    ┌──────────────┐
          svg2image │              │ image2svg
        ┌──────────▶│  svg 背景图   │◀──────────┐
        │           └──────────────┘           │
        │                  ▲                   │
 svg2img│                  │fosvg2image        │img2svg
        │                  │                   │
┌───────┴──────┐   ┌───────┴───────┐   ┌───────┴──────┐
│     img      │   │foreignObject  │   │    image     │
│  (HTML 图片)  │   │ 嵌套 svg/img  │   │  (SVG 图片)   │
└──────────────┘   └───────────────┘   └──────────────┘
        │                                      ▲
        └──────────────img2image───────────────┘
```

### 3.2 中间树结构与资源隔离机制

转换不直接操作字符串或 DOM，而是先将代码解析为轻量自定义树 `{ tag, attrs, children }`（文本节点标记为 `wenben`，注释节点标记为 `zhushi`，完整保留源码信息），所有转换函数在树上做结构化增删改，最后统一序列化。

解析阶段会将所有资源链接从原生位置**迁移到 `iftool-*` 自定义属性**：

| 原生来源 | 迁移目标 |
|----------|----------|
| `<image href>`（兼容旧代码 `xlink:href`） | `iftool-href` |
| `<img src>` | `iftool-src` |
| `style` 中的 `background-image: url(...)` | `iftool-background` |
| `style` 中的背景七属性（color/position/size/repeat/attachment/origin/clip） | `iftool-bg-*` × 7 |

这一设计的价值在于：图片 URL 中常见的 `&` 参数会破坏 XML 解析，迁移后 URL 以属性值形式安全流转于整个转换链路；合成阶段再精确还原，`background` 按 CSS 简写规范重建（自动处理 `position / size` 斜杠语法与各项默认值），资源零丢失、零污染。

### 3.3 十步预处理流水线

`svgCC.parse` 内置 11 个有序预处理函数，以 `Array.reduce` 流水线执行，专治各种"脏代码"：

| 序号 | 步骤 | 作用 |
|------|------|------|
| 0 | replaceDiv | `div` 临时转义为 `div-iftool`，防止后续 DOM 修复与公众号过滤误伤 |
| 1 | fixStructure | 借助浏览器 DOM 解析器自动修复标签嵌套/闭合错误 |
| 2 | removeLazyAttrs | 清除 `img` 的 `data-src`（公众号音视频封面）与全局 `data-lazy-bgimg` 懒加载属性 |
| 3 | removeForbidden | 移除公众号禁止的内容：`script`/`style` 标签及内容、`on*` 事件属性等一切 JS 痕迹 |
| 4 | removePlaceholder | 清除微信背景占位类 `wx_imgbc_placeholder`（支持多 class 共存场景，其余类名保留） |
| 5 | escapeAmpersands | 裸 `&` 转义为 `&amp;`，内置合法实体白名单（含数字实体 `&#160;`/`&#xA0;` 等）不误伤 |
| 6 | unifyQuotes | `url()` 引号统一为单引号并清理首尾空格 |
| 7 | fixVoidTags | `img/br/input/hr` 空元素统一修复为自闭合格式 |
| 8 | compressWhitespace | 压缩空行/缩进/连续空格/`&nbsp;` 实体，`pre/code/textarea` 内容以占位符映射保护，压缩后原样还原 |
| 9 | fixCase | 标签名与 8 个关键属性名驼峰规范化（`foreignObject`、`animateTransform`、`viewBox`、`attributeName`、`keyTimes` 等） |
| 10 | wrapRoot | 包裹 `div#iftool` 确保单根节点，满足 XML 解析要求 |

### 3.4 五维特征层级评分模型（svg-layer-detect.js）

公众号 SVG 交互中，"哪张图在最上层"无法从代码顺序直接判断：`height:0` 折叠、透明遮罩、负 margin 层叠、width 展开动画等手法都会颠覆视觉层级。`svgLD.calcLayer` 通过两次深度优先遍历（首次收集图片与动画映射，二次计算分值），对每张图片输出**特征层级总分**，初始分 20，五个维度加减仓：

**① 底层特征减分（判断"垫底的图"）**

| 特征 | 判定规则 | 分值 |
|------|----------|------|
| 透明样式 | 自身或任一祖先 `style` 中 `opacity` ∈ [0, 0.05]，真透明图多为不可见触发层 | 每处 −5 |
| 透明属性 | 节点 `opacity` 属性 ∈ [0, 0.05] | −5 |
| 不可见隐藏 | 自身或任一祖先 `display: none` / `visibility: hidden`（点击后才显示的隐藏层） | −20 |
| height:0 前置链 | 父容器的并列兄弟中存在连续 `height:0` 节点（支持 px/%/rem/em/vh/vw 等单位的 0 值、`!important` 修饰及 `height="0"` 属性写法识别），每个连续段扣分 = 连续长度 × 10，非 height:0 节点立即阻断计数 | −n×10 |

**② 顶层特征加分（判断"浮在最上的图"），自身与全部祖先链合并计算**

| 特征 | 判定规则 | 分值 |
|------|----------|------|
| 负边距层叠 | `margin-top` 为非 0、非 px 单位的负数（%/rem/em/vh/vw） | +10 |
| px 负边距 | `margin-top` 为 px 单位且绝对值 ≥ 10 的负数（`-1px` 无缝去缝写法不加分） | +5 |
| 变换 | `transform` 存在且非 `none` | +5 |
| 隔离层 | `isolation: isolate` | +3 |
| 层叠序 | `z-index` > 0 | +3 |

**③ 并列容器顺序分**：图片最近的合法容器（svg/g/foreignObject）在兄弟节点中的索引 × 3，解决并列 g/foreignObject 场景的先后覆盖关系。

**④ width 动画顺序分**：处于 `animate attributeName="width"`（展开动画）的 SVG 内部时，组内图片按文档序排列，最后一张（动画完全展开帧）得满分 100，每靠前一张减 0.05。

**⑤ 全局顺序分**：按图片在全文的索引计 `(500 − index) × 0.01`，即首图 +5 并逐张微降，500 张以内保证无缝排版长图场景下靠前者优先。

最终按总分降序、同分按全局索引升序取 Top N（按 URL 去重，同图多处引用只占一个名额；`data:` 内联图已在本地，自动跳过），自动生成公众号兼容的预加载片段（纯 inline style、无 id/class、零脚本，`height:0` + `padding-left:1000px` 屏外隐藏 + `overflow:hidden`，1×1 `foreignObject` 内以 `background-image: cover` 触发浏览器预加载），拼接至图文头部即可生效，对版面零影响。

### 3.5 跨域图片测量

`img2image` / `img2svg` 需要图片真实宽高比以生成精确的 `viewBox`（固定宽度 1080，高度按宽高比换算，贴合公众号 1080 标准宽）。`getImageRatio` 的实现细节：

- 创建屏外隐藏 `<img>` 探测元素，`crossOrigin="anonymous"` + `referrerPolicy="no-referrer"` 双保险绕过微信图片防盗链；
- 图片请求经由仓库内置的 `proxy-image.php` 代理转发，彻底解决浏览器跨域限制。代理端做了四重防护：http/https 协议白名单、微信图床域名白名单（防开放代理滥用）、单图 10MB 上限、302 跳转逐跳重校验；MIME 类型用文件头魔数嗅探，不依赖 URL 后缀；
- 5 秒超时熔断；优先取 `naturalWidth/naturalHeight`，异常时回退渲染尺寸测算，最终失败兜底宽高比 1:1；
- 多张图片以 5 路并发池批量测量（节点替换基于预存索引互不依赖，可安全并发），百图长文也能秒级完成；
- 转换函数对单图失败独立兜底（生成 100% 占位节点），**一张图挂掉不影响整篇转换**。

## 4. 快速开始

### 4.1 引入

**本地文件：**
```html
<script src="svg-code-convert.js"></script>
<!-- 可选：图片层级分析与预加载生成 -->
<script src="svg-layer-detect.js"></script>
```

**jsDelivr CDN（推荐）：**
```html
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-code-convert.js"></script>
<!-- 可选：图片层级分析与预加载生成 -->
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-layer-detect.js"></script>
```

### 4.2 三步法：解析 → 转换 → 合成

```javascript
async function convert(code, type) {
	// 第一步：解析（十步预处理 + XML解析 + 资源迁移 + DOM转树）
	const tree = svgCC.parse(code);

	// 是否转换img元素（不转可保留点开大图/长按识别能力）
	const isImgConvertChecked = document.getElementById('imgConvertCheckbox').checked;

	// 第二步：转换（原子函数自由组合）
	if (type === 'image') {
		svgCC.fosvg2image(tree);       // foreignObject>svg → image
		svgCC.svg2image(tree);         // svg背景图 → svg>image
		if (isImgConvertChecked) {
			svgCC.foimg2image(tree);   // foreignObject>img → image
			await svgCC.img2image(tree); // img → svg>image（异步测量宽高比）
		}
	} else if (type === 'img') {
		svgCC.svg2img(tree);           // 空内容svg背景图 → img
		svgCC.image2img(tree);         // image → g>foreignObject>img
	} else if (type === 'svg') {
		svgCC.image2svg(tree);         // image → g>foreignObject>svg
		if (isImgConvertChecked) {
			await svgCC.img2svg(tree); // img → svg背景图（异步测量宽高比）
		}
	}

	// 第三步：合成（资源还原 + 背景简写重建 + 公众号标签修复）
	return svgCC.compose(tree);
	// 不传 type 时仅执行 解析→合成，即完整的代码清洗规范化
}
```

### 4.3 扩展：层级分析 + 预加载

```javascript
async function convert(code, type) {
	const tree = svgCC.parse(code);

	// 解析后、转换前执行层级分析，取特征层级分最高的 5 张图
	let topLayer = { imagesDetail: '', finalHtml: '' };
	if (document.getElementById('preloadHtmlCheckbox').checked) {
		topLayer = svgLD.calcLayer(tree, 5);
		// console.table(topLayer.imagesDetail); // 五维分明细，调试必备
	}

	// ...第二步转换同上...

	// 预加载片段拼接至图文头部
	return topLayer.finalHtml + svgCC.compose(tree);
}
```

## 5. API 参考

### 5.1 流程核心函数（svgCC）

| 函数 | 入参 | 返回 | 说明 | 同步性 |
|------|------|------|------|--------|
| `svgCC.parse(code)` | code: 原始 SVG/HTML 字符串 | 树形结构对象 | 十步预处理 → DOMParser XML 解析（parsererror 检测抛错）→ TreeWalker 资源迁移 → 递归转树 | 同步 |
| `svgCC.compose(tree)` | tree: 转换后的树 | 标准代码字符串 | 树转 XML DOM（大小写敏感）→ 资源属性还原 → 背景简写重建 → 移除 xmlns/根容器 → 14 类公众号强制闭合标签修复（含 `mp-common-*` 组件） | 同步 |

### 5.2 节点转换函数（svgCC，入参均为 tree，原地修改，可自由组合）

| 函数 | 转换路径 | 触发条件 | 同步性 |
|------|----------|----------|--------|
| `svgCC.fosvg2image(tree)` | foreignObject>svg → image | svg 含背景链接且无子内容 | 同步 |
| `svgCC.svg2image(tree)` | svg → svg>image | 最外层 svg 含背景链接；**自动跳过含 `animate attributeName="height" by="-1"` 缩回动画的 svg** | 同步 |
| `svgCC.svg2img(tree)` | svg → img | 空内容 svg 且含背景链接 | 同步 |
| `svgCC.image2img(tree)` | image → g>foreignObject>img | image 含 href 且无子内容 | 同步 |
| `svgCC.image2svg(tree)` | image → g>foreignObject>svg | image 含 href 且无子内容 | 同步 |
| `svgCC.foimg2image(tree)` | foreignObject>img → image | img 含 src 且无子内容 | 同步 |
| `svgCC.img2image(tree)` | img → svg>image | img 无宽高属性且非 foreignObject 子节点；失败独立兜底 | 异步 |
| `svgCC.img2svg(tree)` | img → svg 背景图 | img 含 src 且无子内容；失败独立兜底 | 异步 |

转换过程的通用规则：fo/img 双层属性合并（子覆盖父）→ 白名单过滤（`class/id/name/label/pointer-events/transform/opacity` + `data-*`）→ 样式合并并移除 `width` 声明 → 定位属性继承（x/y 缺省 0，width/height 缺省 100%）。

### 5.3 特征层级计算（svgLD）

| 函数 | 入参 | 返回 | 说明 | 同步性 |
|------|------|------|------|--------|
| `svgLD.calcLayer(tree, number)` | tree: 解析/转换后的树；number: 筛选数量 | `{ imagesDetail, finalHtml }` | 五维评分 → 降序取 Top N → 生成预加载片段 → 自动清理临时属性，零副作用 | 同步 |

`imagesDetail` 数组中每项包含：`url`（图片链接）、`layer`（层级总分）、`globalOrder`（全局索引）、`totalBottomScore`（底层特征分）、`totalTopScore`（顶层特征分）、`gfoScore`（并列容器顺序分）、`animateScore`（width 动画顺序分）、`globalScore`（全局顺序分）。

### 5.4 辅助函数

| 模块 | 函数 | 说明 |
|------|------|------|
| svgCC | `filterPreservedAttrs(attrs)` | 白名单 + `data-*` 属性过滤 |
| svgCC | `removeWidth(styleArr)` | 样式数组合并并移除 width 声明（大小写兼容），返回合法 CSS |
| svgCC | `getImageRatio(imageUrl)` | 代理加载取图片宽高比，Promise\<number\>，超时/失败兜底 1 |
| svgCC | `traverseHtmlTree(node, callback, parentInfo, level)` | 深度优先遍历，回调返回 true 终止当前分支，parentInfo 携带父节点与子索引 |
| svgLD | `parseStyle(styleStr)` | CSS 字符串解析为键值对象，calcLayer 核心依赖 |

## 6. 注意事项

1. **运行环境**：仅浏览器（依赖 DOMParser / XMLSerializer / TreeWalker / TreeWalker 等 DOM API），不支持纯 Node.js；
2. **代理配置**：仅 `img2image`、`img2svg` 两个异步函数需要 `proxy-image.php`；不用它们则无需部署 PHP；
3. **异常兜底**：解析失败、图片超时等会抛 Error，业务侧建议 `try/catch`；异步转换内部已对单图失败做独立兜底；
4. **代码风格**：输出代码会被规范化（驼峰命名、自闭合、引号、空白），需保留原始风格请谨慎使用；
5. **预加载片段**：隐藏样式（height:0 + 屏外偏移），拼接至图文头部即可，不影响版面；
6. **公众号合规**：公众号图文仅允许 inline style，不允许 id/class（上传时会被编辑器剥离）、不允许 `style`/`script` 标签与任何 JS 脚本；重叠效果不能使用绝对/相对定位，只能靠 `height:0` 折叠、负 margin、transform 等手法实现，本工具的评分模型与生成代码均遵循该约束。

## 7. 开源信息

- 版本：V2
- 许可证：[MIT License](LICENSE)
- 项目主页：https://www.ifsvgtool.com/
- 在线演示：https://www.ifsvgtool.com/code-converter
- 代码仓库：
  - GitHub: https://github.com/qiruoKING/svg-code-convert
  - Gitee: https://gitee.com/forPage/svg-code-convert
- 版权信息：Copyright (c) 2026 上海意符文化传媒有限公司
