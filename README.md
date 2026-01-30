# SVG代码转换工具 (svg-code-convert)
## 1. 工具简介
基于微信公众号平台规则和渲染特性开发的SVG代码转换工具，核心实现 svg、img、image 三种格式的相互转换，同时新增SVG内图片特征层级分计算与预加载HTML生成能力，一站式解决微信公众号图文场景下SVG交互内容的渲染兼容、图片加载优化问题。

## 2. 核心特性
- 多格式互转：支持多种转换组合，详见 4.2 节点转换函数
- 微信场景适配：自动清理微信专属类、懒加载属性，规范标签/属性命名，适配公众号SVG渲染规则
- 代码规范化：自动修复标签结构、转义非法字符、统一URL引号格式、压缩冗余空白，输出标准SVG/HTML代码
- 智能层级计算：深度分析SVG内所有图片的特征层级（底层特征减分、顶层特征加分、容器/动画/全局顺序调整），精准筛选最靠前/最高层级图片
- 预加载HTML生成：根据层级计算结果，自动生成公众号兼容的图片预加载HTML片段，优化图文首屏加载体验，解决交互SVG图片加载延迟问题

## 3. 快速开始
### 3.1 引入方式
#### 方式1：本地文件引入
将 svg-code-convert.js 放入项目目录，通过 script 标签引入：
```html
<script src="svg-code-convert.min.js"></script>
```

#### 方式2：CDN引入（推荐）
使用 jsDelivr 加载 GitHub 上的文件：
```html
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-code-convert.min.js"></script>
```

### 3.2 核心使用流程（三步法：解析→转换→合成）
#### 3.2.1 第一步：解析
将原始 SVG/HTML 代码解析为工具内部的树形结构，同时完成代码预处理：
```javascript
const tree = svgCC.parse(originalCode);
```

#### 3.2.2 第二步：转换
调用对应转换函数，对树形结构进行节点替换/重构（可组合调用，详见 4.2 节点转换函数）：
```javascript
// 示例1：转换为image标签体系
svgCC.fosvg2image(tree);
svgCC.svg2image(tree);
svgCC.foimg2image(tree);
await svgCC.img2image(tree);

// 示例2：转换为img标签体系
svgCC.svg2img(tree);
svgCC.image2img(tree);

// 示例3：转换为svg标签体系
svgCC.image2svg(tree);
await svgCC.img2svg(tree);
```

#### 3.2.3 第三步：合成
将转换后的树形结构还原为标准 SVG/HTML 代码：
```javascript
const resultCode = svgCC.compose(tree);
```

#### 3.2.4 三步法完整代码演示
引入 svg-code-convert.js 之后，在用到转换处理的部分添加：
```javascript
async function convert(code, type) {
	// 第一步：解析
	const tree = svgCC.parse(code);
	const isImgConvertChecked = document.getElementById('imgConvertCheckbox').checked; // 是否转换img元素（防止点开大图/长按扫描失效）

	// 第二步：转化
	if (type === 'image') {
		svgCC.fosvg2image(tree);
		svgCC.svg2image(tree);
		if (isImgConvertChecked) {
			svgCC.foimg2image(tree);
			await svgCC.img2image(tree);
		}
	} else if (type === 'img') {
		svgCC.svg2img(tree);
		svgCC.image2img(tree);
	} else if (type === 'svg') {
		svgCC.image2svg(tree);
		if (isImgConvertChecked) {
			await svgCC.img2svg(tree);
		}
	}

	// 第三步：合成
	const result = svgCC.compose(tree);
	return result; // 非指定type则仅执行解析-合成，完成代码优化
}
```

