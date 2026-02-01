// V3.0 版本：使用 ITDog 批量 Ping 测速替代原有测速方式
const FAST_IP_COUNT = 25; // 优质 IP 数量
const AUTO_TEST_MAX_IPS = 70; // 最大测试 IP 数
const ITDOG_TOKEN = 'token_20230313000136kwyktxb0tgspm00yo5'; // ITDog token

// ITDog Cookie - 需要用户设置有效的Cookie来绕过反爬验证
// 可通过环境变量 ITDOG_COOKIE 设置，或手动填写
const ITDOG_DEFAULT_COOKIE = '';

// 山东地区节点ID列表（用于权重计算）
const SHANDONG_NODE_IDS = ["1308", "1303", "1243"];

// 山东地区节点延迟权重系数（>1 表示山东地区权重更高）
const SHANDONG_WEIGHT = 1.3;

// ITDog 测速节点配置 - 国内代表性节点 + 山东全部节点（已移除海外节点）
const ITDOG_NODE_IDS = {
  // === 电信节点 ===
  "1310": ["电信", "北京"],
  "1227": ["电信", "上海"],
  "1304": ["电信", "四川成都"],
  "1169": ["电信", "广东深圳"],
  "1308": ["电信", "山东青岛"],      // 山东节点
  "1214": ["电信", "湖北武汉"],
  "1305": ["电信", "浙江宁波"],
  "1306": ["电信", "河南洛阳"],
  // === 联通节点 ===
  "1273": ["联通", "北京"],
  "1254": ["联通", "上海"],
  "1226": ["联通", "四川成都"],
  "1278": ["联通", "广东潮州"],
  "1303": ["联通", "山东济南"],      // 山东节点
  "1276": ["联通", "湖北武汉"],
  "1297": ["联通", "浙江杭州"],
  "1300": ["联通", "河南郑州"],
  // === 移动节点 ===
  "1250": ["移动", "北京"],
  "1249": ["移动", "上海"],
  "1283": ["移动", "四川成都"],
  "1290": ["移动", "广东深圳"],
  "1243": ["移动", "山东济南"],      // 山东节点
  "1287": ["移动", "湖北武汉"],
  "1233": ["移动", "浙江杭州"],
  "1246": ["移动", "河南郑州"]
};

// 默认使用的节点ID（电信、联通、移动各一个代表性节点 + 山东节点）
const DEFAULT_NODE_IDS = "1310,1273,1250,1308,1303,1243";

