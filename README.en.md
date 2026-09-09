# SVG Code Converter (svg-code-convert)

> A conversion engine for interactive SVG content in WeChat Official Account articles: three-way conversion between `<svg>` `<img>` `<image>`, quantitative image-layer scoring, and automatic preload-code generation.

[![Version](https://img.shields.io/badge/version-V2-10c366)](https://www.ifsvgtool.com/)
[![License](https://img.shields.io/badge/license-MIT-10c366)](https://github.com/qiruoKING/svg-code-convert/blob/main/LICENSE)
[![Demo](https://img.shields.io/badge/demo-online-10c366)](https://www.ifsvgtool.com/code-converter)
[![Environment](https://img.shields.io/badge/environment-Browser-10c366)](https://www.ifsvgtool.com/code-converter)

## 1. Why This Tool

Interactive SVG in WeChat articles suffers from three long-standing pain points:

1. **Opaque rendering rules**: the same code behaves differently depending on whether images are carried by `<svg>` backgrounds, `<img>`, or `<image>`, with different interaction capabilities (tap-to-zoom, long-press recognition) and review compatibility. Developers constantly switch between the three formats to verify behavior.
2. **Messy source code**: code exported from editors and third-party tools often carries WeChat-specific class names, lazy-load attributes, bare `&` characters, non-self-closing void tags, and lowercase SVG tag names. Pasted directly into the WeChat editor, it usually breaks.
3. **Image loading delays**: critical images inside interactive SVGs (first-screen base images, trigger images) often load only when the user interacts, causing white flashes, while the WeChat editor offers no way to insert preload code manually.

This tool solves all three engineering-wise: a **parse → convert → compose** pipeline for format and syntax problems, plus a **five-dimension feature scoring model** that quantifies the real visual layer of every image in the SVG and generates preload code automatically.

## 2. Project Structure

```
svg-code-convert/
├── svg-code-convert.js   # Core conversion engine, exposes the global object svgCC
├── svg-layer-detect.js   # Feature layer analysis engine, exposes the global object svgLD (optional)
├── proxy-image.php       # Image proxy endpoint for the async converters to bypass cross-origin/anti-hotlink limits
├── README.md             # 中文文档
├── README.en.md          # English documentation
└── LICENSE               # MIT License
```

The two JS modules are **fully decoupled**: no mutual dependency, no required include order. Include `svg-code-convert.js` alone for format conversion; add `svg-layer-detect.js` when you need layer analysis and preloading. It consumes the tree produced by `svgCC.parse` directly.

## 3. Core Design

### 3.1 Three-State Conversion Model

The tool abstracts image carriers in WeChat articles into three forms, with 8 atomic conversion functions covering all mainstream conversion paths:

```
                    ┌──────────────┐
          svg2image │              │ image2svg
        ┌──────────▶│ svg with bg  │◀──────────┐
        │           └──────────────┘           │
        │                  ▲                   │
 svg2img│                  │fosvg2image        │img2svg
        │                  │                   │
┌───────┴──────┐   ┌───────┴───────┐   ┌───────┴──────┐
│     img      │   │foreignObject  │   │    image     │
│  (HTML img)  │   │ nested svg/img│   │  (SVG image) │
└──────────────┘   └───────────────┘   └──────────────┘
        │                                      ▲
        └──────────────img2image───────────────┘
```

### 3.2 Intermediate Tree and Asset Isolation

Conversion never operates on raw strings or the DOM directly. Code is first parsed into a lightweight custom tree `{ tag, attrs, children }` (text nodes tagged `wenben`, comments tagged `zhushi`, preserving all source information). Every conversion function performs structural edits on the tree, and serialization happens once at the end.

During parsing, all resource URLs are **migrated from their native locations to custom `iftool-*` attributes**:

| Native Source | Migrated To |
|---------------|-------------|
| `<image href>` (with legacy `xlink:href` support) | `iftool-href` |
| `<img src>` | `iftool-src` |
| `background-image: url(...)` in `style` | `iftool-background` |
| Seven background properties in `style` (color/position/size/repeat/attachment/origin/clip) | `iftool-bg-*` × 7 |

Why this matters: the `&` parameters common in image URLs break XML parsing. After migration, URLs travel safely through the entire conversion pipeline as plain attribute values. At composition time they are restored precisely, and `background` is rebuilt as a proper CSS shorthand (with correct `position / size` slash syntax and per-property defaults). Zero asset loss, zero pollution.

### 3.3 Ten-Step Preprocessing Pipeline

`svgCC.parse` runs 11 ordered preprocessing functions in an `Array.reduce` pipeline, purpose-built for dirty real-world code:

| # | Step | Purpose |
|---|------|---------|
| 0 | replaceDiv | Temporarily escapes `div` as `div-iftool`, protecting it from DOM repair and WeChat filtering |
| 1 | fixStructure | Uses the browser DOM parser to auto-repair tag nesting/closing errors |
| 2 | removeLazyAttrs | Strips `data-src` on `img` (WeChat audio/video cover) and all `data-lazy-bgimg` lazy-load attributes |
| 3 | removeForbidden | Removes content forbidden by WeChat: `script`/`style` tags and their contents, `on*` event attributes, and any other JS traces |
| 4 | removePlaceholder | Removes the WeChat background placeholder class `wx_imgbc_placeholder` (multi-class safe: other classes survive) |
| 5 | escapeAmpersands | Escapes bare `&` to `&amp;` with a valid-entity whitelist (including numeric entities like `&#160;`/`&#xA0;`) to avoid false positives |
| 6 | unifyQuotes | Normalizes `url()` quoting to single quotes and trims whitespace |
| 7 | fixVoidTags | Converts `img/br/input/hr` void elements to self-closing form |
| 8 | compressWhitespace | Compresses blank lines/indentation/consecutive spaces/`&nbsp;` entities; `pre/code/textarea` contents are shielded via placeholder mapping and restored verbatim |
| 9 | fixCase | CamelCase normalization for tag names and 8 key attributes (`foreignObject`, `animateTransform`, `viewBox`, `attributeName`, `keyTimes`, etc.) |
| 10 | wrapRoot | Wraps everything in `div#iftool` to guarantee a single root node for XML parsing |

### 3.4 Five-Dimension Feature Layer Scoring (svg-layer-detect.js)

In WeChat interactive SVGs, "which image sits on top" cannot be read from code order: `height:0` collapsing, transparent overlays, negative-margin stacking, and width-expansion animations all subvert visual layering. `svgLD.calcLayer` runs two depth-first traversals (first collecting images and animation mappings, then scoring) and outputs a **total feature layer score** per image, starting from a base of 20 with five adjustment dimensions:

**① Bottom-feature penalties (detecting "base layer" images)**

| Feature | Rule | Score |
|---------|------|-------|
| Opacity style | `opacity` ∈ [0, 0.05] in the node's own or any ancestor's `style`; truly transparent images are usually invisible trigger layers | −5 each |
| Opacity attribute | `opacity` attribute ∈ [0, 0.05] | −5 |
| Invisible | `display: none` / `visibility: hidden` on the node or any ancestor (hidden layers revealed after interaction) | −20 |
| height:0 prefix chain | Among the parent container's preceding siblings, each continuous run of `height:0` nodes (recognizing zero values in px/%/rem/em/vh/vw, `!important` modifiers, and the `height="0"` attribute form) costs run length × 10; a non-zero sibling breaks the run immediately | −n×10 |

**② Top-feature bonuses (detecting "top layer" images), computed over the node plus its full ancestor chain**

| Feature | Rule | Score |
|---------|------|-------|
| Negative margin stacking | `margin-top` is a non-zero, non-px negative value (%/rem/em/vh/vw) | +10 |
| Px negative margin | `margin-top` is a px-unit negative with absolute value ≥ 10 (the `-1px` seamless-join trick earns nothing) | +5 |
| Transform | `transform` present and not `none` | +5 |
| Isolation | `isolation: isolate` | +3 |
| Stacking order | `z-index` > 0 | +3 |

**③ Sibling container order**: the index of the image's nearest valid container (svg/g/foreignObject) among its siblings × 3, resolving overlap order between parallel g/foreignObject blocks.

**④ Width-animation order**: inside an SVG with `animate attributeName="width"` (expansion animation), within the group, the last image in document order (the fully expanded animation frame) scores a full 100, decreasing by 0.05 for each earlier image.

**⑤ Global order**: `(500 − index) × 0.01` over the image's document index, i.e. +5 for the first image with a slight per-image decay; within the 500-image article limit, earlier images win in seamless long-image layouts.

The final ranking sorts by score descending (ties broken by ascending global index) and takes the Top N (deduplicated by URL, so repeated references to the same image occupy only one slot; `data:` inline images are skipped since they need no preloading), and generates a WeChat-compatible preload snippet (pure inline styles, no id/class, zero scripts, hidden offscreen via `height:0` + `padding-left:1000px` + `overflow:hidden`, with 1×1 `foreignObject` SVGs using `background-image: cover` to trigger browser preloading). Prepend it to the article code and it works with zero layout impact.

### 3.5 Cross-Origin Image Measurement

`img2image` / `img2svg` need the real aspect ratio of each image to emit an accurate `viewBox` (fixed width 1080, height derived from the ratio, matching the WeChat 1080 standard width). Implementation details of `getImageRatio`:

- Creates a hidden offscreen `<img>` probe with `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"` as a double safeguard against WeChat's anti-hotlinking;
- Requests are routed through the bundled `proxy-image.php`, eliminating browser cross-origin restrictions entirely. The proxy is hardened with four safeguards: an http/https scheme whitelist, a WeChat image-host domain whitelist (preventing open-proxy abuse), a 10MB per-image cap, and per-hop revalidation of 302 redirects; MIME types are sniffed from magic bytes rather than URL extensions;
- 5-second timeout circuit breaker; prefers `naturalWidth/naturalHeight`, falls back to rendered-size measurement, and ultimately to a 1:1 ratio;
- Multiple images are measured in a 5-way concurrency pool (node replacement is index-based and independent, so concurrency is safe), keeping even image-heavy long articles fast;
- Each converter handles per-image failures independently (emitting a 100% placeholder node), so **one broken image never fails the whole article**.

## 4. Quick Start

### 4.1 Installation

**Local files:**
```html
<script src="svg-code-convert.js"></script>
<!-- Optional: image layer analysis and preload generation -->
<script src="svg-layer-detect.js"></script>
```

**jsDelivr CDN (recommended):**
```html
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-code-convert.js"></script>
<!-- Optional: image layer analysis and preload generation -->
<script src="https://cdn.jsdelivr.net/gh/qiruoKING/svg-code-convert@main/svg-layer-detect.js"></script>
```

### 4.2 Three Steps: Parse → Convert → Compose

```javascript
async function convert(code, type) {
	// Step 1: parse (ten-step preprocessing + XML parsing + asset migration + DOM-to-tree)
	const tree = svgCC.parse(code);

	// whether to convert img elements (skip to keep tap-to-zoom / long-press working)
	const isImgConvertChecked = document.getElementById('imgConvertCheckbox').checked;

	// Step 2: convert (atomic functions, freely combinable)
	if (type === 'image') {
		svgCC.fosvg2image(tree);         // foreignObject>svg → image
		svgCC.svg2image(tree);           // svg background → svg>image
		if (isImgConvertChecked) {
			svgCC.foimg2image(tree);     // foreignObject>img → image
			await svgCC.img2image(tree); // img → svg>image (async ratio measurement)
		}
	} else if (type === 'img') {
		svgCC.svg2img(tree);             // empty svg with background → img
		svgCC.image2img(tree);           // image → g>foreignObject>img
	} else if (type === 'svg') {
		svgCC.image2svg(tree);           // image → g>foreignObject>svg
		if (isImgConvertChecked) {
			await svgCC.img2svg(tree);   // img → svg background (async ratio measurement)
		}
	}

	// Step 3: compose (asset restoration + background shorthand rebuild + WeChat tag fixes)
	return svgCC.compose(tree);
	// without a type, only parse+compose runs: a full code cleanup and normalization
}
```

### 4.3 Extension: Layer Analysis + Preloading

```javascript
async function convert(code, type) {
	const tree = svgCC.parse(code);

	// run layer analysis after parsing and before conversion; take the 5 highest-scoring images
	let topLayer = { imagesDetail: '', finalHtml: '' };
	if (document.getElementById('preloadHtmlCheckbox').checked) {
		topLayer = svgLD.calcLayer(tree, 5);
		// console.table(topLayer.imagesDetail); // five-dimension breakdown, great for debugging
	}

	// ...step 2, same as above...

	// prepend the preload snippet to the article code
	return topLayer.finalHtml + svgCC.compose(tree);
}
```

## 5. API Reference

### 5.1 Core Workflow Functions (svgCC)

| Function | Parameters | Returns | Description | Sync |
|----------|------------|---------|-------------|------|
| `svgCC.parse(code)` | code: raw SVG/HTML string | tree object | Ten-step preprocessing → DOMParser XML parsing (throws on parsererror) → TreeWalker asset migration → recursive tree conversion | Sync |
| `svgCC.compose(tree)` | tree: the converted tree | standard code string | Tree to case-sensitive XML DOM → asset attribute restoration → background shorthand rebuild → xmlns/root-wrapper removal → explicit-closing fixes for 14 tag families required by WeChat (including `mp-common-*` components) | Sync |

### 5.2 Node Conversion Functions (svgCC; all take `tree`, mutate in place, freely combinable)

| Function | Path | Trigger Condition | Sync |
|----------|------|-------------------|------|
| `svgCC.fosvg2image(tree)` | foreignObject>svg → image | svg has a background URL and no children | Sync |
| `svgCC.svg2image(tree)` | svg → svg>image | outermost svg with a background URL; **automatically skips svgs containing `animate attributeName="height" by="-1"` collapse animations** | Sync |
| `svgCC.svg2img(tree)` | svg → img | empty svg with a background URL | Sync |
| `svgCC.image2img(tree)` | image → g>foreignObject>img | image with href and no children | Sync |
| `svgCC.image2svg(tree)` | image → g>foreignObject>svg | image with href and no children | Sync |
| `svgCC.foimg2image(tree)` | foreignObject>img → image | img with src and no children | Sync |
| `svgCC.img2image(tree)` | img → svg>image | img without width/height attributes and not a foreignObject child; per-image failure fallback | Async |
| `svgCC.img2svg(tree)` | img → svg background | img with src and no children; per-image failure fallback | Async |

Common conversion rules: fo/img attribute merging (child overrides parent) → whitelist filtering (`class/id/name/label/pointer-events/transform/opacity` + `data-*`) → style merging with `width` declarations removed → positioning inheritance (x/y default 0, width/height default 100%).

### 5.3 Feature Layer Scoring (svgLD)

| Function | Parameters | Returns | Description | Sync |
|----------|------------|---------|-------------|------|
| `svgLD.calcLayer(tree, number)` | tree: parsed/converted tree; number: how many top images to select | `{ imagesDetail, finalHtml }` | Five-dimension scoring → descending Top N → preload snippet generation → automatic cleanup of temporary attributes; zero side effects | Sync |

Each entry of `imagesDetail` contains: `url` (image URL), `layer` (total score), `globalOrder` (document index), `totalBottomScore` (bottom-feature score), `totalTopScore` (top-feature score), `gfoScore` (sibling container order score), `animateScore` (width-animation order score), `globalScore` (global order score).

### 5.4 Utility Functions

| Module | Function | Description |
|--------|----------|-------------|
| svgCC | `filterPreservedAttrs(attrs)` | Whitelist + `data-*` attribute filtering |
| svgCC | `removeWidth(styleArr)` | Merges style arrays and strips width declarations (case-insensitive), returning valid CSS |
| svgCC | `getImageRatio(imageUrl)` | Loads the image through the proxy and returns its aspect ratio, Promise\<number\>, falls back to 1 on timeout/failure |
| svgCC | `traverseHtmlTree(node, callback, parentInfo, level)` | Depth-first traversal; returning true from the callback prunes the current branch; parentInfo carries the parent node and child index |
| svgLD | `parseStyle(styleStr)` | Parses a CSS string into a key-value object; a core dependency of calcLayer |

## 6. Notes

1. **Environment**: browser only (relies on DOM APIs such as DOMParser, XMLSerializer, TreeWalker); pure Node.js is not supported.
2. **Proxy**: only the two async converters `img2image` and `img2svg` require `proxy-image.php`; skip the PHP deployment if you don't use them.
3. **Error handling**: parse failures and image timeouts throw Errors, so use `try/catch` in your business code; the async converters already fall back per image.
4. **Code style**: output is normalized (camelCase naming, self-closing tags, quoting, whitespace); use with care if you need to preserve the original style.
5. **Preload snippet**: hidden via styles (height:0 + offscreen offset); simply prepend it to the article code. It does not affect layout.
6. **WeChat compliance**: WeChat articles only allow inline styles; id/class are stripped by the editor on upload, and `style`/`script` tags and any JavaScript are forbidden. Overlapping effects cannot use absolute/relative positioning and must rely on `height:0` collapsing, negative margins, transforms, and similar techniques. Both the scoring model and the generated code follow these constraints.

## 7. Open Source Info

- Version: V2
- License: [MIT License](LICENSE)
- Homepage: https://www.ifsvgtool.com/
- Live Demo: https://www.ifsvgtool.com/code-converter
- Repositories:
  - GitHub: https://github.com/qiruoKING/svg-code-convert
  - Gitee: https://gitee.com/forPage/svg-code-convert
- Copyright: Copyright (c) 2026 上海意符文化传媒有限公司
