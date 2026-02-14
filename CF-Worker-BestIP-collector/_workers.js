// V2.10 版本：Cloudflare 原生测速生成优质 IP 列表

const FAST_IP_COUNT = 25;

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
      // 定时测速
      try {
        await runItdogBatchPing(env, uniqueIPs);
        console.log('Scheduled ITDog batch ping completed');
      } catch (speedErr) {
        console.error('Scheduled ITDog batch ping failed:', speedErr);
      }
      console.log(`Scheduled update: ${uniqueIPs.length} IPs collected`);
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
        case '/fast-ips.txt':
          return await handleGetFastIPs(env, request);
        case '/itdog-data':
          return await handleItdogData(env, request);
        case '/itdog-batch-ping':
          if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);
          return await handleItdogBatchPing(env, request);
        case '/itdog-batch-ping-result':
          return await handleItdogBatchPingResult(env, request);
        default:
          return jsonResponse({ error: 'Endpoint not found' }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  }
};

// 提供HTML页面
async function serveHTML(env, request) {
  const data = await getStoredIPs(env);
  const fastData = await getStoredFastIPs(env);

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
            text-align: center;
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
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 头部区域 -->
        <div class="header">
            <div class="header-content">
            <h1 style="text-align: center;">Cloudflare 优选IP</h1>
            <p style="text-align: center;">自动定时拉取IP + ITDog批量Ping</p>
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
                    <div class="stat-value" id="fast-ip-count">${fastData.count || 0}</div>
                    <div>优质 IP 数量</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="last-updated">${data.lastUpdated ? '已更新' : '未更新'}</div>
                    <div>最后更新</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="last-time">\${data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : '从未更新'}</div>
                    <div>更新时间</div>
                </div>
            </div>
          
            <div class="button-group">
                <button class="button" onclick="updateIPs()" id="update-btn">
                    🔄 立即更新
                </button>

                <!-- 下载按钮组 -->
                <div class="dropdown">
                    <a href="/ips" class="button button-success dropdown-btn" download="cloudflare_ips.txt">
                        📥 下载IP列表
                    </a>
                </div>

                <!-- 查看按钮组 -->
                <a href="/ip.txt" class="button button-secondary" target="_blank">
                    📋 查看IP列表
                </a>

                <!-- 优质IP按钮组 -->
                <a href="/fast-ips.txt" class="button button-success" download="fast_ips.txt">
                    ⚡ 下载优质IP
                </a>
                <a href="/fast-ips.txt" class="button button-secondary" target="_blank">
                    📋 查看优质IP
                </a>

                <button class="button button-warning" onclick="startItdogPing()" id="itdog-btn">
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
        <!-- ITDog 批量 Ping 结果卡片 -->
        <div class="card">
            <div class="ip-list-header">
                <h2>🌐 ITDog 批量 Ping</h2>
                <div>
                    <button class="small-btn" onclick="startItdogPing()" id="itdog-ping-btn">🚀 开始测试</button>
                    <button class="small-btn" onclick="copyItdogResults()" id="itdog-copy-btn" style="display:none;">📋 复制结果</button>
                </div>
            </div>
            <div class="speed-test-progress" id="itdog-progress">
                <div class="speed-test-progress-bar" id="itdog-progress-bar"></div>
            </div>
            <div style="text-align: center; margin: 8px 0; font-size: 0.9rem; color: #64748b;" id="itdog-status"></div>
            <div class="ip-list" id="itdog-results">
                <p style="text-align: center; color: #64748b; padding: 20px;">加载中...</p>
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
        <p>Cloudflare IP Collector &copy; ${new Date().getFullYear()}</p>
        </div>
    </div>
    <script>
        // JavaScript 代码
        async function startItdogPing() {
            const btn = document.getElementById('itdog-ping-btn');
            const progress = document.getElementById('itdog-progress');
            const progressBar = document.getElementById('itdog-progress-bar');
            const status = document.getElementById('itdog-status');
            const resultsDiv = document.getElementById('itdog-results');
            const copyBtn = document.getElementById('itdog-copy-btn');

            btn.disabled = true;
            btn.textContent = '测试中...';
            progress.style.display = 'block';
            progressBar.style.width = '30%';
            status.textContent = '正在连接 ITDog 服务器并发起批量 Ping...';
            resultsDiv.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">正在测试，请稍候（最多约25秒）...</p>';
            copyBtn.style.display = 'none';

            try {
                const response = await fetch('/itdog-batch-ping', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({})
                });
                progressBar.style.width = '100%';
                const data = await response.json();

                if (!response.ok || !data.success) {
                    throw new Error(data.error || '测试失败');
                }

                status.textContent = '测试完成！共 ' + data.ipCount + ' 个 IP，收到 ' + data.resultCount + ' 条结果';
                renderItdogResults(data.results);
                copyBtn.style.display = 'inline-flex';
            } catch (error) {
                status.textContent = '测试失败: ' + error.message;
                resultsDiv.innerHTML = '<p style="text-align:center;color:#ef4444;padding:20px;">' + error.message + '</p>';
            } finally {
                btn.disabled = false;
                btn.textContent = '🚀 开始测试';
                setTimeout(() => { progress.style.display = 'none'; }, 2000);
            }
        }

        function renderItdogResults(results) {
            const resultsDiv = document.getElementById('itdog-results');
            if (!results || results.length === 0) {
                resultsDiv.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">未收到测试结果</p>';
                return;
            }

            // 按 IP (taskNum) 分组，每个 IP 汇总各节点的 ping 结果
            const ipMap = {};
            results.forEach(r => {
                const key = r.taskNum || r.ip;
                if (!ipMap[key]) {
                    ipMap[key] = { ip: r.ip, nodes: [] };
                }
                ipMap[key].nodes.push(r);
            });

            let html = '';
            Object.values(ipMap).forEach(group => {
                const validPings = group.nodes.filter(n => n.result >= 0);
                const avgLatency = validPings.length > 0
                    ? Math.round(validPings.reduce((s, n) => s + n.result, 0) / validPings.length)
                    : -1;
                const lossRate = group.nodes.length > 0
                    ? Math.round((group.nodes.length - validPings.length) / group.nodes.length * 100)
                    : 100;
                const speedClass = avgLatency >= 0 && avgLatency < 100 ? 'speed-fast' : avgLatency < 300 ? 'speed-medium' : 'speed-slow';

                html += '<div class="ip-item" data-ip="' + group.ip + '">';
                html += '  <div class="ip-info">';
                html += '    <span class="ip-address">' + group.ip + '</span>';
                if (avgLatency >= 0) {
                    html += '    <span class="speed-result ' + speedClass + '">' + avgLatency + 'ms</span>';
                } else {
                    html += '    <span class="speed-result speed-slow">超时</span>';
                }
                html += '    <span class="speed-result" style="color:#64748b;">丢包 ' + lossRate + '%</span>';
                html += '    <span class="speed-result" style="color:#94a3b8;font-size:0.8rem;">' + validPings.length + '/' + group.nodes.length + ' 节点</span>';
                html += '  </div>';
                html += '  <div class="action-buttons">';
                html += '    <button class="small-btn" onclick="copyIP(\\'' + group.ip + '\\')">复制</button>';
                html += '  </div>';
                html += '</div>';
            });

            resultsDiv.innerHTML = html;
        }

        async function copyItdogResults() {
            try {
                const resp = await fetch('/itdog-batch-ping-result');
                const data = await resp.json();
                if (!data.results || data.results.length === 0) {
                    showMessage('暂无 ITDog 结果', 'error');
                    return;
                }
                // 按 IP 分组汇总
                const ipMap = {};
                data.results.forEach(r => {
                    const key = r.taskNum || r.ip;
                    if (!ipMap[key]) ipMap[key] = { ip: r.ip, pings: [] };
                    if (r.result >= 0) ipMap[key].pings.push(r.result);
                });
                const lines = Object.values(ipMap).map(g => {
                    const avg = g.pings.length > 0 ? Math.round(g.pings.reduce((a,b)=>a+b,0)/g.pings.length) : -1;
                    return avg >= 0 ? g.ip + '#' + avg + 'ms' : g.ip + '#超时';
                });
                await navigator.clipboard.writeText(lines.join('\\n'));
                showMessage('已复制 ' + lines.length + ' 条 ITDog 结果');
            } catch (e) {
                showMessage('复制失败', 'error');
            }
        }

        function copyIP(ip) {
            navigator.clipboard.writeText(ip).then(() => {
                showMessage(\`已复制 IP: \${ip}\`);
            }).catch(err => {
                showMessage('复制失败，请手动复制', 'error');
            });
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
                const [rawResp, fastResp] = await Promise.all([
                    fetch('/raw'),
                    fetch('/itdog-batch-ping-result')
                ]);
                const data = await rawResp.json();

                document.getElementById('ip-count').textContent = data.count || 0;
                document.getElementById('last-updated').textContent = data.lastUpdated ? '已更新' : '未更新';
                document.getElementById('last-time').textContent = data.lastUpdated ?
                    new Date(data.lastUpdated).toLocaleTimeString() : '从未更新';

                // 更新优质 IP 数量
                try {
                    const fastData = await fastResp.json();
                    if (fastData.results && fastData.results.length > 0) {
                        // 计算有效 IP 数（有 ping 结果的）
                        const ipMap = {};
                        fastData.results.forEach(r => {
                            const key = r.taskNum || r.ip;
                            if (!ipMap[key]) ipMap[key] = { pings: [] };
                            if (r.result >= 0) ipMap[key].pings.push(r.result);
                        });
                        const validCount = Math.min(Object.values(ipMap).filter(g => g.pings.length > 0).length, ${FAST_IP_COUNT});
                        document.getElementById('fast-ip-count').textContent = validCount;
                    }
                } catch (e) {}

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
      
        async function loadItdogResults() {
            const status = document.getElementById('itdog-status');
            const resultsDiv = document.getElementById('itdog-results');
            const copyBtn = document.getElementById('itdog-copy-btn');
            try {
                const resp = await fetch('/itdog-batch-ping-result');
                const data = await resp.json();
                if (data.results && data.results.length > 0) {
                    const time = data.lastTested ? new Date(data.lastTested).toLocaleString() : '未知';
                    status.textContent = '上次测试: ' + time + ' | ' + data.ipCount + ' 个 IP，' + data.nodeCount + ' 条结果';
                    renderItdogResults(data.results);
                    copyBtn.style.display = 'inline-flex';
                } else {
                    resultsDiv.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">暂无 ITDog 测试结果，点击"开始测试"或等待定时任务自动执行</p>';
                }
            } catch (e) {
                resultsDiv.innerHTML = '<p style="text-align: center; color: #64748b; padding: 20px;">暂无 ITDog 测试结果</p>';
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            refreshData();
            loadItdogResults();
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

// 处理 ITDog 数据获取
async function handleItdogData(env, request) {
  const data = await getStoredIPs(env);
  return jsonResponse({
    ips: data.ips || [],
    count: data.count || 0
  });
}

// ========== ITDog 批量 Ping 服务端实现 ==========


// 简易 MD5 实现
function md5(string) {
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function md5blk(s) {
    var md5blks = [], i;
    for (i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function rhex(n) {
    var s = '', j = 0;
    for (; j < 4; j++) s += '0123456789abcdef'.charAt((n >> (j * 8 + 4)) & 0x0F) + '0123456789abcdef'.charAt((n >> (j * 8)) & 0x0F);
    return s;
  }
  function hex(x) { for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]); return x.join(''); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function md5str(s) {
    var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    var tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) { md5cycle(state, tail); tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]; }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  return hex(md5str(string));
}

const ITDOG_SALT = 'token_20230313000136kwyktxb0tgspm00yo5';

// 默认测速节点（三网北上广深 + 海外常用）
const ITDOG_DEFAULT_NODES = '1310,1273,1250,1227,1254,1249,1169,1278,1290,1315,1316,1213';

// ITDog 批量 Ping 核心逻辑（可被 cron 和 HTTP handler 共用）
async function runItdogBatchPing(env, ips) {
  // ITDog 限制，最多 200 个 IP
  ips = ips.slice(0, 200);
  const ipStr = ips.join('\r\n');

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0';

  const formData = new URLSearchParams({
    host: ipStr,
    node_id: ITDOG_DEFAULT_NODES,
    cidr_filter: 'false',
    gateway: 'last'
  }).toString();

  // POST 创建任务（ITDog 已取消 guard cookie，只需 machine_code）
  const resp = await fetch('https://www.itdog.cn/batch_ping/', {
    method: 'POST',
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'zh-CN,zh;q=0.9',
      'cache-control': 'max-age=0',
      'content-type': 'application/x-www-form-urlencoded',
      'origin': 'https://www.itdog.cn',
      'referer': 'https://www.itdog.cn/batch_ping/',
      'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Microsoft Edge";v="144"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': ua,
      'cookie': 'machine_code=false_false_',
    },
    body: formData,
  });

  const html = await resp.text();
  const wssMatch = html.match(/var\s+wss_url='([^']+)'/);
  const taskMatch = html.match(/var\s+task_id='([^']+)'/);

  if (!wssMatch || !taskMatch) {
    // 提取页面中的关键信息用于诊断
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const title = titleMatch ? titleMatch[1] : '无title';
    // 检查是否有错误提示或验证码
    const alertMatch = html.match(/alert\(['"]([^'"]+)['"]\)/);
    const alert = alertMatch ? alertMatch[1] : '';
    // 截取 body 开头的文本内容
    const bodyMatch = html.match(/<body[^>]*>([\s\S]{0,300})/);
    const bodySnippet = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 200) : '';
    console.error('ITDog 响应诊断 - title:', title, 'alert:', alert, 'bodySnippet:', bodySnippet);
    console.error('ITDog 响应内容（前1000字符）:', html.substring(0, 1000));
    throw new Error(`ITDog 任务创建失败。状态: ${resp.status}，长度: ${html.length}，title: ${title}${alert ? '，alert: ' + alert : ''}${bodySnippet ? '，内容: ' + bodySnippet.substring(0, 100) : ''}`);
  }

  return await finishItdogPing(env, ips, wssMatch[1], taskMatch[1]);
}

// ITDog ping 后续处理：WebSocket 收集 + 存储结果
async function finishItdogPing(env, ips, wssUrl, taskId) {
  const taskToken = md5(taskId + ITDOG_SALT).substring(8, 24);

  // 通过 WebSocket 收集 ping 结果
  const pingResults = await collectPingResults(wssUrl, taskId, taskToken);

  // 存储结果到 KV
  const resultData = {
    ips: ips,
    results: pingResults,
    lastTested: new Date().toISOString(),
    ipCount: ips.length,
    nodeCount: pingResults.length
  };
  await env.IP_STORAGE.put('itdog_ping_results', JSON.stringify(resultData));

  // 根据 ITDog 结果计算并存储优质 IP
  await computeAndStoreFastIPs(env, pingResults);

  return resultData;
}

// 根据 ITDog ping 结果计算优质 IP（按平均延迟从小到大，取前25个）
async function computeAndStoreFastIPs(env, pingResults) {
  const ipMap = {};
  pingResults.forEach(r => {
    const key = r.taskNum || r.ip;
    if (!ipMap[key]) ipMap[key] = { ip: r.ip, pings: [] };
    if (r.result >= 0) ipMap[key].pings.push(r.result);
  });

  // 计算每个 IP 的平均延迟，过滤掉全部超时的 IP
  const ipStats = Object.values(ipMap)
    .filter(g => g.pings.length > 0)
    .map(g => ({
      ip: g.ip,
      avgLatency: Math.round(g.pings.reduce((a, b) => a + b, 0) / g.pings.length),
      nodeCount: g.pings.length
    }))
    .sort((a, b) => a.avgLatency - b.avgLatency)
    .slice(0, FAST_IP_COUNT);

  await env.IP_STORAGE.put('cloudflare_fast_ips', JSON.stringify({
    ips: ipStats,
    lastUpdated: new Date().toISOString(),
    count: ipStats.length
  }));

  return ipStats;
}

// 处理获取优质 IP 列表（纯文本，每行一个 IP，按延迟排序）
async function handleGetFastIPs(env, request) {
  try {
    const data = await env.IP_STORAGE.get('cloudflare_fast_ips');
    if (data) {
      const parsed = JSON.parse(data);
      const lines = (parsed.ips || []).map(item => item.ip);
      return new Response(lines.join('\n'), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'inline; filename="fast_ips.txt"',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    return new Response('', {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// 处理 ITDog 批量 Ping HTTP 请求
async function handleItdogBatchPing(env, request) {
  try {
    const body = await request.json();
    let ips = body.ips;
    if (!ips || ips.length === 0) {
      const data = await getStoredIPs(env);
      ips = data.ips || [];
    }
    if (ips.length === 0) {
      return jsonResponse({ error: '没有可用的 IP 地址' }, 400);
    }

    const resultData = await runItdogBatchPing(env, ips);

    return jsonResponse({
      success: true,
      message: 'ITDog 批量 Ping 完成',
      ipCount: resultData.ipCount,
      resultCount: resultData.nodeCount,
      results: resultData.results
    });
  } catch (error) {
    console.error('ITDog batch ping error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

// WebSocket 收集 ITDog ping 结果
async function collectPingResults(wssUrl, taskId, taskToken) {
  const results = [];

  // Cloudflare Workers 使用 fetch + WebSocket upgrade
  const wsResp = await fetch(wssUrl, {
    headers: {
      'Upgrade': 'websocket',
    }
  });

  const ws = wsResp.webSocket;
  if (!ws) {
    throw new Error('WebSocket 连接失败');
  }

  ws.accept();

  // 发送认证
  ws.send(JSON.stringify({ task_id: taskId, task_token: taskToken }));

  // 收集结果，使用 Promise 等待完成
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      resolve(results);
    }, 25000); // 25 秒超时（Worker 限制 30 秒）

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'finished') {
          clearTimeout(timeout);
          ws.close();
          resolve(results);
          return;
        }

        if (msg.type === 'node_error') {
          return;
        }

        // 收集 ping 结果
        if (msg.node_id) {
          results.push({
            nodeId: msg.node_id,
            nodeName: msg.name || '',
            ip: msg.ip || '',
            address: msg.address || '',
            result: parseInt(msg.result) || -1,
            taskNum: msg.task_num || 0
          });
        }
      } catch (e) {
        // 忽略解析错误
      }
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve(results);
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timeout);
      resolve(results);
    });
  });
}

// 获取 ITDog 批量 Ping 结果（从 KV 读取）
async function handleItdogBatchPingResult(env, request) {
  try {
    const data = await env.IP_STORAGE.get('itdog_ping_results');
    if (data) {
      return jsonResponse(JSON.parse(data));
    }
    return jsonResponse({ results: [], message: '暂无 ITDog 测试结果' });
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
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
    return jsonResponse({
      success: true,
      message: 'IPs collected successfully',
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
// 从 KV 获取存储的优质 IPs
async function getStoredFastIPs(env) {
  try {
    if (!env.IP_STORAGE) return { ips: [], count: 0, lastUpdated: null };
    const data = await env.IP_STORAGE.get('cloudflare_fast_ips');
    if (data) return JSON.parse(data);
  } catch (error) {
    console.error('Error reading fast IPs from KV:', error);
  }
  return { ips: [], count: 0, lastUpdated: null };
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


