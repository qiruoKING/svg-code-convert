/**
 * @file SVG图片特征层级检测工具
 * @version 1.0.2
 * @description 量化分析微信公众号SVG交互图文内图片的视觉特征层级，筛选最顶层图片并生成预加载HTML
 * @copyright Copyright (c) 2026 上海意符文化传媒有限公司
 * @license MIT License
 * @homepage https://www.ifsvgtool.com/
 * @demo https://www.ifsvgtool.com/code-converter
 * @repository https://github.com/qiruoKING/svg-code-convert
 *             https://gitee.com/forPage/svg-code-convert
 */

const svgLD = {
	
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
			const sepIndex = item.indexOf(':'); // 只按首个冒号切分，避免url等值内的冒号被截断
			if (sepIndex === -1) return;
			const key = item.slice(0, sepIndex).trim();
			const value = item.slice(sepIndex + 1).trim();
			if (key && value) {
				// 键名统一转驼峰（margin-top → marginTop、z-index → zIndex），与计分逻辑的读取方式保持一致
				const camelKey = key.toLowerCase().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
				styleObj[camelKey] = value;
			}
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
			return ['svg', 'g', 'foreignobject'].includes(tag);
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
		 * 判断节点是否为height:0
		 * @param {object} node - 树形结构中的节点对象
		 * @returns {boolean} 是height:0返回true，否则返回false
		 */
		const isHeightZero = (node) => {
			if (!node || !node.attrs) return false;
			// height属性写法（height="0"）
			const attrHeight = String(node.attrs.height || '').trim();
			if (attrHeight && /^0(\.\d+)?\s*(px|%|rem|em|vh|vw)?$/i.test(attrHeight)) return true;
			// style写法
			if (!node.attrs.style) return false;
			const s = svgLD.parseStyle(node.attrs.style);
			if (!s.height) return false;
			// 去除!important修饰，兼容 0.0px 等小数零值写法
			const heightStr = s.height.replace(/!important\s*$/i, '').trim();
			return /^0(\.\d+)?\s*(px|%|rem|em|vh|vw)?$/i.test(heightStr);
		};

		/**
		 * 顶层特征加分计算：根据style字符串计算单一样式的顶层加分值（已移除height:0逻辑）
		 * @param {string} styleStr - 待计算的CSS样式字符串
		 * @returns {number} 计算后的顶层特征总加分值
		 */
		const calculateTopScore = (styleStr) => {
			let score = 0;
			const s = this.parseStyle(styleStr);
			// 顶层特征1：style内margin-top为非0非px单位的负数
			if (s.marginTop) {
				const trimmedMargin = s.marginTop.replace(/!important\s*$/i, '').trim();
				const negativeMarginReg = /^-([1-9]\d*(\.\d+)?|0\.\d+)(%|\s*rem|\s*em|\s*vh|\s*vw)$/i;
				if (negativeMarginReg.test(trimmedMargin)) {
					score += 10;
				} else if (/^-\d+(\.\d+)?\s*px$/i.test(trimmedMargin) && Math.abs(parseFloat(trimmedMargin)) >= 10) {
					score += 5; // px单位的大幅负边距同样是层叠信号（-1px无缝拼接去缝写法不加分）
				}
			}
			// 顶层特征2：style内transform存在
			if (s.transform && s.transform !== 'none') score += 5;
			// 顶层特征3：style内isolation:isolate
			if (s.isolation === 'isolate') score += 3;
			// 顶层特征4：style内z-index>0
			if (s.zIndex) {
				const zIndexNum = Number(String(s.zIndex).replace(/!important\s*$/i, '').trim());
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

			// ==================== 底层特征计算 ====================
			
			// 底层特征2&3：opacity相关（style和属性），真透明图多为不可见触发层，预加载价值低
			let opacityScore = 0;
			allStyles.forEach(style => {
				const s = this.parseStyle(style);
				if (isOpacityMinValue(s.opacity)) opacityScore -= 5;
			});
			if (isOpacityMinValue(node?.attrs?.opacity)) opacityScore -= 5;

			// 底层特征4：自身或任一祖先 display:none / visibility:hidden，隐藏层（如点击后才显示的图）压底
			const isInvisible = allStyles.some(style => {
				const s = this.parseStyle(style);
				const display = (s.display || '').replace(/!important\s*$/i, '').trim().toLowerCase();
				const visibility = (s.visibility || '').replace(/!important\s*$/i, '').trim().toLowerCase();
				return display === 'none' || visibility === 'hidden';
			});
			const invisibleScore = isInvisible ? -20 : 0;

			// 底层特征1：height:0 相关扣分（包含父节点继承和并列倒扣）
			let heightZeroScore = 0;
			
			// 前置条件：存在祖父节点且parentNode有并列上下文
			if (parentChain.length >= 2 && parentNode) {
				const grandParent = parentChain[parentChain.length - 2];
				if (grandParent && grandParent.children) {
					const siblings = grandParent.children;
					const containerIndex = siblings.findIndex(c => c === parentNode);
					
					if (containerIndex !== -1) {
						// 辅助函数：计算从startIndex开始到containerIndex-1的连续height:0数量
						// 遇到非height:0节点立即停止计数（阻断效应）
						const countContinuousH0 = (startIndex) => {
							let count = 0;
							for (let i = startIndex; i < containerIndex; i++) { // 关键：i < containerIndex，不包含parentNode自身
								const sibling = siblings[i];
								if (!sibling?.tag) continue;
								if (isHeightZero(sibling)) {
									count++;
								} else {
									break; // 非height:0节点阻断连续计数
								}
							}
							return count;
						};
						
						// 遍历parentNode之前的所有兄弟节点（0到containerIndex-1）
						// parentNode自身（containerIndex）不参与此遍历，故不扣分
						for (let i = 0; i < containerIndex; i++) {
							const sibling = siblings[i];
							if (!sibling?.tag) continue;
							
							if (isHeightZero(sibling)) {
								// 每个height:0前置兄弟扣分 = 其连续长度 × 10
								// 连续长度计算从当前i开始，到第一个非h0或parentNode前停止
								heightZeroScore -= countContinuousH0(i) * 10;
							}
						}
						
						// 注：parentNode（containerIndex）即使是height:0，也不在此逻辑中扣分
						// 其子元素img更不受此逻辑影响，heightZeroScore保持初始值0
					}
				}
			}

			const totalBottomScore = opacityScore + heightZeroScore + invisibleScore; // 底层特征分（opacity/height:0/不可见）

			// 顶层特征总加分
			const totalTopScore = allStyles.reduce((sum, style) => sum + calculateTopScore(style), 0);
			layer += totalTopScore;

			// 并列g/fo场景按顺序加调整分：第一个+0，每下一个+3
			let gfoScore = 0;
			const nearestContainer = findNearestSvgContainer(parentChain);
			if (nearestContainer) {
				// 树节点不持有父引用，容器在祖先链中的前一位即其父节点
				const containerChainIndex = parentChain.lastIndexOf(nearestContainer);
				const containerParent = containerChainIndex > 0 ? parentChain[containerChainIndex - 1] : null;
				const containerIndex = containerParent ? containerParent.children.findIndex(c => c === nearestContainer) : 0;
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
					// 文档序最后一张图（动画完全展开帧）得满分100，每靠前一张减0.05
					animateScore = parseFloat((100 - (svgImgList.length - 1 - imgIndex) * 0.05).toFixed(2));
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
				totalBottomScore, // 底层特征分（包含opacity和新的height:0逻辑）
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
			// 按URL去重筛选（同图多处引用只占一个名额），data:内联图已在本地无需预加载直接跳过
			const seenUrls = new Set();
			for (const img of sortedImages) {
				if (img.url.startsWith('data:')) continue;
				if (seenUrls.has(img.url)) continue;
				seenUrls.add(img.url);
				topLayerImages.push(img.url);
				if (topLayerImages.length >= number) break;
			}
		}

		// 生成预加载HTML片段
		// 预加载片段遵循公众号代码规范：仅使用style属性，无id/class，无style/script标签，零脚本
		const safeUrl = (url) => url.replace(/'/g, '%27').replace(/\)/g, '%29'); // 转义url中可能破坏style语法的字符
		const finalHtml = `<section style="display: block; height: 0px !important; margin-top: 0px !important; margin-bottom: 0px !important; padding-left: 1000px !important; overflow: hidden !important;"><svg viewBox="0 0 1 1">${topLayerImages.map(url => `<g><foreignObject x="0" y="0" width="1" height="1"><svg viewBox="0 0 1 1" style="background-image: url('${safeUrl(url)}'); background-size: cover; background-repeat: no-repeat;"></svg></foreignObject></g>`).join('')}</svg></section>`;

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
}