export default {
  async scheduled(event, env, ctx) {
    console.log('Running scheduled IP update and speed test...');
    try {
      if (!env.IP_STORAGE) {
        console.error('KV namespace IP_STORAGE is not bound');
        return;
      }
      const { uniqueIPs, results } = await updateAllIPs(env);
      await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
        ips: uniqueIPs,
        lastUpdated: new Date().toISOString(),
        count: uniqueIPs.length,
        sources: results
      }));
      // 定时自动测速
      await speedTestAndStore(env, uniqueIPs);
      console.log(`Scheduled update and test: ${uniqueIPs.length} IPs collected and tested`);
    } catch (error) {
      console.error('Scheduled update failed:', error);
    }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
  
    if (!env.IP_STORAGE) {
      return new Response('KV namespace IP_STORAGE is not bound.', { status: 500 });
    }
  
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }
    try {
      switch (path) {
        case '/':
          return await serveHTML(env, request);
        case '/update':
          if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
          return await handleUpdate(env, request);
        case '/ips':
        case '/ip.txt':
          return await handleGetIPs(env, request);
        case '/raw':
          return await handleRawIPs(env, request);
        case '/fast-ips':
          return await handleGetFastIPs(env, request);
        case '/fast-ips.txt':
          return await handleGetFastIPsText(env, request);
        case '/itdog-data':
          return await handleItdogData(env, request);
        case '/manual-speedtest':  // 手动测速路由
          if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
          return await handleManualSpeedTest(env, request);
        default:
          return jsonResponse({ error: 'Endpoint not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

// 处理手动测速
async function handleManualSpeedTest(env, request) {
  const body = await request.json();
  const maxTest = Math.min(AUTO_TEST_MAX_IPS, body.maxTests || 25);

  const data = await getStoredIPs(env);
  const ips = data.ips || [];

  if (ips.length === 0) {
    return jsonResponse({ error: 'No IPs available' }, 400);
  }

  const startTime = Date.now();
  const fastIPs = await speedTestAndStore(env, ips, maxTest);
  const duration = Date.now() - startTime;

  return jsonResponse({
    success: true,
    message: 'Manual speed test completed',
    duration: `${duration}ms`,
    tested: fastIPs.length,
    fastIPs
  });
}

// 测速并存储（用于定时和手动）
async function speedTestAndStore(env, ips, maxTest = 25) {
  if (!ips || ips.length === 0) return [];

  const speedResults = [];
  const BATCH_SIZE = 2; // 低并发
  const DELAY_BETWEEN_BATCH = 1500; // ms 批次间隔

  const ipsToTest = ips.slice(0, maxTest);
  console.log(`Speed test: ${ipsToTest.length} IPs`);

  for (let i = 0; i < ipsToTest.length; i += BATCH_SIZE) {
    const batch = ipsToTest.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(ip => testIPSpeed(ip, env));

    const batchResults = await Promise.allSettled(batchPromises);

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const ip = batch[j];
      if (result.status === 'fulfilled' && result.value.success) {
        speedResults.push({
          ip,
          latency: Math.round(result.value.latency),
          bandwidth: Math.round(result.value.bandwidth)
        });
      }
    }

    // 批次间隔
    if (i + BATCH_SIZE < ipsToTest.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCH));
    }
  }

  // 排序：延迟升序，带宽降序
  speedResults.sort((a, b) => a.latency - b.latency || b.bandwidth - a.bandwidth);
  const fastIPs = speedResults.slice(0, FAST_IP_COUNT);

  await env.IP_STORAGE.put('cloudflare_fast_ips', JSON.stringify({
    fastIPs,
    lastTested: new Date().toISOString(),
    count: fastIPs.length,
    testedCount: speedResults.length,
    totalIPs: ips.length
  }));

  console.log(`Test done: ${fastIPs.length} fast IPs`);
  return fastIPs;
}

// 测试单个 IP 使用 ITDog 批量 Ping
// 通过 WebSocket 连接到 ITDog 服务器进行测速
async function testIPWithItdog(ip, env) {
  const nodeIds = Object.keys(ITDOG_NODE_IDS).join(',');
  const cookie = env.ITDOG_COOKIE || ITDOG_DEFAULT_COOKIE;
  
  try {
    // 第一步：提交测速任务获取 task_id
    const formData = new URLSearchParams();
    formData.append('host', ip);
    formData.append('node_id', nodeIds);
    formData.append('check_mode', 'ping');
    
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.itdog.cn/batch_ping/',
      'Origin': 'https://www.itdog.cn'
    };
    
    // 添加 Cookie 支持反爬验证
    if (cookie) {
      headers['Cookie'] = cookie;
    }
    
    const response = await fetch('https://www.itdog.cn/batch_ping/', {
      method: 'POST',
      headers: headers,
      body: formData.toString(),
      signal: AbortSignal.timeout(15000)
    });
    
    if (!response.ok) {
      throw new Error(`ITDog HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // 从响应中提取 task_id
    const taskIdMatch = html.match(/task_id\s*[:=]\s*['"]([^'"]+)['"]/);
    if (!taskIdMatch) {
      // 检查是否需要Cookie验证
      if (html.includes('请完成验证') || html.includes('验证码') || html.includes('请稍后')) {
        throw new Error('ITDog需要Cookie验证，请设置ITDOG_COOKIE环境变量');
      }
      throw new Error('无法获取task_id');
    }
    
    const taskId = taskIdMatch[1];
    
    // 生成 task_token (task_id + token 的 MD5 前16位)
    const taskToken = await generateTaskToken(taskId);
    
    // 第二步：通过轮询获取结果（模拟WebSocket效果）
    const results = await pollItdogResults(taskId, taskToken, cookie, nodeIds.split(',').length);
    
    // 计算加权平均延迟（山东节点权重更高）
    const avgLatency = calculateWeightedLatency(results);
    
    return {
      success: true,
      latency: avgLatency,
      bandwidth: 0, // ITDog 不提供带宽数据
      nodeResults: results
    };
    
  } catch (error) {
    console.error(`ITDog test failed for ${ip}:`, error.message);
    return { success: false, error: error.message };
  }
}

// 生成 ITDog task_token (MD5)
async function generateTaskToken(taskId) {
  const str = taskId + ITDOG_TOKEN;
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('MD5', data).catch(() => null);
  
  // Cloudflare Workers 不支持 MD5，使用备用方案
  if (!hashBuffer) {
    // 简单的字符串哈希作为备用
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0').substring(0, 16);
  }
  
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 16);
}

// 轮询 ITDog 结果
async function pollItdogResults(taskId, taskToken, cookie, expectedCount) {
  const results = [];
  const maxRetries = 30; // 最多轮询30次
  const pollInterval = 1000; // 每秒轮询一次
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.itdog.cn/batch_ping/'
  };
  
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`https://www.itdog.cn/batch_ping/get_result?task_id=${taskId}&task_token=${taskToken}`, {
        headers: headers,
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data && data.list) {
          for (const item of data.list) {
            if (item.result && !isNaN(parseInt(item.result))) {
              results.push({
                nodeId: item.node_id,
                latency: parseInt(item.result),
                isShandong: SHANDONG_NODE_IDS.includes(item.node_id)
              });
            }
          }
        }
        
        // 如果收到足够的结果，返回
        if (results.length >= expectedCount * 0.7) {
          break;
        }
      }
    } catch (e) {
      // 忽略单次轮询错误
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return results;
}

// 计算加权平均延迟（山东节点权重更高）
function calculateWeightedLatency(results) {
  if (!results || results.length === 0) {
    return 9999;
  }
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const result of results) {
    const weight = result.isShandong ? SHANDONG_WEIGHT : 1.0;
    weightedSum += result.latency * weight;
    totalWeight += weight;
  }
  
  return Math.round(weightedSum / totalWeight);
}