### 3.3 扩展流程：层级计算 + 预加载HTML生成
转换完成后，可调用`calcLayer`函数分析SVG内图片层级，生成预加载HTML，并将其拼接至公众号图文代码头部，实现图片预加载优化，该步骤为可选扩展，与核心转换流程解耦：
```javascript
async function convert(code, type) {
	// 第一步：解析
	const tree = svgCC.parse(code);
	let topLayer = { imagesDetail: '', finalHtml: '' }; // 预加载默认值
	const isPreloadHtmlChecked = document.getElementById('preloadHtmlCheckbox').checked; // 是否预加载流程
	if (isPreloadHtmlChecked) {
		topLayer = svgCC.calcLayer(tree, 5); // 解析后、转化前获取特征层级分最高的5张图片链接的预加载值
		// console.log('完整层级明细：', topLayer.imagesDetail) // 调试日志
	}
	const isImgConvertChecked = document.getElementById('imgConvertCheckbox').checked; // 是否转换img元素（防止点开大图/长按扫描失效）

	// 第二步：转化
	if (type === 'image') {
		svgCC.fosvg2image(tree);
		svgCC.svg2image(tree);
		if (isImgConvertChecked) {
			await svgCC.foimg2image(tree);
			await svgCC.img2image(tree);
		}
	} else if (type === 'img') {
		svgCC.svg2img(tree);
		svgCC.image2img(tree);
	} else if (type === 'svg') {
		svgCC.image2svg(tree);
		if (isImgConvertChecked) {
			await svgCC.img2svg(tree);
		}
	}

	// 第三步：合成
	const result = topLayer.finalHtml + svgCC.compose(tree); // 拼接预加载HTML
	return result; // 非指定type则仅执行解析-合成，完成代码优化
}
```

## 4. 核心API说明
<table border="0" cellpadding="4" cellspacing="0">
  <thead>
    <tr>
      <th>步骤</th>
      <th>函数分类</th>
      <th>函数名</th>
      <th>入参</th>
      <th>返回</th>
      <th>功能说明/转换规则</th>
      <th>异步/同步</th>
    </tr>
  </thead>
  <tbody>
    <!-- 第一步：解析 -->
    <tr>
      <td rowspan="1">第一步</td>
      <td rowspan="1">流程核心函数</td>
      <td>svgCC.parse(code)</td>
      <td>code: 原始 SVG/HTML 代码字符串</td>
      <td>树形结构对象</td>
      <td>预处理代码→XML解析→提取资源链接→DOM节点转为自定义树形对象</td>
      <td>同步</td>
    </tr>
    <!-- 第二步：转换 -->
    <tr>
      <td rowspan="8">第二步</td>
      <td rowspan="8">节点转换函数</td>
      <td>svgCC.fosvg2image(tree)</td>
      <td rowspan="8">tree: 转换前的树形结构</td>
      <td rowspan="8">无（直接修改树形结构）</td>
      <td>foreignObject&gt;svg → image</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.svg2image(tree)</td>
      <td>svg → svg&gt;image（过滤height-by=-1的动画svg）</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.svg2img(tree)</td>
      <td>svg（空内容+含背景链接）→ img</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.image2img(tree)</td>
      <td>image → g&gt;foreignObject&gt;img</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.image2svg(tree)</td>
      <td>image → g&gt;foreignObject&gt;svg</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.foimg2image(tree)</td>
      <td>foreignObject&gt;img → image</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.img2image(tree)</td>
      <td>img（无宽高+非fo子节点）→ svg&gt;image</td>
      <td>异步</td>
    </tr>
    <tr>
      <td>svgCC.img2svg(tree)</td>
      <td>img → svg（含背景链接，自动计算宽高）</td>
      <td>异步</td>
    </tr>
    <!-- 第三步：合成 -->
    <tr>
      <td rowspan="1">第三步</td>
      <td rowspan="1">流程核心函数</td>
      <td>svgCC.compose(tree)</td>
      <td>tree: 转换后的树形结构</td>
      <td>标准 SVG/HTML 代码字符串</td>
      <td>将自定义树形结构还原为标准代码，恢复原生属性/样式/资源链接</td>
      <td>同步</td>
    </tr>
    <!-- 第四步：层级计算（扩展） -->
    <tr>
      <td rowspan="1">第四步（扩展）</td>
      <td rowspan="1">特征层级计算函数</td>
      <td>svgCC.calcLayer(tree, number)</td>
      <td>tree: 解析/转换后的树形结构<br>number: 需要筛选的最高层级图片数量</td>
      <td>层级计算结果对象（见下方说明）</td>
      <td>分析SVG内所有图片特征层级分，筛选指定数量最高层级图片，生成公众号兼容的预加载HTML片段，自动清理临时属性</td>
      <td>同步</td>
    </tr>
  </tbody>
