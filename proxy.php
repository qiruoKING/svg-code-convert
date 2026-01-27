<?php
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Origin, X-Requested-With, Content-Type, Accept');

// 校验参数
if (!isset($_GET['url']) || empty($_GET['url'])) {
    http_response_code(400);
    echo json_encode(['code' => 400, 'msg' => '缺少图片URL参数']);
    exit;
}

// 解码图片URL
$imgUrl = urldecode($_GET['url']);

// 模拟微信合法请求头
$opts = [
    'http' => [
        'method'  => 'GET',
        'header'  => implode("\r\n", [
            'Referer: https://mp.weixin.qq.com/',
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept: image/png,image/jpeg,image/gif,image/webp,*/*',
            'Accept-Language: zh-CN,zh;q=0.9',
            'Cache-Control: no-cache',
            'Pragma: no-cache'
        ]),
        'timeout' => 5,
    ]
];
$context = stream_context_create($opts);

// 获取图片二进制数据
$imgData = @file_get_contents($imgUrl, false, $context);
if ($imgData === false) {
    http_response_code(500);
    echo json_encode(['code' => 500, 'msg' => '图片获取失败']);
    exit;
}

// 使用图片URL后缀映射MIME类型
$urlParts = parse_url($imgUrl);
$path = $urlParts['path'] ?? '';
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$mimeMap = [
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'gif' => 'image/gif'
];

// 默认MIME类型
$mimeType = $mimeMap[$ext] ?? 'image/png';

// 设置响应头
header('Content-Type: ' . $mimeType);

// 禁用缓存
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// 输出图片二进制数据
echo $imgData;
exit;
?>
