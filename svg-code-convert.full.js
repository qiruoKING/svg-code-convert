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
	 * @returns {string} 移除width后的合法样式字符串
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
	 * 获取公众号图片宽高比（width/height），支持跨域/防盗链（需配置代理接口）
	 * @param {string} imageUrl - 原始公众号图片链接
	 * @returns {Promise<number>} 宽高比，失败/超时兜底返回1
	 * @throws {Error} 图片加载超时/加载失败（含跨域提示）
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
				clearTimeout(timeoutTimer);
				let ratio = 1; // 默认比值1:1
				if (img.naturalWidth && img.naturalHeight) {
					ratio = img.naturalWidth / img.naturalHeight; // 原始宽高比
				}
				else {
					// 备用方案：固定宽度计算渲染比
					img.style.width = '100px';
					const renderWidth = img.offsetWidth;
					const renderHeight = img.offsetHeight;
					if (renderWidth && renderHeight) {
						ratio = renderWidth / renderHeight; // 渲染宽高比
					}
				}
				if (img.parentNode) {
					img.parentNode.removeChild(img);
				}
				resolve(ratio);
			};

			// 图片加载失败：返回错误
			img.onerror = function() {
				clearTimeout(timeoutTimer);
				if (img.parentNode) {
					img.parentNode.removeChild(img);
				}
				reject(new Error('图片加载失败'));
			};

			const proxyUrl = `proxy-image.php?url=${encodeURIComponent(imageUrl)}`; // 公众号图片链接编码后传给代理接口
			img.src = proxyUrl; // 加载代理后的图片
		});
	},

	/**
	 * 深度优先遍历HTML/SVG树形结构
	 * @param {object} node - 当前遍历的树形节点对象
	 * @param {(node: object, parentInfo: object|null, level: number) => boolean} callback - 遍历回调函数，返回true终止当前节点的子节点遍历
	 * @param {object|null} [parentInfo=null] - 父节点信息，结构 { parentNode: object, childIndex: number }
	 * @param {number} [level=0] - 遍历层级，根节点为0
	 * @returns {void}
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
	 * 解析SVG/HTML代码为树形结构（预处理→XML解析→提取资源→DOM转对象）
	 * @param {string} code - 原始SVG/HTML代码字符串
	 * @returns {object} 解析后的树形结构
	 * @throws {Error} XML解析失败，包含具体错误详情
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
	 * 预处理原始SVG/HTML代码（修复结构/清理冗余/转义/规范格式）
	 * @param {string} code - 原始SVG/HTML代码字符串
	 * @returns {string} 预处理后的标准代码字符串
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
	 * 提取DOM节点中的资源链接，迁移到自定义属性并移除原生属性
	 * @param {HTMLElement} rootNode - SVG/HTML根DOM节点
	 * @returns {void}
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
	 * 提取样式字符串中的背景属性，清理原样式中的背景相关声明
	 * @param {string} styleString - 原始CSS样式字符串
	 * @returns {{bgProps: object, cleanedStyle: string}} 背景属性对象+清理后样式字符串
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
	 * 将DOM节点递归转换为自定义树形对象结构
	 * @param {Node} node - 待转换的DOM节点（元素/文本/注释）
	 * @returns {object|null} 转换后的树形对象，非有效节点返回null
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
	 * 将自定义树形结构转回标准SVG/HTML代码（还原自定义属性到原生属性）
	 * @param {object} tree - 解析后的自定义树形结构
	 * @returns {string} 标准SVG/HTML代码字符串
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
	 * 将自定义树形对象递归转换为DOM节点（还原自定义资源属性）
	 * @param {Document} doc - XML文档对象
	 * @param {object} obj - 待转换的自定义树形对象
	 * @returns {Node|null} 转换后的DOM节点，非有效对象返回null
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
	},

	// =================================================================
	// 特征层级分计算函数
	// =================================================================

	/**
	 * 解析CSS样式字符串为键值对对象
	 * @param {string} [styleStr] - 待解析的CSS样式字符串，可选
	 * @returns {Object} 解析后的CSS样式键值对对象
	 */
	parseStyle: function(styleStr) {
		const styleObj = {};
		if (!styleStr) return styleObj;
		styleStr.split(';').forEach(item => {
			const [key, value] = item.trim().split(':').map(v => v.trim());
			if (key && value) styleObj[key] = value;
		});
		return styleObj;
	},

	/**
	 * 计算SVG中所有图片的特征层级分，筛选最高层级图片并生成预加载HTML
	 * @param {object} tree - 解析后的SVG树形结构
	 * @param {number} number - 需要筛选的最高层级图片数量
	 * @returns {object} 层级计算结果，含明细和预加载HTML
	 */
	calcLayer: function(tree, number) {

		/**
		 * SVG容器判断：是否为合法的并列容器（svg/g/foreignObject）
		 * @param {object} node - 树形结构中的节点对象
		 * @returns {boolean} 是合法容器返回true，否则返回false
		 */
		const isSvgValidContainer = (node) => {
			if (!node || !node.tag) return false;
			const tag = node.tag.toLowerCase();
			return ['svg', 'g', 'foreignObject'].includes(tag);
		};

		/**
		 * SVG容器查找：从父节点链中由近到远找最近的合法SVG容器
		 * @param {object[]} parentChain - 图片节点的所有祖先节点链数组
		 * @returns {object|undefined} 找到的最近合法容器节点，无则返回undefined
		 */
		const findNearestSvgContainer = (parentChain) => {
			return [...parentChain].reverse().find(isSvgValidContainer);
		};

		/**
		 * 透明度判断：数值在0-0.05范围内视为真透明
		 * @param {string|number} opacityValue - 透明度值（字符串/数字类型）
		 * @returns {boolean} 符合真透明范围返回true，否则返回false
		 */
		const isOpacityMinValue = (opacityValue) => {
			const opacityNum = parseFloat(opacityValue);
			return !isNaN(opacityNum) && opacityNum >= 0 && opacityNum <= 0.05;
		};

		/**
		 * SVG宽度动画判断：svg直接子节点是否存在width属性的animate动画
		 * @param {object} svgNode - 树形结构中的SVG节点对象
		 * @returns {boolean} 存在width动画返回true，否则返回false
		 */
		const isSvgWidthAnimate = (svgNode) => {
			if (!svgNode || svgNode.tag?.toLowerCase() !== 'svg') return false;
			if (!svgNode.children) return false;
			for (const child of svgNode.children) {
				if (child.tag?.toLowerCase() === 'animate' && child.attrs) {
					const attrName = child.attrs.attributeName?.toLowerCase();
					if (attrName === 'width') {
						return true;
					}
				}
			}
			return false;
		};

		/**
		 * 底层特征减分计算：根据style和节点属性计算单一样式的底层减分值
		 * @param {string} styleStr - 待计算的CSS样式字符串
		 * @param {object} node - 对应的图片树形节点对象
		 * @returns {number} 计算后的底层特征总减分值
		 */
		const calculateBottomScore = (styleStr, node) => {
			let score = 0;
			const s = this.parseStyle(styleStr);
			// 底层特征1：style内height值为0
			if (s.height) {
				const heightStr = s.height.trim();
				const isZeroHeight = /^0(\s*px|\s*%|\s*rem|\s*em|\s*vh|\s*vw)?$/i.test(heightStr);
				const heightNum = parseFloat(heightStr);
				if (!isNaN(heightNum) && heightNum === 0 && isZeroHeight) {
					score -= 10;
				}
			}
			// 底层特征2：style内opacity真透明
			if (isOpacityMinValue(s.opacity)) score -= 2;
			// 底层特征3：属性opacity真透明
			if (isOpacityMinValue(node?.attrs?.opacity)) score -= 2;
			return score;
		};

		/**
		 * 顶层特征加分计算：根据style字符串计算单一样式的顶层加分值
		 * @param {string} styleStr - 待计算的CSS样式字符串
		 * @returns {number} 计算后的顶层特征总加分值
		 */
		const calculateTopScore = (styleStr) => {
			let score = 0;
			const s = this.parseStyle(styleStr);
			// 顶层特征1：style内margin-top为非0非px单位的负数
			if (s.marginTop) {
				const trimmedMargin = s.marginTop.trim();
				const negativeMarginReg = /^-([1-9]\d*(\.\d+)?|0\.\d+)(%|\s*rem|\s*em|\s*vh|\s*vw)$/i;
				if (negativeMarginReg.test(trimmedMargin)) score += 10;
			}
			// 顶层特征2：style内transform存在
			if (s.transform && s.transform !== 'none') score += 5;
			// 顶层特征3：style内isolation:isolate
			if (s.isolation === 'isolate') score += 3;
			// 顶层特征4：style内z-index>0
			if (s.zIndex) {
				const zIndexNum = Number(s.zIndex);
				if (!isNaN(zIndexNum) && zIndexNum > 0) score += 3;
			}
			return score;
		};

		// 初始化全局变量
		let globalOrder = 0; // 图片全局索引
		let svgUniqueId = 0; // width动画所在svg的临时id
		const widthSvgMap = new Map(); // 临时id与svg内部所有图片的映射
		const allImagesRaw = []; // 所有图片原始信息

		/**
		 * 第一次遍历收集：收集图片原始信息和宽度动画SVG与图片的映射关系
		 * @param {object} node - 当前遍历的树形节点对象
		 * @param {object[]} [parentChain=[]] - 当前节点的祖先节点链数组，默认空数组
		 * @param {object|null} [parentNode=null] - 当前节点的直接父节点对象，默认null
		 * @returns {void}
		 */
		const traverseCollect = (node, parentChain = [], parentNode = null) => {
			if (!node) return;
			// 提取图片链接
			const imgUrl = node.attrs?.['iftool-src'] || node.attrs?.['iftool-href'] || node.attrs?.['iftool-background'] || ''; 
			if (imgUrl) {
				// 收集图片原始信息
				const imgRaw = {
					url: imgUrl,
					node,
					parentChain,
					parentNode,
					globalOrder: globalOrder++,
					childIndex: parentNode ? parentNode.children.findIndex(c => c === node) : -1
				};
				allImagesRaw.push(imgRaw);

				// 收集width动画所在svg与图片的映射关系
				const svgNodes = [...parentChain, node].reverse().filter(item => item.tag?.toLowerCase() === 'svg');
				const targetAnimateSvg = svgNodes.find(isSvgWidthAnimate);
				if (targetAnimateSvg) {
					// 给width动画所在svg分配临时id
					if (!targetAnimateSvg.__widthSvgId__) targetAnimateSvg.__widthSvgId__ = ++svgUniqueId;
					const svgId = targetAnimateSvg.__widthSvgId__;
					// 找到的图片加入对应svg列表
					if (!widthSvgMap.has(svgId)) widthSvgMap.set(svgId, []);
					widthSvgMap.get(svgId).push(imgRaw);
				}
			}

			// 深度优先遍历子节点
			if (node.children) {
				node.children.forEach(child => traverseCollect(child, [...parentChain, node], node));
			}
		};

		traverseCollect(tree);
		widthSvgMap.forEach(imgList => imgList.sort((a, b) => a.globalOrder - b.globalOrder)); 

		// 第二次遍历：计算特征层级分
		const imagesDetail = allImagesRaw.map(imgRaw => {
			const { url, node, parentChain, parentNode, globalOrder, childIndex } = imgRaw;
			let layer = 20; // 初始特征层级分

			// 合并自身+所有父节点的style
			const nodeStyle = node.attrs?.style || '';
			const parentStyles = parentChain.map(p => p.attrs?.style || '');
			const allStyles = [nodeStyle, ...parentStyles];

			// 底层特征总减分
			const totalBottomScore = allStyles.reduce((sum, style) => sum + calculateBottomScore(style, node), 0);
			layer += totalBottomScore;

			// 顶层特征总加分
			const totalTopScore = allStyles.reduce((sum, style) => sum + calculateTopScore(style), 0);
			layer += totalTopScore;

			// 并列g/fo场景按顺序加调整分：第一个+0，每下一个+3
			let gfoScore = 0;
			const nearestContainer = findNearestSvgContainer(parentChain);
			if (nearestContainer) {
				const containerIndex = nearestContainer.parentNode?.children.findIndex(c => c === nearestContainer) || 0;
				gfoScore = containerIndex * 3;
			}
			layer += gfoScore;

			// width动画所在svg内部按顺序加调整分：最后一个+100，每上一个-0.05
			let animateScore = 0;
			const svgNodes = [...parentChain, node].reverse().filter(item => item.tag?.toLowerCase() === 'svg');
			const targetAnimateSvg = svgNodes.find(isSvgWidthAnimate);
			if (targetAnimateSvg) {
				const svgId = targetAnimateSvg.__widthSvgId__;
				const svgImgList = widthSvgMap.get(svgId) || [];
				const imgIndex = svgImgList.findIndex(item => item.globalOrder === globalOrder);
				if (imgIndex > -1) {
					animateScore = parseFloat((100 - imgIndex * 0.05).toFixed(1));
				}
			}
			layer += animateScore;

			// 全局按顺序加调整分：第一个+5，每下一个-0.01（单篇图文上限500张图，无缝排版也有最高特征层级分）
			let globalScore = 0;
			globalScore = (500 - globalOrder) * 0.01;
			layer += globalScore;

			// 格式化最终特征层级分
			layer = parseFloat(layer.toFixed(2));

			return {
				url, // 图片链接
				layer, // 特征层级总分
				globalOrder, //全局索引
				totalBottomScore, // 底层特征分
				totalTopScore, // 顶层特征分
				gfoScore, // 并列gfo顺序调整分
				animateScore, // width动画顺序调整分
				globalScore // 全局顺序调整分
			};
		});

		// 特征层级分从大到小排序
		let topLayerImages = [];
		if (imagesDetail.length > 0) {
			const sortedImages = imagesDetail.sort((a, b) => {
				if (b.layer !== a.layer) return b.layer - a.layer;
				return a.globalOrder - b.globalOrder;
			});
			topLayerImages = sortedImages.slice(0, number).map(img => img.url); // 取出前number张图片的链接
		}

		// 生成预加载HTML片段
		const finalHtml = `<section class="用于提前加载的图片组，不影响画面内容，上传后不保留本段注释" style="display: block; height: 0px !important; margin-top: 0px !important; margin-bottom: 0px !important; padding-left: 1000px !important;">
			<svg viewBox="0 0 1 1">
				${topLayerImages.map(url => `<g><foreignObject x="0" y="0" width="1" height="1"><svg style="background-image: url('${url}'); background-size: cover; background-repeat: no-repeat;"></svg></foreignObject></g>`).join('')}
			</svg>
		</section>`;

		// 调试日志
		// console.log('=== 所有图片层级明细 ===');
		// imagesDetail.forEach(img => {
		// 	console.log(`索引：${img.globalOrder} | 链接：${img.url.slice(0, 50)}... | 层级：${img.layer} ｜ 底层特征分：${img.totalBottomScore} ｜ 顶层特征分：${img.totalTopScore} ｜ 并列gfo顺序分：${img.gfoScore} ｜ width动画顺序分：${img.animateScore} ｜ 全局顺序分：${img.globalScore}`);
		// });

		/**
		 * 清理SVG节点的临时属性，避免污染原始树形结构
		 * @param {object} node - 树形结构中的节点对象
		 * @returns {void}
		 */
		const clearSvgTempAttr = (node) => {
			if (!node) return;
			if (node.__widthSvgId__) delete node.__widthSvgId__;
			if (node.children) node.children.forEach(clearSvgTempAttr);
		};
		clearSvgTempAttr(tree);

		return {
			imagesDetail: imagesDetail, // 完整层级明细
			finalHtml: finalHtml // 预加载HTML片段
		};
	}
};
