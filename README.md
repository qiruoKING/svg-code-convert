# SVG代码转换工具 (svg-code-convert)
## 1. 工具简介
基于微信公众号平台规则和渲染特性开发的SVG代码转换工具，核心实现 svg、img、image 三种格式的相互转换，解决微信公众号图文场景下SVG交互内容的渲染兼容问题。

## 2. 核心特性
- 多格式互转：支持多种转换组合，详见 4.2 节点转换函数
- 微信场景适配：自动清理微信专属占位类、懒加载属性，规范标签/属性命名（如viewBox、foreignObject驼峰化）
- 智能样式处理：过滤/保留指定属性、移除width样式、提取背景图片链接到自定义属性
- 异常兜底：图片宽高比计算超时/失败时自动兜底，保证转换流程不中断
- 代码规范化：自动修复标签结构、转义非法字符、统一URL引号格式、压缩冗余空白

## 3. 核心使用流程（三步法）
### 3.1 第一步：解析（Parse）
将原始SVG/HTML代码解析为工具内部的树形结构，同时完成代码预处理（修复结构、清理冗余、提取资源）：
```javascript
// 入参：原始SVG/HTML代码字符串
// 返回：工具内部标准化的树形结构对象
const tree = svgCC.parse(originalCode);
```

### 3.2 第二步：转换（Convert）
调用对应转换函数，对树形结构进行节点替换/重构（可组合调用多个转换函数）：
```javascript
// 示例1：转换为image标签体系
svgCC.fosvg2image(tree);  // foreignObject>svg → image（同步）
svgCC.svg2image(tree);    // svg → svg>image（同步）
svgCC.foimg2image(tree);  // foreignObject>img → image（同步）

// 示例2：转换为img标签体系
svgCC.svg2img(tree);      // svg → img（同步）
svgCC.image2img(tree);    // image → g>foreignObject>img（同步）

// 示例3：转换为svg标签体系
svgCC.image2svg(tree);    // image → g>foreignObject>svg（同步）
await svgCC.img2svg(tree); // img → svg（异步）
```

### 3.3 第三步：合成（Compose）
将转换后的树形结构还原为标准SVG/HTML代码，恢复原生属性（如将自定义iftool-*属性还原为src/href/background等）：
```javascript
// 入参：转换后的树形结构对象
// 返回：标准SVG/HTML代码字符串
const resultCode = svgCC.compose(tree);
```

## 4. 核心API说明
### 4.1 流程核心函数（三步法核心）
| 函数名 | 入参 | 返回值 | 功能说明 |
|--------|------|--------|----------|
| svgCC.parse(code) | code: 原始SVG/HTML代码字符串 | 树形结构对象 | 预处理代码→解析为DOM→提取资源→转为树形对象 |
| svgCC.compose(tree) | tree: 转换后的树形结构 | 标准SVG/HTML代码字符串 | 将树形结构还原为代码，恢复原生属性 |

### 4.2 节点转换函数（核心转换逻辑）
| 函数名 | 转换规则 | 异步/同步 |
|--------|----------|-----------|
| svgCC.fosvg2image(tree) | foreignObject>svg → image | 同步 |
| svgCC.svg2image(tree) | svg → svg>image | 同步 |
| svgCC.svg2img(tree) | svg → img | 同步 |
| svgCC.image2img(tree) | image → g>foreignObject>img | 同步 |
| svgCC.image2svg(tree) | image → g>foreignObject>svg | 同步 |
| svgCC.foimg2image(tree) | foreignObject>img → image | 同步 |
| svgCC.img2image(tree) | img → svg>image | 异步 |
| svgCC.img2svg(tree) | img → svg | 异步 |

### 4.3 工具辅助函数
| 函数名 | 入参 | 返回值 | 功能说明 |
|--------|------|--------|----------|
| svgCC.filterPreservedAttrs(attrs) | attrs: 原始属性对象 | 过滤后的属性对象 | 仅保留白名单（class/id/transform等）和data-开头属性 |
| svgCC.removeWidth(styleArr) | styleArr: 样式字符串数组 | 处理后的样式字符串 | 移除样式中的width相关声明 |
| svgCC.getImageRatio(imageUrl) | imageUrl: 图片链接 | Promise<number> | 获取图片宽高比（异步，超时/失败兜底返回1） |
| svgCC.traverseHtmlTree(node, callback, parentInfo, level) | node: 当前节点；callback: 遍历回调；parentInfo: 父节点信息；level: 遍历层级 | 无 | 深度优先遍历HTML/SVG树形结构 |

## 5. 关键注意事项
1. 运行环境：仅支持浏览器环境（依赖DOM API：DOMParser、XMLSerializer、TreeWalker等），不支持Node.js
2. 图片代理：svgCC.img2image、svgCC.img2svg 函数依赖 svgCC.getImageRatio，该方法需要 proxy-image.php 代理接口解决图片跨域/防盗链问题，需自行实现
3. 异常处理：解析失败、图片加载超时等场景会抛出Error，使用时需用try/catch捕获
4. 标签规范：工具会自动规范化标签/属性命名（如viewbox→viewBox、foreignobject→foreignObject），确保微信渲染兼容

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
