<?php
/**
 * 图片代理接口
 * 用途：配合 svg-code-convert.js 的 getImageRatio，突破公众号图片跨域/防盗链限制
 * 安全：协议白名单 + 域名白名单 + 大小限制 + 跳转重校验，防止被当作开放代理滥用
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept');

/**
 * 统一的JSON错误响应
 * @param int $code HTTP状态码
 * @param string $msg 错误信息
 */
function proxyError($code, $msg) {
	http_response_code($code);
	header('Content-Type: application/json; charset=utf-8');
	echo json_encode(['code' => $code, 'msg' => $msg], JSON_UNESCAPED_UNICODE);
	exit;
}

// 1. 校验参数：必须传url参数
if (!isset($_GET['url']) || empty($_GET['url'])) {
	proxyError(400, '缺少图片URL参数');
}

// $_GET已自动完成一次URL解码，无需再urldecode（重复解码会把图片链接里的%25等合法字符破坏）
$imgUrl = trim($_GET['url']);

// 2. 协议白名单：仅允许http/https，拦截file://、gopher://等危险协议
$urlParts = parse_url($imgUrl);
$scheme = strtolower($urlParts['scheme'] ?? '');
if (!$urlParts || empty($urlParts['host']) || !in_array($scheme, ['http', 'https'], true)) {
	proxyError(403, '仅支持http/https图片链接');
}

// 3. 域名白名单：仅放行微信图床（如有自建图床可追加），防止服务器被当作开放代理
$allowedHosts = [
	'mmbiz.qpic.cn',   // 公众号图文图片
	'mmbiz.qlogo.cn',  // 公众号头像/二维码
	'mmbizurl.cn',     // 微信短链图床
	'wx.qlogo.cn',     // 微信头像
];

/**
 * 判断主机名是否在白名单内（含子域名匹配）
 * @param string $host 待校验主机名
 * @return bool
 */
function isHostAllowed($host) {
	global $allowedHosts;
	$host = strtolower($host);
	foreach ($allowedHosts as $allowed) {
		if ($host === $allowed || substr($host, -strlen('.' . $allowed)) === '.' . $allowed) {
			return true;
		}
	}
	return false;
}

if (!isHostAllowed($urlParts['host'])) {
	proxyError(403, '该域名不在代理白名单内');
}

/**
 * 抓取URL内容（单次请求，不自动跟随跳转）
 * @param string $url 目标URL
 * @param int $maxBytes 最大读取字节数
 * @return array [数据|false, HTTP状态码, Location跳转地址]
 */
function fetchImage($url, $maxBytes) {
	$opts = [
		'http' => [
			'method'  => 'GET',
			'header'  => implode("\r\n", [
				'Referer: https://mp.weixin.qq.com/', // 模拟公众号后台Referer（微信图片必传）
				'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept: image/png,image/jpeg,image/gif,image/webp,*/*',
				'Accept-Language: zh-CN,zh;q=0.9',
				'Cache-Control: no-cache',
				'Pragma: no-cache'
			]),
			'timeout' => 5, // 超时时间5秒（和前端对应）
			'follow_location' => 0, // 不自动跟随跳转，跳转目标需重新过白名单
			'ignore_errors' => true // 4xx/5xx也能拿到状态码，便于区分错误类型
		]
	];
	$context = stream_context_create($opts);
	$data = @file_get_contents($url, false, $context, 0, $maxBytes + 1); // 多读1字节用于判断超限

	$status = 0;
	$location = '';
	foreach (($http_response_header ?? []) as $h) {
		if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
			$status = (int)$m[1];
		}
		if (stripos($h, 'Location:') === 0) {
			$location = trim(substr($h, 9));
		}
	}
	return [$data, $status, $location];
}

// 4. 抓取图片（最多跟随3次跳转，每次跳转都重新校验协议+域名白名单）
$maxBytes = 10 * 1024 * 1024; // 单图最大10MB，防止超大文件撑爆内存
$currentUrl = $imgUrl;
$imgData = false;
$status = 0;

for ($redirectCount = 0; $redirectCount <= 3; $redirectCount++) {
	[$imgData, $status, $location] = fetchImage($currentUrl, $maxBytes);

	if ($imgData === false) {
		proxyError(502, '图片获取失败（防盗链/URL无效/超时）');
	}

	// 命中跳转：校验新地址后继续
	if (in_array($status, [301, 302, 303, 307, 308], true) && $location) {
		// 支持相对路径跳转
		$nextParts = parse_url($location);
		if (empty($nextParts['host'])) {
			$location = $scheme . '://' . $urlParts['host'] . (substr($location, 0, 1) === '/' ? '' : '/') . $location;
			$nextParts = parse_url($location);
		}
		$nextScheme = strtolower($nextParts['scheme'] ?? '');
		if (!in_array($nextScheme, ['http', 'https'], true) || !isHostAllowed($nextParts['host'] ?? '')) {
			proxyError(403, '跳转目标不在代理白名单内');
		}
		$currentUrl = $location;
		continue;
	}
	break;
}

if ($status < 200 || $status >= 300) {
	proxyError(502, '图片源站返回异常状态码：' . $status);
}
if (strlen($imgData) > $maxBytes) {
	proxyError(413, '图片大小超过10MB限制');
}

// 5. 判断MIME类型：优先文件头魔数嗅探（最可靠），其次URL特征，兜底jpeg（微信默认格式）
$mimeType = '';
if (substr($imgData, 0, 3) === "\xFF\xD8\xFF") {
	$mimeType = 'image/jpeg';
} elseif (substr($imgData, 0, 8) === "\x89PNG\r\n\x1a\n") {
	$mimeType = 'image/png';
} elseif (substr($imgData, 0, 6) === 'GIF87a' || substr($imgData, 0, 6) === 'GIF89a') {
	$mimeType = 'image/gif';
} elseif (substr($imgData, 0, 4) === 'RIFF' && substr($imgData, 8, 4) === 'WEBP') {
	$mimeType = 'image/webp';
}
if (!$mimeType) {
	// URL特征兜底：?wx_fmt= 参数、mmbiz_xxx 路径段、文件后缀
	if (preg_match('/wx_fmt=(png|jpe?g|gif|webp)/i', $currentUrl, $m)
		|| preg_match('#mmbiz_(png|jpe?g|gif|webp)/#i', $currentUrl, $m)
		|| preg_match('/\.(png|jpe?g|gif|webp)([?#]|$)/i', $currentUrl, $m)) {
		$fmtMap = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp'];
		$mimeType = $fmtMap[strtolower($m[1])];
	} else {
		$mimeType = 'image/jpeg';
	}
}

// 6. 输出图片
header('Content-Type: ' . $mimeType);
header('Content-Length: ' . strlen($imgData));
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');
echo $imgData;
exit;
?>