</table>

### 4.1 calcLayer返回结果说明
`svgCC.calcLayer`返回的层级计算结果对象包含2个核心属性，满足使用与调试需求：
| 属性名 | 类型 | 功能说明 |
|--------|------|----------|
| imagesDetail | Array | 所有图片的完整层级计算明细，含图片链接、层级总分、各维度分值（底层减分/顶层加分/容器/动画/全局顺序分）、全局索引 |
| finalHtml | String | 公众号兼容的图片预加载HTML片段，可直接拼接至图文代码头部，无渲染影响且能实现图片预加载 |

### 4.2 其他辅助函数
| 函数名 | 入参 | 返回 | 功能说明 |
|--------|------|------|----------|
| svgCC.filterPreservedAttrs(attrs) | attrs: 原始属性对象 | 过滤后的属性对象 | 仅保留白名单（class/id/transform等）和 data-* 自定义属性 |
| svgCC.removeWidth(styleArr) | styleArr: 样式字符串数组 | 处理后的样式字符串 | 移除样式中的width相关声明，兼容大小写，返回合法CSS样式字符串 |
| svgCC.getImageRatio(imageUrl) | imageUrl: 图片链接 | Promise<number> | 异步获取图片宽高比，配置代理解决跨域/防盗链，超时/失败兜底返回1 |
| svgCC.traverseHtmlTree(node, callback, parentInfo, level) | node: 当前节点；<br>callback: 遍历回调；<br>parentInfo: 父节点信息；<br>level: 遍历层级 | 无 | 深度优先遍历SVG/HTML树形结构，回调可控制是否终止子节点遍历 |
| svgCC.parseStyle(styleStr) | styleStr: CSS样式字符串（可选） | 解析后的样式键值对对象 | 将CSS样式字符串解析为JS对象，方便样式的增删改查操作，calcLayer核心依赖 |

## 5. 关键注意事项
1. 运行环境：仅支持浏览器环境（依赖DOM API：DOMParser、XMLSerializer、TreeWalker等），不支持纯后端Node.js环境
2. 图片代理：`img2image`、`img2svg`异步转换函数依赖`getImageRatio`，该方法需要配置`proxy-image.php`代理接口解决公众号图片跨域/防盗链问题；若不使用这两个异步转换函数，无需配置代理
3. 异常处理：代码解析失败、图片加载超时/失败等场景会抛出Error，建议在业务代码中使用`try/catch`捕获并做兜底处理
4. 写法规范：工具会自动规范化标签/属性命名（驼峰化）、标签闭合方式、样式格式、URL引号，若需保留自定义代码风格请谨慎使用
6. 预加载使用：`calcLayer`生成的预加载HTML片段仅需拼接至公众号图文代码头部，其样式为隐藏状态，不会影响页面布局和内容渲染

## 6. 开源信息
- 版本：1.0.0
- 许可证：MIT License
- 项目主页：https://www.ifsvgtool.com/
- 演示地址：https://www.ifsvgtool.com/code-converter
- 代码仓库：
  - GitHub: https://github.com/qiruoKING/svg-code-convert
  - Gitee: https://gitee.com/forPage/svg-code-convert
- 版权信息：Copyright (c) 2026 上海意符文化传媒有限公司
