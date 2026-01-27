/**
 * @file SVG代码转换工具
 * @version 1.0.0
 * @description 基于微信公众号平台规则和渲染特性，实现SVG交互图文 <svg> <img> <image> 三种格式相互转换
 * @author qiruo
 * @copyright Copyright (c) 2026 上海意符文化传媒有限公司
 * @license MIT License
 * @homepage https://www.ifsvgtool.com/
 * @demo https://www.ifsvgtool.com/code-converter
 * @repository https://github.com/qiruoKING/svg-code-convert
 *             https://gitee.com/forPage/svg-code-convert
 */

const svgCC = {

	// =================================================================
	// 通用工具函数
	// =================================================================

	// 属性白名单
	preservedAttrsList: ['class', 'id', 'name', 'label', 'pointer-events', 'transform', 'opacity'],

	/**
	 * 过滤并保留白名单属性及data-开头的自定义属性
	 * @param {object} attrs - 原始属性对象
	 * @returns {object} 过滤后的属性对象
	 */
	filterPreservedAttrs: function(attrs = {}) {
		const filtered = {};
		for (const [attrKey, attrValue] of Object.entries(attrs)) {
			if (this.preservedAttrsList.includes(attrKey) || attrKey.startsWith('data-')) {
				filtered[attrKey] = attrValue;
			}
		}
		return filtered;
	},

	/**
	 * 移除style中的width样式
	 * @param {string[]} styleArr - 样式字符串数组
	 * @returns {string} - 移除width后的合法样式字符串
	 */
	removeWidth: function(styleArr) {
		// 合并样式并过滤空字符串
		const combinedStyle = styleArr
			.filter(styleStr => styleStr.trim() !== '')
			.join(';');

		// 拆分样式声明，过滤掉width相关样式（不区分大小写，兼容多种写法）
		const cleanedStyleDeclarations = combinedStyle
			.split(';')
			.map(decl => decl.trim())
			.filter(decl => !/^width\s*:/i.test(decl));

		// 重新合并为合法style字符串
		return cleanedStyleDeclarations.join('; ').trim();
	},

	/**
	 * 获取公众号图片宽高比（width/height），支持跨域/防盗链（代理接口）
	 * @param {string} imageUrl - 原始公众号图片链接
	 * @returns {Promise<number>} - 宽高比，失败/超时兜底返回1
	 * @throws {Error} - 超时/加载失败（含跨域提示）
	 */
	getImageRatio: function(imageUrl) {
		return new Promise((resolve, reject) => {
			// 设置图片
			const img = document.createElement('img');
			img.style.position = 'absolute';
			img.style.visibility = 'hidden';
			img.style.width = 'auto';
			img.style.height = 'auto';
			img.style.opacity = 0;
			document.body.appendChild(img);

			// 设置超时定时器
			const timeoutTimer = setTimeout(() => {
				if (img.parentNode) {
					img.parentNode.removeChild(img);
				}
				reject(new Error('图片加载超时'));
			}, 5000);

			// 设置跨域/防盗链
			img.crossOrigin = 'anonymous';
			img.referrerPolicy = 'no-referrer';
			img.loading = 'eager';

			// 图片加载成功：返回宽高比
			img.onload = function() {
				clearTimeout(timeoutTimer); // 清除超时定时器
				let ratio = 1; // 默认比值1:1
				if (img.naturalWidth && img.naturalHeight) {
					ratio = img.naturalWidth / img.naturalHeight; // 计算原始宽高比
				}
				else {
					// 备用方案：固定宽度计算渲染比
					img.style.width = '100px';
					const renderWidth = img.offsetWidth;
					const renderHeight = img.offsetHeight;
					if (renderWidth && renderHeight) {
						ratio = renderWidth / renderHeight; // 计算渲染宽高比
					}
				}
				if (img.parentNode) {
					img.parentNode.removeChild(img); // 移除图片
				}
				resolve(ratio); // 返回宽高比
			};

			// 图片加载失败：返回错误
			img.onerror = function() {
				clearTimeout(timeoutTimer); // 清除超时定时器
				if (img.parentNode) {
					img.parentNode.removeChild(img); // 移除图片
				}
				reject(new Error('图片加载失败')); // 返回错误
			};

			const proxyUrl = `proxy-image.php?url=${encodeURIComponent(imageUrl)}`; // 公众号图片链接编码后传给代理接口
			img.src = proxyUrl; // 加载代理后的图片
		});
	},

	/**
	 * 深度优先遍历HTML/SVG树形结构
	 * @param {object} node - 当前节点
	 * @param {(node, parentInfo, level) => boolean} callback - 返回true终止当前节点的子节点遍历
	 * @param {{parentNode: object, childIndex: number} | null} [parentInfo=null] - 父节点信息
	 * @param {number} [level=0] - 遍历层级（根节点0）
	 */
	traverseHtmlTree: function(node, callback, parentInfo = null, level = 0) {
		// 终止条件：节点不存在或不是对象
		if (!node || typeof node !== 'object') return;

		// 执行回调：parentInfo结构 { parentNode: 父节点对象, childIndex: 子索引 }
		const stop = callback(node, parentInfo, level);
		if (stop) return;

		// 递归遍历子节点（children是数组）
		if (node.children && Array.isArray(node.children)) {
			node.children.forEach((childNode, index) => {
				// parentInfo传递 { parentNode: 当前node（真正的父节点）, childIndex: 子索引 }
				this.traverseHtmlTree(
					childNode, 
					callback, 
					{ parentNode: node, childIndex: index },
					level + 1
				);
			});
		}
	},

	// =================================================================
	// 节点转换处理函数
	// =================================================================

    /**
     * fo>svg → image
     * @param {object} tree - HTML/SVG树形结构
     * @returns {object} 转换后树形结构
     */
	fosvg2image: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到fo节点
			if (node.tag === 'foreignObject') {
				// fo的子节点是svg + svg有background链接 + svg无内容 + 父节点有效
				const svgChild = node.children.find(child => child.tag === 'svg');
				if (svgChild && svgChild.attrs?.['iftool-background'] && svgChild.children.length === 0 && parentInfo?.parentNode?.children) {

					// 合并fo和svg属性对象 (同名属性svg覆盖fo)
					const mergedRawAttrs = { 
						...node.attrs, 
						...svgChild.attrs 
					};
					const preservedAttrs = this.filterPreservedAttrs(mergedRawAttrs); // 白名单属性过滤
					
					// 合并fo和svg样式数组
					const styleArr = [
						node.attrs.style || '',
						svgChild.attrs.style || ''
					];
					const imageStyle = this.removeWidth(styleArr); // 样式数组转为移除width后的样式字符串

					// 设置image上的定位属性
					const imageX = node.attrs.x || '0';
					const imageY = node.attrs.y || '0';
					const imageWidth = node.attrs.width || '100%';
					const imageHeight = node.attrs.height || '100%';

					// 构建image节点
					const imageNode = {
						tag: 'image',
						attrs: {
							...preservedAttrs,
							'iftool-href': svgChild.attrs['iftool-background'] || (svgChild.attrs.style.match(/url\((.*?)\)/) || [])[1] || '',
							x: imageX,
							y: imageY,
							width: imageWidth,
							height: imageHeight,
							style: imageStyle
						},
						children: []
					};

					parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, imageNode); // 将fo>svg节点整体替换为image节点
					return true;
				}
			}
		});
	},

    /**
     * svg → svg>image
     * @param {object} tree - HTML/SVG树形结构
     * @returns {object} 转换后树形结构
     */
	svg2image: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到svg节点
			if (node.tag === 'svg') {
				// svg内无特殊height动画（禁用by写法的缩回展开效果，这个效果必须用svg实现不能转为image，其他效果不受影响）
				if (node.children.some(n => n.tag === 'animate' && n.attrs?.attributeName === 'height' && n.attrs?.by === '-1')) {
					return;
				}
				// svg的父节点不是fo（仅转换最外层svg） + svg有background链接 + 父节点有效
				const parentIsNotFo = parentInfo?.parentNode?.tag !== 'foreignObject';
				if (parentIsNotFo && node.attrs?.['iftool-background'] && parentInfo?.parentNode?.children) {

					// 提取svg上的viewbox属性作为之后image的宽高属性
					const parts = node.attrs.viewBox ? node.attrs.viewBox.split(/\s+/).filter(Boolean) : [];
					const imageWidth = parts.length >= 4 ? parts[2] : '100%';
					const imageHeight = parts.length >= 4 ? parts[3] : '100%';

					// 将svg上的style（不变）移除transform和opacity后继承给image使用
					let imageStyle = node.attrs.style || '';
					imageStyle = imageStyle.replace(/\s*(transform|opacity)\s*:[^;]*;?\s*/g, '').trim();

					// 构建image节点
					const imageNode = {
						tag: 'image',
						attrs: {
							'iftool-href': node.attrs['iftool-background'] || (node.attrs.style.match(/url\((.*?)\)/) || [])[1] || '',
							x: '0',
							y: '0',
							width: imageWidth,
							height: imageHeight,
							style: imageStyle
						},
						children: []
					};

					node.children.unshift(imageNode); // 将image节点插入svg节点内部
					delete node.attrs['iftool-background']; // 删除svg上的background链接
					return true;
				}
			}
		});
	},

    /**
     * svg → img
     * @param {object} tree - HTML/SVG树形结构
     * @returns {object} 转换后树形结构
     */
	svg2img: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到svg节点 + svg内容为空 + svg有background链接 + svg父节点有效
			if (node.tag === 'svg' && node.children.length === 0 && node.attrs?.['iftool-background'] && parentInfo?.parentNode?.children) {
				const preservedAttrs = this.filterPreservedAttrs(node.attrs); // 白名单属性过滤

				// 构建img节点
				const imgNode = {
					tag: 'img',
					attrs: {
						...preservedAttrs,
						'iftool-src': node.attrs['iftool-background'],
						style: node.attrs.style || ''
					},
					children: []
				};
				
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, imgNode); // 将svg节点替换为img节点
				return true;
			}
		});
		return tree;
	},

    /**
     * image → g>fo>img
     * @param {object} tree - HTML/SVG树形结构
     * @returns {object} 转换后树形结构
     */
	image2img: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到image + 内容为空 + 有iftool-src属性 + 父节点有效
			if (node.tag === 'image' && node.children.length === 0 && node.attrs?.['iftool-href'] && parentInfo?.parentNode?.children) {
				const preservedAttrs = this.filterPreservedAttrs(node.attrs); // 白名单属性过滤

				// 提取image的定位属性作为之后fo的定位属性
				const imageX = node.attrs.x || '0';
				const imageY = node.attrs.y || '0';
				const imageWidth = node.attrs.width || '100%';
				const imageHeight = node.attrs.height || '100%';
				
				// 构建g>fo>img节点
				const gNode = {
					tag: 'g',
					attrs: {},
					children: [
						{
							tag: 'foreignObject',
							attrs: {
								x: imageX,
								y: imageY,
								width: imageWidth,
								height: imageHeight
							},
							children: [
								{
									tag: 'img',
									attrs: {
										...preservedAttrs,
										'iftool-src': node.attrs['iftool-href'],
										style: node.attrs.style || ''
									},
									children: []
								}
							]
						}
					]
				};
				
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, gNode); // 将image节点替换为g>fo>img节点
				return true;
			}
		});
		return tree;
	},

    /**
     * image → g>fo>svg
     * @param {object} tree - HTML/SVG树形结构
     * @returns {object} 转换后树形结构
     */
	image2svg: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到image + 内容为空 + 有iftool-href属性 + 父节点有效
			if (node.tag === 'image' && node.children.length === 0 && node.attrs?.['iftool-href'] && parentInfo?.parentNode?.children) {
				const preservedAttrs = this.filterPreservedAttrs(node.attrs); // 白名单属性过滤

				// 提取image的定位属性作为之后fo的定位属性和svg的viewbox
				const imageX = node.attrs.x || '0';
				const imageY = node.attrs.y || '0';
				const imageWidth = node.attrs.width || '100%';
				const imageHeight = node.attrs.height || '100%';

				// 构建g>fo>svg节点
				const gNode = {
					tag: 'g',
					attrs: {},
					children: [
						{
							tag: 'foreignObject',
							attrs: {
								x: imageX,
								y: imageY,
								width: imageWidth,
								height: imageHeight
							},
							children: [
								{
									tag: 'svg',
									attrs: {
										...preservedAttrs,
										viewBox: `0 0 ${imageWidth} ${imageHeight}`,
										style: node.attrs.style || '',
										'iftool-background': node.attrs['iftool-href']
									},
									children: []
								}
							]
						}
					]
				};

				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, gNode); // 将image节点替换为g>fo>svg节点
				return true;
			}
		});
		return tree;
	},

	/**
	 * fo>img → image
	 * @param {object} tree - HTML/SVG树形结构
	 * @returns {object} 转换后树形结构
	 */
	foimg2image: function(tree) {
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到fo节点 + 父节点有效
			if (node.tag === 'foreignObject' && parentInfo?.parentNode?.children) {
				// fo的子元素是img + img有src属性 + img内容为空
				const imgChild = node.children.find(child => child.tag === 'img');
				if (imgChild && imgChild.attrs?.['iftool-src'] && imgChild.children.length === 0) {

					// 合并fo和img属性对象 (同名属性img覆盖fo)
					const mergedRawAttrs = { 
						...node.attrs, 
						...imgChild.attrs 
					};
					const preservedAttrs = this.filterPreservedAttrs(mergedRawAttrs); // 白名单属性过滤

					// 合并fo和img样式数组
					const styleArr = [
						node.attrs.style || '',
						imgChild.attrs.style || ''
					];
					const imageStyle = this.removeWidth(styleArr); // 样式数组转为移除width后的样式字符串

					// 提取fo的定位属性作为之后image的定位属性
					const imageX = node.attrs.x || '0';
					const imageY = node.attrs.y || '0';
					const imageWidth = node.attrs.width || '100%';
					const imageHeight = node.attrs.height || '100%';

					// 构建image节点
					const imageNode = {
						tag: 'image',
						attrs: {
							...preservedAttrs,
							'iftool-href': imgChild.attrs['iftool-src'],
							x: imageX,
							y: imageY,
							width: imageWidth,
							height: imageHeight,
							style: imageStyle
						},
						children: []
					};

					parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, imageNode); // 将fo>img节点整体替换为image节点
					return true;
				}
			}
		});
		return tree;
	},

    /**
     * img → svg>image
     * @param {object} tree - HTML/SVG树形结构
     * @returns {Promise<object>} 转换后树形结构
     */
	img2image: async function(tree) {
		const self = this;
		const targetImgs = [];
		
		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			if (node.tag === 'img' && node.attrs?.['iftool-src'] && parentInfo?.parentNode?.children) {
				const parentIsFo = parentInfo?.parentNode?.tag === 'foreignObject';
				const hasNoSize = !node.attrs.width && !node.attrs.height;
				if (!parentIsFo && hasNoSize) {
					targetImgs.push({ node, parentInfo });
				}
			}
		});

		// 对收集到的目标节点批量异步处理
		for (const item of targetImgs) {
			const { node, parentInfo } = item;
			const preservedAttrs = this.filterPreservedAttrs(node.attrs); // 白名单属性过滤

			try {
				// 获取图片宽高比，计算固定宽度下的高度
				const ratio = await self.getImageRatio(node.attrs['iftool-src']);
				const imgWidth = 1080;
				const imgHeight = Math.round(imgWidth / ratio);

				// 构建svg>image节点
				const imageNode = {
					tag: 'svg',
					attrs: {
						viewBox: `0 0 ${imgWidth} ${imgHeight}`,
						style: 'display: block; pointer-events: painted; width: 100%;'
					},
					children: [
						{
							tag: 'image',
							attrs: {
								...preservedAttrs,
								'iftool-href': node.attrs['iftool-src'],
								x: '0',
								y: '0',
								width: imgWidth,
								height: imgHeight,
								style: node.attrs.style || ''
							},
							children: []
						}
					]
				};
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, imageNode); // 将img节点替换为svg>image节点
			} catch (err) {
				// 异步出错兜底逻辑：构建svg>image默认节点
				const defaultNode = {
					tag: 'svg',
					attrs: { viewBox: '0 0 100% 100%', style: 'display: block; width: 100%;' },
					children: [{ 
						tag: 'image', 
						attrs: { 
							...preservedAttrs,
							'iftool-href': node.attrs['iftool-src'], 
							x: '0', 
							y: '0', 
							width: '100%', 
							height: '100%' 
						}, 
						children: [] 
					}]
				};
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, defaultNode); // 将img节点替换为svg>image默认节点
			}
		}
		return tree;
	},

    /**
     * img → svg
     * @param {object} tree - HTML/SVG树形结构
     * @returns {Promise<object>} 转换后树形结构
     */
	img2svg: async function(tree) {
		const self = this;
		const targetImgs = [];

		// 遍历收集目标节点
		this.traverseHtmlTree(tree, (node, parentInfo) => {
			// 找到img节点 + img内容为空 + img有src属性 + 父节点有效
			if (node.tag === 'img' && node.children.length === 0 && node.attrs?.['iftool-src'] && parentInfo?.parentNode?.children) {
				targetImgs.push({ node, parentInfo });
			}
		});

		// 对收集到的目标节点批量异步处理
		for (const item of targetImgs) {
			const { node, parentInfo } = item;
			const preservedAttrs = this.filterPreservedAttrs(node.attrs); // 白名单属性过滤

			try {
				// 获取图片宽高比，计算固定宽度下的高度
				const ratio = await self.getImageRatio(node.attrs['iftool-src']);
				const imgWidth = 1080;
				const imgHeight = Math.round(imgWidth / ratio);

				// 构建svg节点
				const svgNode = {
					tag: 'svg',
					attrs: {
						...preservedAttrs,
						viewBox: `0 0 ${imgWidth} ${imgHeight}`,
						style: node.attrs.style || '',
						'iftool-background': node.attrs['iftool-src']
					},
					children: []
				};
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, svgNode); // 将img节点替换为svg节点
			} catch (err) {
				// 异步出错兜底逻辑：构建svg默认节点
				const defaultSvgNode = {
					tag: 'svg',
					attrs: {
						...preservedAttrs,
						viewBox: '0 0 100% 100%',
						style: node.attrs.style || '',
						'iftool-background': node.attrs['iftool-src']
					},
					children: []
				};
				parentInfo.parentNode.children.splice(parentInfo.childIndex, 1, defaultSvgNode); // 将img节点替换为svg默认节点
			}
		}
		return tree;
	},

	// =================================================================
	// 拆分流程函数
	// =================================================================

    /**
     * 解析SVG/HTML代码为树形结构
     * @param {string} code - 原始代码
     * @returns {object} 树形结构
     * @throws {Error} XML解析失败（含详情）
     */
	parse: function(code) {
		const preprocessedCode = this.preprocess(code);
		const parser = new DOMParser();
		const doc = parser.parseFromString(preprocessedCode, 'image/svg+xml');
		const parseError = doc.querySelector('parsererror');
		if (parseError) {
			const errorDetails = parseError.textContent || parseError.innerText;
			throw new Error(`XML解析失败。原因: ${errorDetails}`);
		}
		this.extractAssets(doc.documentElement);
		return this.domToObject(doc.documentElement);
	},

    /**
     * 预处理原始代码（补全标签/清理冗余/转义/规范格式）
     * @param {string} code - 原始代码
     * @returns {string} 预处理后代码
     */
	preprocess: function(code) {

		/**
		 * 预处理1：利用浏览器DOM自动修复标签结构
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 修复后的HTML字符串
		 */
		const fixStructure = (html) => {
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = html;
			return tempDiv.innerHTML;
		};

		/**
		 * 预处理2：移除图片懒加载data-src/data-lazy-bgimg属性
		 * @param {string} html - 包含懒加载属性的HTML字符串
		 * @returns {string} 清理后的HTML字符串
		 */
		const removeLazyAttrs = (html) => {
			// 移除img上的data-src属性（某些公众号音视频组件会用data-src设置封面图）
			const imgDataSrcRegex = /(<img\s[^>]*>)/gi;
			const dataSrcAttrRegex = /(?:\s|^)data-src(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;
			let processedHtml = html.replace(imgDataSrcRegex, (imgTag) => {
				return imgTag.replace(dataSrcAttrRegex, '');
			});

			// 移除所有的data-lazy-bgimg属性
			const dataLazyBgimgRegex = /(?:\s|^)data-lazy-bgimg(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;
			processedHtml = processedHtml.replace(dataLazyBgimgRegex, '');
			return processedHtml;
		};

		/**
		 * 预处理3：移除微信背景占位wx_imgbc_placeholder类
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 移除占位类后的HTML字符串
		 */
		const removePlaceholder = (html) => {
			const wxImgPlaceholderRegex = /(?:\s|^)class\s*=\s*(["'])(?:.*?\s)?wx_imgbc_placeholder(?:\s.*?)?\1/gi;
			return html.replace(wxImgPlaceholderRegex, (match, quote) => {
				const classContent = match.match(new RegExp(`class\\s*=\\s*${quote}(.*?)${quote}`, 'i'))[1];
				const cleanedClass = classContent
					.split(/\s+/)
					.filter(cls => cls.trim() !== 'wx_imgbc_placeholder')
					.join(' ')
					.trim();
				return cleanedClass ? ` class=${quote}${cleanedClass}${quote}` : '';
			});
		};

		/**
		 * 预处理4：转义非合法实体的裸&符号
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 转义后的HTML字符串
		 */
		const escapeAmpersands = (html) => {
			const validEntities = 'amp|lt|gt|quot|nbsp|copy|yen|euro|deg|times|permil';
			return html.replace(
				new RegExp(`&(?!(${validEntities});)`, 'g'),
				'&amp;'
			);
		};
		
		/**
		 * 预处理5：统一url()中的引号格式为单引号并清理空格
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 规范化后的HTML字符串
		 */
		const unifyQuotes = (html) => {
			const urlRegex = /url\(\s*(?:"|&quot;)(.*?)(?:"|&quot;)\s*\)/gi;
			return html.replace(urlRegex, (_, val) => `url('${val.trim()}')`);
		};

		/**
		 * 预处理6：将空元素标签修复为自闭合格式
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 修复后的HTML字符串
		 */
		const fixVoidTags = (html) => {
			const voidTags = ['img', 'br', 'input', 'hr']; // 会出问题的空元素标签
			const voidTagRegex = new RegExp(`<(${voidTags.join('|')})(\\s+[^>]*?)?>`, 'gi'); // 匹配开始标签

			return html.replace(voidTagRegex, (match, tagName, attrs = '') => {
				// 检查是否已经是自闭合标签
				if (match.endsWith('/>')) {
					return match;
				}
				// 检查是否是没有内容的空元素标签
				const isSelfClosing = !match.includes('</') && voidTags.includes(tagName.toLowerCase());
				if (isSelfClosing) {
					// 转换为自闭合格式
					const attrsPart = attrs ? attrs.replace(/\s*\/?$/, '') : '';
					return `<${tagName}${attrsPart}/>`;
				}
				return match;
			});
		};

		/**
		 * 预处理7：清理空行、缩进及特殊空格实体
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 压缩后的HTML字符串
		 */
		const compressWhitespace = (html) => {
			const preTagRegex = /<(pre|code|textarea)[\s\S]*?<\/\1>/gi;
			const preMap = new Map();
			let preIndex = 0;

			// 替换预格式化标签内容为占位符
			const htmlWithPlaceholders = html.replace(preTagRegex, (match) => {
				const key = `__PRE_PLACEHOLDER_${preIndex}__`;
				preMap.set(key, match);
				preIndex++;
				return key;
			});

			// 处理非预格式化区域的空白
			let processedHtml = htmlWithPlaceholders
				.replace(/[\n\r]+/g, ' ') 				// 清除空行
				.replace(/\t+/g, ' ')					// 清除制表符缩进
				.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')	// 特殊空格转普通空格
				.replace(/\s+/g, ' ')					// 合并所有连续空格为单个
				.replace(/>\s+</g, '><')				// 移除标签之间的空格
				.trim();								// 首尾去空格

			// 还原预格式化标签内容
			preMap.forEach((originalContent, placeholder) => {
				processedHtml = processedHtml.replace(placeholder, originalContent);
			});
			return processedHtml;
		};

		/**
		 * 预处理8：将标签名和属性名规范化为驼峰命名
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 大小写规范化后的HTML字符串
		 */
		const fixCase = (html) => {
			// 标签名驼峰化
			const tagNameMap = {
				animatetransform: 'animateTransform',
				animatemotion: 'animateMotion',
				foreignobject: 'foreignObject'
			};
			const normalizeTags = (str) => {
				const tagRegex = /<(\/?)(animatetransform|animatemotion|foreignobject)(?=\s|\/|>)/gi;
				return str.replace(tagRegex, (_, slash, tag) => `<${slash}${tagNameMap[tag.toLowerCase()]}`);
			};

			// 属性名驼峰化
			const attrNameMap = {
				viewbox: 'viewBox',
				calcmode: 'calcMode',
				attributename: 'attributeName',
				attributetype: 'attributeType',
				keytimes: 'keyTimes',
				keysplines: 'keySplines',
				repeatcount: 'repeatCount',
				repeatdur: 'repeatDur'
			};
			const normalizeAttrs = (str) => {
				const attrKeys = Object.keys(attrNameMap).join('|');
				const attrRegex = new RegExp(`([\\s>])(${attrKeys})=`, 'gi');
				return str.replace(attrRegex, (_, prefix, attr) => `${prefix}${attrNameMap[attr.toLowerCase()]}=`);
			};
			return normalizeAttrs(normalizeTags(html));
		};

		/**
		 * 预处理9：包裹div以确保单根节点
		 * @param {string} html - 原始HTML字符串
		 * @returns {string} 包裹后的HTML字符串
		 */
		const wrapRoot = (html) => `<div id="iftool">${html}</div>`;

		// 按顺序执行所有预处理步骤（先语法修复，后内容清理）
		return [
			fixStructure,
			removeLazyAttrs,
			removePlaceholder,
			escapeAmpersands,
			unifyQuotes,
			fixVoidTags,
			compressWhitespace,
			fixCase,
			wrapRoot
		].reduce((processedHtml, processStep) => {
			return processStep(processedHtml);
		}, code);
	},

    /**
     * 提取资源（image/img链接、background相关样式）迁移到自定义属性，移除原属性
     * @param {HTMLElement} rootNode - 根DOM节点
     */
	extractAssets: function(rootNode) {
		const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT);
		let node;
		while (node = walker.nextNode()) {
			// 提取image上的href图片链接，设置为iftool-href
			if (node.tagName.toLowerCase() === 'image' && node.hasAttribute('href')) {
				node.setAttribute('iftool-href', node.getAttribute('href'));
				node.removeAttribute('href');
			}
			// 提取img上的src图片链接，设置为iftool-src
			if (node.tagName.toLowerCase() === 'img' && node.hasAttribute('src')) {
				node.setAttribute('iftool-src', node.getAttribute('src'));
				node.removeAttribute('src');
			}
			// 处理style中的背景相关样式
			if (node.hasAttribute('style')) {
				const originalStyle = node.getAttribute('style');
				const { bgProps, cleanedStyle } = this.processStyle(originalStyle);
				if (bgProps.url) {
					node.setAttribute('iftool-background', bgProps.url);
					node.setAttribute('iftool-bg-color', bgProps.color);
					node.setAttribute('iftool-bg-position', bgProps.position);
					node.setAttribute('iftool-bg-size', bgProps.size);
					node.setAttribute('iftool-bg-repeat', bgProps.repeat);
					node.setAttribute('iftool-bg-attachment', bgProps.attachment);
					node.setAttribute('iftool-bg-origin', bgProps.origin);
					node.setAttribute('iftool-bg-clip', bgProps.clip);
				}
				if (cleanedStyle) {
					node.setAttribute('style', cleanedStyle);
				} else {
					node.removeAttribute('style');
				}
			}
		}
	},

    /**
     * 提取并清理样式中的背景属性
     * @param {string} styleString - 原始样式
     * @returns {{bgProps: object, cleanedStyle: string}} 背景属性+清理后样式
     */
	processStyle: function(styleString) {
		// 创建临时元素利用浏览器解析 CSS
		const tempDiv = document.createElement('div');
		tempDiv.style.cssText = styleString;

		// 获取style中的背景相关样式（如果为空字符串，说明用户未设置）
		const bgProps = {
			url: '',
			color: tempDiv.style.backgroundColor,
			position: tempDiv.style.backgroundPosition,
			size: tempDiv.style.backgroundSize,
			repeat: tempDiv.style.backgroundRepeat,
			attachment: tempDiv.style.backgroundAttachment,
			origin: tempDiv.style.backgroundOrigin,
			clip: tempDiv.style.backgroundClip
		};

		// 提取背景图片链接
		const bgImage = tempDiv.style.backgroundImage;
		if (bgImage && bgImage !== 'none') {
			const urlMatch = bgImage.match(/url\(\s*['"]?(.*?)['"]?\s*\)/);
			if (urlMatch) bgProps.url = urlMatch[1];
		}
		
		// 清理原有的背景相关样式
		const cleanedStyle = styleString
			.split(';')
			.map(decl => decl.trim())
			.filter(decl => decl && !/^background(-image|-position|-size|-repeat|-attachment|-origin|-clip|-color)?\s*:/i.test(decl))
			.join('; ');
		return { bgProps, cleanedStyle };
	},

    /**
     * DOM节点转树形对象
     * @param {Node} node - DOM节点
     * @returns {object|null} 树形对象
     */
	domToObject: function(node) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			const obj = { tag: node.tagName, attrs: {}, children: [] };
			for (const attr of node.attributes) {
				obj.attrs[attr.name] = attr.value;
			}
			for (const child of node.childNodes) {
				const childObj = this.domToObject(child);
				if (childObj) { obj.children.push(childObj); }
			}
			return obj; // 标签节点
		} else if (node.nodeType === Node.TEXT_NODE) {
			const text = node.textContent.trim();
			return text ? { tag: 'wenben', attrs: text, children: [] } : null; // 文本节点
		} else if (node.nodeType === Node.COMMENT_NODE) {
			return { tag: 'zhushi', attrs: node.nodeValue.trim(), children: [] }; // 注释节点
		}
		return null;
	},

	// =================================================================
	// 组合流程函数
	// =================================================================

	/**
	 * 树形结构转回标准SVG/HTML代码（还原自定义属性到原生属性）
	 * @param {object} tree - 树形结构
	 * @returns {string} 标准代码
	 */
	compose: function(tree) {
		// 创建XML文档环境，维持大小写敏感
		const xmlDoc = document.implementation.createDocument(null, null, null);
		const dom = this.objectToDom(xmlDoc, tree);
		let xmlString = new XMLSerializer().serializeToString(dom); // 将DOM序列化为字符串

		xmlString = xmlString.replace(/^(<[^\s>]+)([^>]*?)\s+xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/,'$1$2'); // 移除根节点上的xmlns命名空间
		xmlString = xmlString.match(/<div id="iftool">(.*?)<\/div>/s)[1]; // 移除预处理时包裹的div#iftool容器
		xmlString = xmlString.replace(/&amp;/g, '&'); // 将&amp;还原为& 

		// 修复在微信公众号中强制要求显式闭合的标签
		const tagsToFix = [
			'section', 'p', 'div', 'svg', 'iframe', 'video',
			'mp-common-clmusic', 'mp-common-redpacket', 'mp-common-profile',
			'mp-common-videosnap', 'mp-common-mpaudio', 'mp-common-poi',
			'mp-common-miniprogram', 'mp-common-vote'
		].join('|');
		xmlString = xmlString.replace(new RegExp(`(<(${tagsToFix})\\s+[^>]*?)\/>`, 'gi'),'$1></$2>');

		return xmlString;
	},
	
    /**
     * 树形对象转DOM节点（还原自定义属性）
     * @param {Document} doc - XML文档
     * @param {object} obj - 树形结构
     * @returns {Node|null} DOM节点
     */
	objectToDom: function(doc, obj) {
		if (!obj) return null;
		if (obj.tag === 'wenben') return doc.createTextNode(obj.attrs);
		if (obj.tag === 'zhushi') return doc.createComment(obj.attrs);
		
		// 从临时属性中获取所有资源
		const tempAssets = {
			backgroundUrl: obj.attrs['iftool-background'],
			href: obj.attrs['iftool-href'],
			srcUrl: obj.attrs['iftool-src'],
			bgColor: obj.attrs['iftool-bg-color'],
			bgPosition: obj.attrs['iftool-bg-position'],
			bgSize: obj.attrs['iftool-bg-size'],
			bgRepeat: obj.attrs['iftool-bg-repeat'],
			bgAttachment: obj.attrs['iftool-bg-attachment'],
			bgOrigin: obj.attrs['iftool-bg-origin'],
			bgClip: obj.attrs['iftool-bg-clip']
		};
		
		// 创建一个最终的属性对象副本，移除所有临时属性
		const finalAttrs = { ...obj.attrs };
		delete finalAttrs['iftool-background'];
		delete finalAttrs['iftool-href'];
		delete finalAttrs['iftool-src'];
		delete finalAttrs['iftool-bg-color'];
		delete finalAttrs['iftool-bg-position'];
		delete finalAttrs['iftool-bg-size'];
		delete finalAttrs['iftool-bg-repeat'];
		delete finalAttrs['iftool-bg-attachment'];
		delete finalAttrs['iftool-bg-origin'];
		delete finalAttrs['iftool-bg-clip'];

		// 如果有background链接，构建简写写法
		if (tempAssets.backgroundUrl) {
			// 获取各个背景相关样式或使用默认值
			const c = tempAssets.bgColor || 'transparent';
			const p = tempAssets.bgPosition || '0% 0%';
			const s = tempAssets.bgSize || 'auto auto';
			const r = tempAssets.bgRepeat || 'repeat';
			const a = tempAssets.bgAttachment || 'scroll';
			const o = tempAssets.bgOrigin || 'padding-box';
			const l = tempAssets.bgClip || 'border-box';

			let posSizeStr = p;
			if (s && s !== 'auto' && s !== 'auto auto') {
				posSizeStr += ` / ${s}`; // 如果bg-size不是默认值，则在简写方案中带上斜杠
			}
			const newBackgroundStyle = `background: ${c} url(${tempAssets.backgroundUrl}) ${posSizeStr} ${r} ${a} ${o} ${l}`; // 简写方案
			const existingStyle = finalAttrs.style || '';
			finalAttrs.style = existingStyle ? `${existingStyle}; ${newBackgroundStyle}` : newBackgroundStyle;
		}

		// 如果有href或src链接，直接设置链接
		if (tempAssets.href) {
			finalAttrs.href = tempAssets.href;
		}
		if (tempAssets.srcUrl) {
			finalAttrs.src = tempAssets.srcUrl;
		}

		// 创建元素并应用最终的属性对象副本
		const element = doc.createElement(obj.tag);
		for (const attr in finalAttrs) {
			element.setAttribute(attr, finalAttrs[attr]);
		}
		
		// 递归处理并添加子节点
		if (obj.children) {
			for (const child of obj.children) {
				const childNode = this.objectToDom(doc, child);
				if (childNode) {
					element.appendChild(childNode);
				}
			}
		}
		return element;
	}
};