// 备用测速方法：直接测试单个 IP（延迟 + 小带宽）
async function testIPSpeedDirect(ip) {
  const TEST_BYTES = 10000;
  try {
    const startTime = Date.now();
    const testUrl = `https://speed.cloudflare.com/__down?bytes=${TEST_BYTES}`;

    const response = await fetch(testUrl, {
      headers: {
        'Host': 'speed.cloudflare.com',
        'User-Agent': 'Mozilla/5.0 (compatible; CF-Worker-Test/1.0; low-volume-manual)'
      },
      cf: { resolveOverride: ip },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await response.arrayBuffer();
    const endTime = Date.now();
    const latency = endTime - startTime;
    const bandwidth = (TEST_BYTES / 1024 / 1024) / (latency / 1000);

    return { success: true, latency, bandwidth };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 智能测速：优先使用 ITDog，失败时使用直接测速
async function testIPSpeed(ip, env) {
  // 首先尝试 ITDog 测速
  const itdogResult = await testIPWithItdog(ip, env);
  
  if (itdogResult.success) {
    return itdogResult;
  }
  
  // ITDog 失败时，使用直接测速作为备用
  console.log(`ITDog failed for ${ip}, falling back to direct test`);
  return await testIPSpeedDirect(ip);
}

// 提供HTML页面
async function serveHTML(env, request) {
  const data = await getStoredIPs(env);

  // 获取测速后的IP数据
  const speedData = await getStoredSpeedIPs(env);
  const fastIPs = speedData.fastIPs || [];
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cloudflare 优选IP</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
      
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            background: #f8fafc;
            color: #334155;
            min-height: 100vh;
            padding: 20px;
        }
      
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
      
        /* 头部和社交图标 */
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e2e8f0;
        }
      
        .header-content h1 {
            font-size: 2.5rem;
            background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 8px;
            font-weight: 700;
        }
      
        .header-content p {
            color: #64748b;
            font-size: 1.1rem;
        }
      
        .social-links {
            display: flex;
            gap: 15px;
        }
      
        .social-link {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            border-radius: 12px;
            background: white;
            border: 1px solid #e2e8f0;
            transition: all 0.3s ease;
            text-decoration: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
      
        .social-link:hover {
            background: #f8fafc;
            transform: translateY(-2px);
            border-color: #cbd5e1;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
      
        .social-link.youtube {
            color: #dc2626;
        }
      
        .social-link.youtube:hover {
            background: #fef2f2;
            border-color: #fecaca;
        }
      
        .social-link.github {
            color: #1f2937;
        }
      
        .social-link.github:hover {
            background: #f8fafc;
            border-color: #cbd5e1;
        }
      
        .social-link.telegram {
            color: #3b82f6;
        }
      
        .social-link.telegram:hover {
            background: #eff6ff;
            border-color: #bfdbfe;
        }
      
        /* 卡片设计 */
        .card {
            background: white;
            border-radius: 16px;
            padding: 30px;
            margin-bottom: 24px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }
      
        .card h2 {
            font-size: 1.5rem;
            color: #1e40af;
            margin-bottom: 20px;
            font-weight: 600;
        }
      
        /* 统计数字 */
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
      
        .stat {
            background: #f8fafc;
            padding: 20px;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #e2e8f0;
        }
      
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #3b82f6;
            margin-bottom: 8px;
        }
      
        /* 按钮组 */
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 20px;
        }
      
        .button {
            padding: 12px 20px;
            border: none;
            border-radius: 10px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #3b82f6;
            color: white;
            border: 1px solid #3b82f6;
        }
      
        .button:hover {
            background: #2563eb;
            border-color: #2563eb;
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
        }
      
        .button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
            background: #cbd5e1;
            border-color: #cbd5e1;
            color: #64748b;
        }
      
        .button-success {
            background: #10b981;
            border-color: #10b981;
        }
      
        .button-success:hover {
            background: #059669;
            border-color: #059669;
            box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
        }
      
        .button-warning {
            background: #f59e0b;
            border-color: #f59e0b;
        }
      
        .button-warning:hover {
            background: #d97706;
            border-color: #d97706;
            box-shadow: 0 4px 8px rgba(245, 158, 11, 0.3);
        }
      
        .button-secondary {
            background: white;
            color: #475569;
            border-color: #cbd5e1;
        }
      
        .button-secondary:hover {
            background: #f8fafc;
            border-color: #94a3b8;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
      
        /* 下拉按钮组 */
        .dropdown {
            position: relative;
            display: inline-block;
        }
      
        .dropdown-content {
            display: none;
            position: absolute;
            background-color: white;
            min-width: 160px;
            box-shadow: 0 8px 16px 0 rgba(0,0,0,0.1);
            z-index: 1;
            border-radius: 10px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
            top: 100%;
            left: 0;
            margin-top: 5px;
        }
      
        .dropdown-content a {
            color: #475569;
            padding: 12px 16px;
            text-decoration: none;
            display: block;
            border-bottom: 1px solid #f1f5f9;
            transition: all 0.3s ease;
        }
      
        .dropdown-content a:hover {
            background-color: #f8fafc;
            color: #1e40af;
        }
      
        .dropdown-content a:last-child {
            border-bottom: none;
        }
      
        .dropdown:hover .dropdown-content {
            display: block;
        }
      
        .dropdown-btn {
            display: flex;
            align-items: center;
            gap: 4px;
        }
      
        /* IP 列表 */
        .ip-list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            flex-wrap: wrap;
            gap: 15px;
        }
      
        .ip-list {
            background: #f8fafc;
            border-radius: 12px;
            padding: 20px;
            max-height: 500px;
            overflow-y: auto;
            border: 1px solid #e2e8f0;
        }
      
        .ip-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-bottom: 1px solid #e2e8f0;
            transition: background 0.3s ease;
        }
      
        .ip-item:hover {
            background: #f1f5f9;
        }
      
        .ip-item:last-child {
            border-bottom: none;
        }
      
        .ip-info {
            display: flex;
            align-items: center;
            gap: 16px;
        }
      
        .ip-address {
            font-family: 'SF Mono', 'Courier New', monospace;
            font-weight: 600;
            min-width: 140px;
            color: #1e293b;
        }
      
        .speed-result {
            font-size: 0.85rem;
            padding: 4px 12px;
            border-radius: 8px;
            background: #e2e8f0;
            min-width: 70px;
            text-align: center;
            font-weight: 600;
        }
      
        .speed-fast {
            background: #d1fae5;
            color: #065f46;
        }
      
        .speed-medium {
            background: #fef3c7;
            color: #92400e;
        }
      
        .speed-slow {
            background: #fee2e2;
            color: #991b1b;
        }
      
        .action-buttons {
            display: flex;
            gap: 8px;
        }
      
        .small-btn {
            padding: 6px 12px;
            border-radius: 8px;
            font-size: 0.8rem;
            border: 1px solid #cbd5e1;
            background: white;
            color: #475569;
            cursor: pointer;
            transition: all 0.3s ease;
        }
      
        .small-btn:hover {
            background: #f8fafc;
            border-color: #94a3b8;
        }
      
        .small-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
      
        /* 加载和状态 */
        .loading {
            display: none;
            text-align: center;
            padding: 30px;
        }
      
        .spinner {
            border: 3px solid #e2e8f0;
            border-top: 3px solid #3b82f6;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
      
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
      
        .result {
            margin: 20px 0;
            padding: 16px 20px;
            border-radius: 12px;
            display: none;
            border-left: 4px solid;
        }
      
        .success {
            background: #d1fae5;
            color: #065f46;
            border-left-color: #10b981;
        }
      
        .error {
            background: #fee2e2;
            color: #991b1b;
            border-left-color: #ef4444;
        }
      
        /* 进度条 */
        .speed-test-progress {
            margin: 16px 0;
            background: #e2e8f0;
            border-radius: 8px;
            height: 8px;
            overflow: hidden;
            display: none;
        }
      
        .speed-test-progress-bar {
            background: linear-gradient(90deg, #3b82f6, #06b6d4);
            height: 100%;
            width: 0%;
            transition: width 0.3s ease;
        }
      
        /* 数据来源 */
        .sources {
            display: grid;
            gap: 12px;
        }
      
        .source {
            padding: 12px 16px;
            background: #f8fafc;
            border-radius: 8px;
            border-left: 4px solid #10b981;
        }
      
        .source.error {
            border-left-color: #ef4444;
        }
      
        /* 页脚 */
        .footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid #e2e8f0;
            color: #64748b;
        }
      
        /* 模态框 */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(5px);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
      
        .modal-content {
            background: white;
            padding: 30px;
            border-radius: 16px;
            max-width: 500px;
            width: 90%;
            border: 1px solid #e2e8f0;
            box-shadow: 0 20px 25px rgba(0, 0, 0, 0.1);
        }
      
        .modal h3 {
            margin-bottom: 16px;
            color: #1e40af;
        }
      
        .modal-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 20px;
        }
      
        /* 响应式设计 */
        @media (max-width: 768px) {
            .header {
                flex-direction: column;
                gap: 20px;
                text-align: center;
            }
          
            .header-content h1 {
                font-size: 2rem;
            }
          
            .button-group {
                flex-direction: column;
            }
          
            .button {
                width: 100%;
                justify-content: center;
            }
          
            .dropdown {
                width: 100%;
            }
          
            .dropdown-content {
                width: 100%;
                position: static;
                box-shadow: none;
                border: 1px solid #e2e8f0;
                margin-top: 8px;
            }
          
            .ip-list-header {
                flex-direction: column;
                align-items: flex-start;
            }
          
            .ip-item {
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
            }
          
            .ip-info {
                width: 100%;
                justify-content: space-between;
            }
          
            .action-buttons {
                width: 100%;
                justify-content: flex-end;
            }
          
            .modal-buttons {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 头部区域 -->
        <div class="header">
            <div class="header-content">
            <h1 style="text-align: center;">Cloudflare 优选IP</h1>
            <p style="text-align: center;">自动定时拉取IP并测速</p>
            <p style="text-align: center;">项目由<a href="https://www.1373737.xyz/" target="_blank" rel="noopener noreferrer">37VPS主机评测</a>赞助</p>
            </div>
            <div class="social-links">
                <a href="https://www.youtube.com/@cyndiboy7881" target="_blank" title="心凌男孩 Cyndi Boy" class="social-link youtube">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.377.504A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.504 9.376.504 9.376.504s7.505 0 9.377-.504a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12 9.545 15.568z"/>
                    </svg>
                </a>
                <a href="https://github.com/sinian-liu" target="_blank" title="GitHub" class="social-link github">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.085 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                    </svg>
                </a>
                <a href="https://www.1373737.xyz/" target="_blank" title="37VPS主机评测" class="social-link web">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="m7.06510669 16.9258959c5.22739451-2.1065178 8.71314291-3.4952633 10.45724521-4.1662364 4.9797665-1.9157646 6.0145193-2.2485535 6.6889567-2.2595423.1483363-.0024169.480005.0315855.6948461.192827.1814076.1361492.23132.3200675.2552048.4491519.0238847.1290844.0536269.4231419.0299841.65291-.2698553 2.6225356-1.4375148 8.986738-2.0315537 11.9240228-.2513602 1.2428753-.7499132 1.5088847-1.2290685 1.5496672-1.0413153.0886298-1.8284257-.4857912-2.8369905-1.0972863-1.5782048-.9568691-2.5327083-1.3984317-4.0646293-2.3321592-1.7703998-1.0790837-.212559-1.583655.7963867-2.5529189.2640459-.2536609 4.7753906-4.3097041 4.755976-4.431706-.0070494-.0442984-.1409018-.481649-.2457499-.5678447-.104848-.0861957-.2595946-.0567202-.3712641-.033278-.1582881.0332286-2.6794907 1.5745492-7.5636077 4.6239616-.715635.4545193-1.3638349.6759763-1.9445998.6643712-.64024672-.0127938-1.87182452-.334829-2.78737602-.6100966-1.11296117-.3376271-1.53748501-.4966332-1.45976769-1.0700283.04048-.2986597.32581586-.610598.8560076-.935815z"/>
                    </svg>
                </a>
            </div>
        </div>
        <!-- 系统状态卡片 -->
        <div class="card">
            <h2>📊 系统状态</h2>
            <div class="stats">
                <div class="stat">
                    <div class="stat-value" id="ip-count">${data.count || 0}</div>
                    <div>IP 地址数量</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="last-updated">${data.lastUpdated ? '已更新' : '未更新'}</div>
                    <div>最后更新</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="last-time">${data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '从未更新'}</div>
                    <div>更新时间</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="fast-ip-count">${fastIPs.length}</div>
                    <div>优质 IP 数量</div>
                </div>
            </div>
          
            <div class="button-group">
                <button class="button" onclick="updateIPs()" id="update-btn">
                    🔄 立即更新
                </button>
              
                <!-- 下载按钮组 -->
                <div class="dropdown">
                    <a href="/fast-ips.txt" class="button button-success dropdown-btn" download="cloudflare_fast_ips.txt">
                        ⚡ 下载优质IP
                        <span style="font-size: 0.8rem;">▼</span>
                    </a>
                    <div class="dropdown-content">
                        <a href="/ips" download="cloudflare_ips.txt">📥 下载全部列表</a>
                    </div>
                </div>
              
                <!-- 查看按钮组 -->
                <div class="dropdown">
                    <a href="/fast-ips.txt" class="button button-secondary dropdown-btn" target="_blank">
                        🔗 查看优质IP
                        <span style="font-size: 0.8rem;">▼</span>
                    </a>
                    <div class="dropdown-content">
                        <a href="/ip.txt" target="_blank">📋 查看全部文本</a>
                    </div>
                </div>
              
                <button class="button button-warning" onclick="startSpeedTest()" id="speedtest-btn">
                    ⚡ 开始测速
                </button>
                <button class="button" onclick="openItdogModal()">
                    🌐 ITDog 测速
                </button>
                <button class="button button-secondary" onclick="refreshData()">
                    🔄 刷新状态
                </button>
            </div>
          
            <div class="loading" id="loading">
                <div class="spinner"></div>
                <p>正在从多个来源收集 IP 地址，请稍候...</p>
            </div>
          
            <div class="result" id="result"></div>
        </div>
        <!-- 优质IP列表卡片 -->
        <div class="card">
            <div class="ip-list-header">
                <h2>⚡ 优质 IP 列表</h2>
                <div>
                    <button class="small-btn" onclick="copyAllFastIPs()">
                        📋 复制优质IP
                    </button>
                </div>
            </div>
          
            <div class="speed-test-progress" id="speed-test-progress">
                <div class="speed-test-progress-bar" id="speed-test-progress-bar"></div>
            </div>
            <div style="text-align: center; margin: 8px 0; font-size: 0.9rem; color: #64748b;" id="speed-test-status">准备测速...（使用ITDog国内节点，山东权重+30%）</div>
          
            <div class="ip-list" id="ip-list">
                ${fastIPs.length > 0 ?
                  fastIPs.map(item => {
                    const ip = item.ip;
                    const latency = item.latency;
                    const bandwidth = item.bandwidth;
                    const speedClass = latency < 200 ? 'speed-fast' : latency < 500 ? 'speed-medium' : 'speed-slow';
                    return `
                    <div class="ip-item" data-ip="${ip}">
                        <div class="ip-info">
                            <span class="ip-address">${ip}</span>
                            <span class="speed-result ${speedClass}" id="speed-${ip.replace(/\./g, '-')}">${latency}ms</span>
                            <span class="speed-result ${speedClass}" id="bandwidth-${ip.replace(/\./g, '-')}">≈ ${bandwidth} MB/s</span>
                        </div>
                        <div class="action-buttons">
                            <button class="small-btn" onclick="copyIP('${ip}')">复制</button>
                        </div>
                    </div>
                  `}).join('') :
                  '<p style="text-align: center; color: #64748b; padding: 40px;">暂无优质 IP 地址数据，请点击更新按钮获取</p>'
                }
            </div>
        </div>
        <!-- 数据来源卡片 -->
        <div class="card">
            <h2>🌍 数据来源状态</h2>
            <div class="sources" id="sources">
                ${data.sources ? data.sources.map(source => `
                    <div class="source ${source.status === 'success' ? '' : 'error'}">
                        <strong>${source.name}</strong>:
                        ${source.status === 'success' ?
                          `成功获取 ${source.count} 个IP` :
                          `失败: ${source.error}`
                        }
                    </div>
                `).join('') : '<p style="color: #64748b;">暂无数据来源信息</p>'}
            </div>
        </div>
        <!-- 页脚 -->
        <div class="footer">
        <p>Cloudflare IP Collector &copy; ${new Date().getFullYear()} | <a href="https://www.1373737.xyz/" target="_blank" rel="noopener noreferrer">37VPS主机评测</a></p>
        </div>
    </div>
    <!-- ITDog 模态框 -->
    <div class="modal" id="itdog-modal">
        <div class="modal-content">
            <h3>ITDog 批量 Ping 测速</h3>
            <p>系统已集成 ITDog 批量 Ping 功能，使用国内多个监测节点进行测速。</p>
            <p><strong>测速节点说明：</strong></p>
            <ul style="margin-left: 20px; margin-bottom: 16px; font-size: 0.9rem;">
                <li>已移除所有海外节点，仅使用国内节点</li>
                <li>包含电信/联通/移动三网代表性节点</li>
                <li>山东地区节点（青岛电信、济南联通、济南移动）权重提高30%</li>
            </ul>
            <p><strong>Cookie 设置：</strong></p>
            <p style="font-size: 0.9rem; margin-bottom: 12px;">ITDog 需要 Cookie 验证。请在 Cloudflare Worker 环境变量中设置 <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">ITDOG_COOKIE</code></p>
            <p><strong>获取 Cookie 方法：</strong></p>
            <ol style="margin-left: 20px; margin-bottom: 16px; font-size: 0.9rem;">
                <li>浏览器打开 itdog.cn 并登录</li>
                <li>按 F12 打开开发者工具</li>
                <li>切换到 Network 标签</li>
                <li>访问 batch_ping 页面</li>
                <li>复制请求头中的 Cookie 值</li>
            </ol>
            <div class="modal-buttons">
                <button class="button button-secondary" onclick="closeItdogModal()">关闭</button>
                <button class="button" onclick="copyIPsForItdog()">复制 IP 列表</button>
                <a href="https://www.itdog.cn/batch_ping/" class="button button-success" target="_blank">打开 ITDog</a>
            </div>
        </div>
    </div>
    <script>
        // JavaScript 代码
        let speedResults = {};
        let isTesting = false;
        let currentTestIndex = 0;
        function openItdogModal() {
            document.getElementById('itdog-modal').style.display = 'flex';
        }
        function closeItdogModal() {
            document.getElementById('itdog-modal').style.display = 'none';
        }
        async function copyIPsForItdog() {
            try {
                const response = await fetch('/itdog-data');
                const data = await response.json();
              
                if (data.ips && data.ips.length > 0) {
                    const ipText = data.ips.join('\\n');
                    await navigator.clipboard.writeText(ipText);
                    showMessage('已复制 IP 列表，请粘贴到 ITDog 网站');
                    closeItdogModal();
                } else {
                    showMessage('没有可测速的IP地址', 'error');
                }
            } catch (error) {
                console.error('获取 ITDog 数据失败:', error);
                showMessage('获取 IP 列表失败', 'error');
            }
        }
        function copyIP(ip) {
            navigator.clipboard.writeText(ip).then(() => {
                showMessage(\`已复制 IP: \${ip}\`);
            }).catch(err => {
                showMessage('复制失败，请手动复制', 'error');
            });
        }
        function copyAllIPs() {
            const ipItems = document.querySelectorAll('.ip-item span.ip-address');
            const allIPs = Array.from(ipItems).map(span => span.textContent).join('\\n');
          
            if (!allIPs) {
                showMessage('没有可复制的IP地址', 'error');
                return;
            }
          
            navigator.clipboard.writeText(allIPs).then(() => {
                showMessage(\`已复制 \${ipItems.length} 个IP地址\`);
            }).catch(err => {
                showMessage('复制失败，请手动复制', 'error');
            });
        }
        function copyAllFastIPs() {
            const ipItems = document.querySelectorAll('.ip-item span.ip-address');
            const allIPs = Array.from(ipItems).map(span => span.textContent).join('\\n');
          
            if (!allIPs) {
                showMessage('没有可复制的优质IP地址', 'error');
                return;
            }
          
            navigator.clipboard.writeText(allIPs).then(() => {
                showMessage(\`已复制 \${ipItems.length} 个优质IP地址\`);
            }).catch(err => {
                showMessage('复制失败，请手动复制', 'error');
            });
        }
        async function startSpeedTest() {
            if (isTesting) {
                showMessage('测速正在进行中，请稍候...', 'error');
                return;
            }

            isTesting = true;
            const speedtestBtn = document.getElementById('speedtest-btn');
            const progressBar = document.getElementById('speed-test-progress');
            const progressBarInner = document.getElementById('speed-test-progress-bar');
            const statusElement = document.getElementById('speed-test-status');

            speedtestBtn.disabled = true;
            speedtestBtn.textContent = '测速中...';
            progressBar.style.display = 'block';
            statusElement.textContent = '正在通过ITDog国内节点测速（山东权重+30%）...';

            try {
                const response = await fetch('/manual-speedtest', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ maxTests: 25 })  // 默认 25 个，可调整
                });

                if (!response.ok) {
                    throw new Error('测速失败');
                }

                const data = await response.json();
                showMessage(\`测速完成！测试了 \${data.tested} 个 IP\`);

                // 刷新数据
                await refreshData();

            } catch (error) {
                showMessage('测速错误: ' + error.message, 'error');
            } finally {
                isTesting = false;
                speedtestBtn.disabled = false;
                speedtestBtn.textContent = '⚡ 开始测速';
                progressBar.style.display = 'none';
            }
        }
        async function updateIPs() {
            const btn = document.getElementById('update-btn');
            const loading = document.getElementById('loading');
            const result = document.getElementById('result');
          
            btn.disabled = true;
            loading.style.display = 'block';
            result.style.display = 'none';
          
            try {
                const response = await fetch('/update', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
              
                const data = await response.json();
              
                if (data.success) {
                    result.className = 'result success';
                    result.innerHTML = \`
                        <h3>✅ 更新成功！</h3>
                        <p>耗时: \${data.duration}</p>
                        <p>收集到 \${data.totalIPs} 个唯一 IP 地址</p>
                        <p>时间: \${new Date(data.timestamp).toLocaleString()}</p>
                    \`;
                } else {
                    result.className = 'result error';
                    result.innerHTML = \`
                        <h3>❌ 更新失败</h3>
                        <p>\${data.error}</p>
                    \`;
                }
                result.style.display = 'block';
              
                setTimeout(refreshData, 1000);
              
            } catch (error) {
                result.className = 'result error';
                result.innerHTML = \`
                    <h3>❌ 请求失败</h3>
                    <p>\${error.message}</p>
                \`;
                result.style.display = 'block';
            } finally {
                btn.disabled = false;
                loading.style.display = 'none';
            }
        }
      
        async function refreshData() {
            try {
                const response = await fetch('/raw');
                const data = await response.json();
              
                document.getElementById('ip-count').textContent = data.count || 0;
                document.getElementById('last-updated').textContent = data.lastUpdated ? '已更新' : '未更新';
                document.getElementById('last-time').textContent = data.lastUpdated ?
                    new Date(data.lastUpdated).toLocaleTimeString() : '从未更新';
              
                const fastResponse = await fetch('/fast-ips');
                const fastData = await fastResponse.json();
              
                document.getElementById('fast-ip-count').textContent = fastData.fastIPs ? fastData.fastIPs.length : 0;
              
                const ipList = document.getElementById('ip-list');
                if (fastData.fastIPs && fastData.fastIPs.length > 0) {
                    ipList.innerHTML = fastData.fastIPs.map(item => {
                        const ip = item.ip;
                        const latency = item.latency;
                        const bandwidth = item.bandwidth;
                        const speedClass = latency < 200 ? 'speed-fast' : latency < 500 ? 'speed-medium' : 'speed-slow';
                        return \`
                        <div class="ip-item" data-ip="\${ip}">
                            <div class="ip-info">
                                <span class="ip-address">\${ip}</span>
                                <span class="speed-result \${speedClass}" id="speed-\${ip.replace(/\./g, '-')}">\${latency}ms</span>
                                <span class="speed-result \${speedClass}" id="bandwidth-\${ip.replace(/\./g, '-')}">≈ \${bandwidth} MB/s</span>
                            </div>
                            <div class="action-buttons">
                                <button class="small-btn" onclick="copyIP('\${ip}')">复制</button>
                            </div>
                        </div>
                        \`;
                    }).join('');
                } else {
                    ipList.innerHTML = '<p style="text-align: center; color: #64748b; padding: 40px;">暂无优质 IP 地址数据，请点击更新按钮获取</p>';
                }
              
                const sources = document.getElementById('sources');
                if (data.sources && data.sources.length > 0) {
                    sources.innerHTML = data.sources.map(source => \`
                        <div class="source \${source.status === 'success' ? '' : 'error'}">
                            <strong>\${source.name}</strong>:
                            \${source.status === 'success' ?
                              \`成功获取 \${source.count} 个IP\` :
                              \`失败: \${source.error}\`
                            }
                        </div>
                    \`).join('');
                }
            } catch (error) {
                console.error('刷新数据失败:', error);
            }
        }
      
        function showMessage(message, type = 'success') {
            const result = document.getElementById('result');
            result.className = \`result \${type}\`;
            result.innerHTML = \`<p>\${message}</p>\`;
            result.style.display = 'block';
            setTimeout(() => {
                result.style.display = 'none';
            }, 3000);
        }
      
        document.addEventListener('DOMContentLoaded', function() {
            refreshData();
        });
    </script>
</body>
</html>`;
  
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    }
  });
}

// 处理优质IP列表获取（JSON格式）
async function handleGetFastIPs(env, request) {
  const data = await getStoredSpeedIPs(env);
  return jsonResponse(data);
}
// 处理优质IP列表获取（文本格式，IP#实际的延迟ms#带宽MB/s格式）
async function handleGetFastIPsText(env, request) {
  const data = await getStoredSpeedIPs(env);
  const fastIPs = data.fastIPs || [];

  // 格式化为 IP#实际的延迟ms#带宽MB/s
  const ipList = fastIPs.map(item => `${item.ip}#${item.latency}ms#${item.bandwidth}MB/s`).join('\n');

  return new Response(ipList, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="cloudflare_fast_ips.txt"',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
// 处理 ITDog 数据获取
async function handleItdogData(env, request) {
  const data = await getStoredIPs(env);
  return jsonResponse({
    ips: data.ips || [],
    count: data.count || 0
  });
}
// 处理手动更新
async function handleUpdate(env, request) {
  try {
    // 再次检查 KV 绑定
    if (!env.IP_STORAGE) {
      throw new Error('KV namespace IP_STORAGE is not bound. Please check your Worker settings.');
    }
    const startTime = Date.now();
    const { uniqueIPs, results } = await updateAllIPs(env);
    const duration = Date.now() - startTime;
    // 存储到 KV
    await env.IP_STORAGE.put('cloudflare_ips', JSON.stringify({
      ips: uniqueIPs,
      lastUpdated: new Date().toISOString(),
      count: uniqueIPs.length,
      sources: results
    }));
    // 手动更新后也测速
    await speedTestAndStore(env, uniqueIPs);
    return jsonResponse({
      success: true,
      message: 'IPs collected and tested successfully',
      duration: `${duration}ms`,
      totalIPs: uniqueIPs.length,
      timestamp: new Date().toISOString(),
      results: results
    });
  } catch (error) {
    console.error('Update error:', error);
    return jsonResponse({
      success: false,
      error: error.message
    }, 500);
  }
}
// 处理获取IP列表 - 纯文本格式
async function handleGetIPs(env, request) {
  const data = await getStoredIPs(env);
  return new Response(data.ips.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'inline; filename="cloudflare_ips.txt"',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
// 处理获取原始数据
async function handleRawIPs(env, request) {
  const data = await getStoredIPs(env);
  return jsonResponse(data);
}
// 主要的IP收集逻辑
async function updateAllIPs(env) {
  const urls = [
    'https://ip.164746.xyz',
    'https://ip.haogege.xyz/',
    'https://stock.hostmonit.com/CloudFlareYes',
    'https://api.uouin.com/cloudflare.html',
    'https://addressesapi.090227.xyz/CloudFlareYes',
    'https://addressesapi.090227.xyz/ip.164746.xyz',
    'https://www.wetest.vip/page/cloudflare/address_v4.html'
  ];
  const uniqueIPs = new Set();
  const results = [];
  // 使用与Python脚本相同的正则表达式
  const ipPattern = /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/gi;
  // 批量处理URL，控制并发数
  const BATCH_SIZE = 3;
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(url => fetchURLWithTimeout(url, 8000));
  
    const batchResults = await Promise.allSettled(batchPromises);
  
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const url = batch[j];
      const sourceName = getSourceName(url);
    
      if (result.status === 'fulfilled') {
        const content = result.value;
        const ipMatches = content.match(ipPattern) || [];
      
        // 添加到集合中（自动去重）
        ipMatches.forEach(ip => {
          if (isValidIPv4(ip)) {
            uniqueIPs.add(ip);
          }
        });
      
        results.push({
          name: sourceName,
          status: 'success',
          count: ipMatches.length,
          error: null
        });
      
        console.log(`Successfully collected ${ipMatches.length} IPs from ${sourceName}`);
      } else {
        console.error(`Failed to fetch ${sourceName}:`, result.reason);
        results.push({
          name: sourceName,
          status: 'error',
          count: 0,
          error: result.reason.message
        });
      }
    }
  
    // 批次间延迟
    if (i + BATCH_SIZE < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  // 按IP地址的数字顺序排序（与Python脚本相同）
  const sortedIPs = Array.from(uniqueIPs).sort((a, b) => {
    const aParts = a.split('.').map(part => parseInt(part, 10));
    const bParts = b.split('.').map(part => parseInt(part, 10));
  
    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) {
        return aParts[i] - bParts[i];
      }
    }
    return 0;
  });
  return {
    uniqueIPs: sortedIPs,
    results: results
  };
}
// 获取URL的友好名称
function getSourceName(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname : '');
  } catch (e) {
    return url;
  }
}
// 带超时的fetch
async function fetchURLWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-IP-Collector/1.0)',
        'Accept': 'text/html,application/json,text/plain,*/*'
      }
    });
  
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}
// 从 KV 获取存储的 IPs
async function getStoredIPs(env) {
  try {
    if (!env.IP_STORAGE) {
      console.error('KV namespace IP_STORAGE is not bound');
      return getDefaultData();
    }
  
    const data = await env.IP_STORAGE.get('cloudflare_ips');
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading from KV:', error);
  }

  return getDefaultData();
}
// 从 KV 获取存储的测速IPs
async function getStoredSpeedIPs(env) {
  try {
    if (!env.IP_STORAGE) {
      console.error('KV namespace IP_STORAGE is not bound');
      return getDefaultSpeedData();
    }
  
    const data = await env.IP_STORAGE.get('cloudflare_fast_ips');
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading speed IPs from KV:', error);
  }

  return getDefaultSpeedData();
}
// 默认数据
function getDefaultData() {
  return {
    ips: [],
    lastUpdated: null,
    count: 0,
    sources: []
  };
}
// 默认测速数据
function getDefaultSpeedData() {
  return {
    fastIPs: [],
    lastTested: null,
    count: 0
  };
}
// IPv4地址验证
function isValidIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    // 排除私有IP段
    if (part.startsWith('0') && part.length > 1) return false;
  }

  // 排除私有地址
  if (ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      (ip.startsWith('172.') && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) ||
      ip.startsWith('127.') ||
      ip.startsWith('169.254.') ||
      ip === '255.255.255.255') {
    return false;
  }

  return true;
}
// 工具函数
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
function handleCORS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}


