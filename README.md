# SVG代码转换工具 (svg-code-convert)
## 1. 工具简介
基于微信公众号平台规则和渲染特性开发的SVG代码转换工具，核心实现 svg、img、image 三种格式的相互转换，解决微信公众号图文场景下SVG交互内容的渲染兼容问题。

## 2. 核心特性
- 多格式互转：支持多种转换组合，详见 4.2 节点转换函数
- 微信场景适配：自动清理微信专属占位类、懒加载属性，规范标签/属性命名
- 智能样式处理：过滤/保留指定属性、移除width样式、提取背景图片链接到自定义属性
- 异常兜底：图片宽高比计算超时/失败时自动兜底，保证转换流程不中断
- 代码规范化：自动修复标签结构、转义非法字符、统一URL引号格式、压缩冗余空白

## 3. 快速开始
### 3.1 引入方式
#### 方式1：本地文件引入
将 svg-code-convert.js 放入项目目录，通过 script 标签引入：
```html
<script src="svg-code-convert.full.js"></script>
```

#### 方式2：CDN引入（推荐）
使用 jsDelivr 加载 GitHub 上的文件：
```html
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-code-convert.full.js"></script>
```

### 3.2 核心使用流程（三步法）
#### 3.2.1 第一步：解析
将原始 SVG/HTML 代码解析为工具内部的树形结构，同时完成代码预处理：
```javascript
const tree = svgCC.parse(originalCode);
```

#### 3.2.2 第二步：转换
调用对应转换函数，对树形结构进行节点替换/重构（可组合调用，详见 4.2 节点转换函数）：
```javascript
// 示例1：转换为image标签体系
svgCC.fosvg2image(tree);   // foreignObject>svg → image（同步）
svgCC.svg2image(tree);     // svg → svg>image（同步）
svgCC.foimg2image(tree);   // foreignObject>img → image（同步）
await svgCC.img2image(tree);// img → svg>image（异步）

// 示例2：转换为img标签体系
svgCC.svg2img(tree);       // svg → img（同步）
svgCC.image2img(tree);     // image → g>foreignObject>img（同步）

// 示例3：转换为svg标签体系
svgCC.image2svg(tree);     // image → g>foreignObject>svg（同步）
await svgCC.img2svg(tree); // img → svg（异步）
```

#### 3.2.3 第三步：合成
将转换后的树形结构还原为标准 SVG/HTML 代码：
```javascript
const resultCode = svgCC.compose(tree);
```

#### 3.2.4 三步完整流程代码演示
引入 svg-code-convert 之后，在用到转换处理的部分添加：
```javascript
async function convert(code, type) {
	const tree = svgCC.parse(code); // 第一步：解析
	const isImgConvertChecked = document.getElementById('imgConvertCheckbox').checked; // 是否修改代码中可能存在的 img 元素（防止点开大图、长按扫描等效果失效）
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
	const result = svgCC.compose(tree); // 第三步：合成
	return result; // 如果 type 为其他字符串，则只进行解析-合成两步，仅优化代码写法
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
    <!-- 第一步 -->
    <tr>
      <td rowspan="1">第一步</td>
      <td rowspan="1">流程核心函数</td>
      <td>svgCC.parse(code)</td>
      <td>code: 原始 SVG/HTML 代码字符串</td>
      <td>树形结构对象</td>
      <td>预处理代码→解析为DOM→提取资源→转为树形对象</td>
      <td>同步</td>
    </tr>
    <!-- 第二步 -->
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
      <td>svg → svg&gt;image</td>
      <td>同步</td>
    </tr>
    <tr>
      <td>svgCC.svg2img(tree)</td>
      <td>svg → img</td>
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
      <td>img → svg&gt;image</td>
      <td>异步</td>
    </tr>
    <tr>
      <td>svgCC.img2svg(tree)</td>
      <td>img → svg</td>
      <td>异步</td>
    </tr>
    <!-- 第三步 -->
    <tr>
      <td rowspan="1">第三步</td>
      <td rowspan="1">流程核心函数</td>
      <td>svgCC.compose(tree)</td>
      <td>tree: 转换后的树形结构</td>
      <td>标准 SVG/HTML 代码字符串</td>
      <td>将树形结构还原为代码，恢复原生属性</td>
      <td>同步</td>
    </tr>
  </tbody>
</table>

### 4.1 其他辅助函数
| 函数名 | 入参 | 返回 | 功能说明 |
|--------|------|------|----------|
| svgCC.filterPreservedAttrs(attrs) | attrs: 原始属性对象 | 过滤后的属性对象 | 仅保留白名单（见代码开头）和 data-* 属性 |
| svgCC.removeWidth(styleArr) | styleArr: 样式字符串数组 | 处理后的样式字符串 | 移除样式中的width相关声明 |
| svgCC.getImageRatio(imageUrl) | imageUrl: 图片链接 | Promise<number> | 获取图片宽高比（异步，超时/失败兜底返回1） |
| svgCC.traverseHtmlTree(node, callback, parentInfo, level) | node: 当前节点；<br>callback: 遍历回调；<br>parentInfo: 父节点信息；<br>level: 遍历层级 | 无 | 深度优先遍历 SVG/HTML 树形结构 |

## 5. 关键注意事项
1. 运行环境：仅支持浏览器环境（依赖DOM API：DOMParser、XMLSerializer、TreeWalker等），不支持纯后端的 Node.js
2. 图片代理：img2image、img2svg 函数依赖 getImageRatio，该方法需要配置 proxy-image.php 代理接口解决图片跨域/防盗链问题，若不使用这两个转换函数则不受影响
3. 异常处理：解析失败、图片加载超时等场景会抛出 Error，可以在配置时使用 try/catch 捕获
4. 写法规范：工具会自动规范化标签命名/标签闭合/属性命名/样式格式，有自己代码风格的朋友慎重使用

## 6. 开源信息
- 作者：qiruo
- 版本：1.0.0
- 许可证：MIT License
- 项目主页：https://www.ifsvgtool.com/
- 演示地址：https://www.ifsvgtool.com/code-converter
- 代码仓库：
  - GitHub: https://github.com/qiruoKING/svg-code-convert
  - Gitee: https://gitee.com/forPage/svg-code-convert
- 版权信息：Copyright (c) 2026 上海意符文化传媒有限公司
