// ==UserScript==
// @name         GitHub Xget 下载加速器 - 增强优化版
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  自动加速 GitHub、GitLab、Gitea 等平台的文件下载,支持多平台和自定义加速域名，增强版功能 | UP：毕加索自画像
// @author       Xget | Enhanced & Optimized by 毕加索自画像
// @match        https://github.com/*
// @match        https://gist.github.com/*
// @match        https://gitlab.com/*
// @match        https://gitea.com/*
// @match        https://codeberg.org/*
// @match        https://sourceforge.net/*
// @match        https://android.googlesource.com/*
// @match        https://huggingface.co/*
// @match        https://civitai.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @grant        GM_setValue
// @grant        GM_setValues
// @grant        GM_getValue
// @grant        GM_getValues
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // 配置项
    const CONFIG = {
        // 默认加速域名
        defaultDomain: 'xget.xi-xu.me',
        // 是否启用加速
        enabled: GM_getValue('xget_enabled', true),
        // 自定义加速域名
        customDomain: GM_getValue('xget_custom_domain', ''),
        // 是否显示通知
        showNotification: GM_getValue('xget_show_notification', true),
        // 统计数据
        stats: GM_getValue('xget_stats', { total: 0, success: 0, failed: 0 }),
        // 白名单模式（false 为黑名单模式）
        whitelistMode: GM_getValue('xget_whitelist_mode', false),
        // 排除列表（域名或路径模式）
        excludeList: GM_getValue('xget_exclude_list', []),
        // 是否自动检测加速服务可用性
        autoCheck: GM_getValue('xget_auto_check', true),
        // 服务器状态缓存（避免频繁检测）
        serverStatus: GM_getValue('xget_server_status', { available: true, lastCheck: 0 }),
        // 调试模式
        debug: GM_getValue('xget_debug', false),
        // 最大重试次数
        maxRetries: GM_getValue('xget_max_retries', 2),
        // 强力拦截模式（会调用 stopImmediatePropagation，和旧版本保持一致）
        strongIntercept: GM_getValue('xget_strong_intercept', true)
    };

    // 可下载文件扩展名白名单
    const DOWNLOAD_EXTENSIONS = [
        // 压缩包
        'zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'xz', 'tgz',
        // 安装包
        'exe', 'dmg', 'deb', 'rpm', 'msi', 'pkg', 'apk', 'appimage',
        // 模型文件
        'bin', 'safetensors', 'pt', 'pth', 'ckpt', 'h5', 'onnx', 'pb', 'model',
        // 其他
        'iso', 'img', 'jar', 'war'
    ];

    // 平台配置（添加前缀和下载 URL 模式）
    const PLATFORM_CONFIG = {
        'github.com': {
            prefix: 'gh',
            name: 'GitHub',
            patterns: [
                /\/releases\/download\//,
                /\/archive\/.*\.(zip|tar\.gz|tar)$/,
                /\/raw\//,
                /\/.*\/.*\/.*\.(exe|dmg|deb|rpm|msi|pkg|apk|zip|tar\.gz|tar\.bz2|7z|rar)$/
            ]
        },
        // GitHub 源码包下载（Download ZIP / tarball）
        'codeload.github.com': {
            prefix: 'gh',
            name: 'GitHub',
            patterns: [
                /\/zip\//,
                /\/tar\.gz\//,
                /\/tar\//
            ]
        },
        // GitHub Raw 文件下载（raw host 基本都是文件内容）
        'raw.githubusercontent.com': {
            prefix: 'gh',
            name: 'GitHub',
            patterns: [
                /.*/
            ]
        },
        // GitHub Release 资产下载（常见会跳到 objects host）
        'objects.githubusercontent.com': {
            prefix: 'gh',
            name: 'GitHub',
            patterns: [
                /.*/
            ]
        },
        'gist.github.com': {
            prefix: 'gist',
            name: 'GitHub Gist',
            patterns: [
                /\/raw\//,
                /\/download/
            ]
        },
        'gitlab.com': {
            prefix: 'gl',
            name: 'GitLab',
            patterns: [
                /\/-\/archive\//,
                /\/-\/project\/.*\/uploads\//,
                /\/uploads\//
            ]
        },
        'gitea.com': {
            prefix: 'gitea',
            name: 'Gitea',
            patterns: [
                /\/archive\//,
                /\/raw\//,
                /\/releases\/download\//
            ]
        },
        'codeberg.org': {
            prefix: 'codeberg',
            name: 'Codeberg',
            patterns: [
                /\/archive\//,
                /\/raw\//,
                /\/releases\/download\//
            ]
        },
        'sourceforge.net': {
            prefix: 'sf',
            name: 'SourceForge',
            patterns: [
                /\/files\//,
                /\/downloads\//
            ]
        },
        'android.googlesource.com': {
            prefix: 'aosp',
            name: 'AOSP',
            patterns: [
                /\/\+archive\//
            ]
        },
        'huggingface.co': {
            prefix: 'hf',
            name: 'Hugging Face',
            patterns: [
                /\/resolve\//,
                /\/.*\/.*\/(blob|resolve)\/.*\.(bin|safetensors|pt|pth|ckpt|h5|onnx|pb|model)$/
            ]
        },
        'civitai.com': {
            prefix: 'civitai',
            name: 'Civitai',
            patterns: [
                /\/api\/download\//
            ]
        }
    };

    // 调试日志
    function debugLog(...args) {
        if (CONFIG.debug) {
            console.log('[Xget Debug]', new Date().toLocaleTimeString(), ...args);
        }
    }

    // 节流函数
    function throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // 防抖函数
    function debounce(func, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // 统计落盘（防止频繁写入存储）
    const saveStatsDebounced = debounce(() => {
        try {
            if (typeof GM_setValues === 'function') {
                GM_setValues({ xget_stats: CONFIG.stats });
            } else {
                GM_setValue('xget_stats', CONFIG.stats);
            }
        } catch (e) {
            // 回退到单值写入
            GM_setValue('xget_stats', CONFIG.stats);
        }
    }, 600);

    // 指示器内容更新
    function renderIndicator() {
        const el = CONFIG._indicatorEl;
        if (!el) return;
        el.innerHTML = `
            <div style="font-weight: 700; font-size: 13px;">🚀 Xget 加速已启用</div>
        `;
    }

    // 获取当前使用的加速域名
    function getAcceleratorDomain() {
        return CONFIG.customDomain || CONFIG.defaultDomain;
    }

    // 获取当前平台配置
    function getCurrentPlatform() {
        const hostname = window.location.hostname;
        return PLATFORM_CONFIG[hostname];
    }

    // 编译排除规则
    function compileExcludeMatchers(list) {
        const matchers = [];
        for (const raw of (list || [])) {
            const pattern = String(raw || '').trim();
            if (!pattern) continue;

            // 支持 /.../flags 形式
            if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                const lastSlash = pattern.lastIndexOf('/');
                const body = pattern.slice(1, lastSlash);
                const flags = pattern.slice(lastSlash + 1);
                try {
                    matchers.push({ type: 'regex', raw: pattern, re: new RegExp(body, flags) });
                    continue;
                } catch (e) {
                    debugLog('排除规则正则解析失败，降级为包含匹配:', pattern, e);
                }
            }

            // 支持直接 RegExp 字符串（不带 / /）
            try {
                matchers.push({ type: 'regex', raw: pattern, re: new RegExp(pattern) });
            } catch {
                matchers.push({ type: 'substr', raw: pattern, s: pattern });
            }
        }
        return matchers;
    }

    function refreshExcludeMatchers() {
        CONFIG._excludeMatchers = compileExcludeMatchers(CONFIG.excludeList);
    }

    // 判断是否在排除列表中
    function isExcluded(url) {
        const matchers = CONFIG._excludeMatchers || [];
        return matchers.some(m => {
            if (m.type === 'regex') return m.re.test(url);
            return url.includes(m.s);
        });
    }

    // 检查是否为可下载文件扩展名
    function hasDownloadableExtension(pathname) {
        const lowerPath = pathname.toLowerCase();
        return DOWNLOAD_EXTENSIONS.some(ext => lowerPath.endsWith('.' + ext));
    }

    // 下载链接检测 - 优化版
    function isDownloadLink(url, element) {
        try {
            const urlObj = new URL(url);
            const platform = PLATFORM_CONFIG[urlObj.hostname];

            if (!platform) {
                debugLog('平台不支持:', urlObj.hostname);
                return false;
            }

            // 检查是否在排除列表中
            if (isExcluded(url)) {
                debugLog('URL 在排除列表中:', url);
                return false;
            }

            // 检查元素是否有 download 属性
            if (element && (element.download || element.hasAttribute('download'))) {
                debugLog('检测到 download 属性');
                return true;
            }

            // 检查文件扩展名
            const hasValidExt = hasDownloadableExtension(urlObj.pathname);

            // 使用平台特定的正则模式匹配
            const matchesPattern = platform.patterns.some(pattern => pattern.test(urlObj.pathname));

            // 改为 OR：pattern 命中或扩展名命中即认为是下载（减少漏判）
            const isDownload = matchesPattern || hasValidExt;
            debugLog('链接检测结果:', { url, hasValidExt, matchesPattern, isDownload });

            return isDownload;
        } catch (e) {
            debugLog('链接检测错误:', e);
            return false;
        }
    }

    // 转换 URL 为加速 URL
    function convertToAcceleratorURL(originalUrl) {
        try {
            const url = new URL(originalUrl);
            const platform = PLATFORM_CONFIG[url.hostname];

            if (!platform) {
                debugLog('无法转换: 平台不支持');
                return originalUrl;
            }

            // 移除原始域名,保留路径和查询参数
            const pathAndQuery = url.pathname + url.search + url.hash;

            // 构建加速 URL
            const acceleratorDomain = getAcceleratorDomain();
            const acceleratedUrl = `https://${acceleratorDomain}/${platform.prefix}${pathAndQuery}`;

            debugLog('URL 转换:', { 
                original: originalUrl, 
                accelerated: acceleratedUrl 
            });

            return acceleratedUrl;
        } catch (e) {
            console.error('URL 转换失败:', e);
            return originalUrl;
        }
    }

    // 带重试的 URL 转换
    async function convertWithRetry(originalUrl) {
        const maxRetries = CONFIG.maxRetries;
        let lastError = null;

        for (let i = 0; i <= maxRetries; i++) {
            try {
                const convertedUrl = convertToAcceleratorURL(originalUrl);

                // 验证转换后的URL是否有效
                if (convertedUrl && convertedUrl !== originalUrl) {
                    debugLog(`URL 转换成功 (尝试 ${i + 1}/${maxRetries + 1})`);
                    return convertedUrl;
                }

                throw new Error('转换结果无效');
            } catch (e) {
                lastError = e;
                debugLog(`URL 转换重试 ${i + 1}/${maxRetries + 1}:`, e);

                // 等待一小段时间再重试
                if (i < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        }

        console.error('URL 转换最终失败:', lastError);
        return originalUrl;
    }

    // 检测加速服务器可用性 - 优化版
    async function checkServerAvailability() {
        // 如果最近 5 分钟内检查过，使用缓存结果
        const now = Date.now();
        if (now - CONFIG.serverStatus.lastCheck < 5 * 60 * 1000) {
            debugLog('使用缓存的服务器状态:', CONFIG.serverStatus.available);
            return CONFIG.serverStatus.available;
        }

        try {
            const domain = getAcceleratorDomain();
            // 使用一个真实的小文件测试（GitHub 的 robots.txt）
            const testUrl = `https://${domain}/gh/robots.txt`;

            debugLog('开始检测服务器可用性:', testUrl);

            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    debugLog('服务器检测超时');
                    updateServerStatus(false);
                    resolve(false);
                }, 3000);

                GM_xmlhttpRequest({
                    method: 'GET',
                    headers: {
                        'Range': 'bytes=0-0',
                        'Cache-Control': 'no-cache'
                    },
                    url: testUrl,
                    timeout: 3000,
                    onload: function(response) {
                        clearTimeout(timeout);
                        // 更严格的状态码判断（Range 可能返回 206）
                        const available = (response.status >= 200 && response.status < 400) || response.status === 206;
                        debugLog('服务器响应:', { status: response.status, available });
                        updateServerStatus(available);
                        resolve(available);
                    },
                    onerror: function(error) {
                        clearTimeout(timeout);
                        debugLog('服务器检测错误:', error);
                        updateServerStatus(false);
                        resolve(false);
                    },
                    ontimeout: function() {
                        clearTimeout(timeout);
                        debugLog('服务器检测超时');
                        updateServerStatus(false);
                        resolve(false);
                    }
                });
            });
        } catch (e) {
            console.error('服务器可用性检查失败:', e);
            updateServerStatus(false);
            return false;
        }
    }

    // 更新服务器状态缓存
    function updateServerStatus(available) {
        CONFIG.serverStatus = { available, lastCheck: Date.now() };
        GM_setValue('xget_server_status', CONFIG.serverStatus);
        debugLog('服务器状态已更新:', CONFIG.serverStatus);

        // 同步更新指示器
        renderIndicator();
    }

    // 更新统计数据
    function updateStats(success) {
        CONFIG.stats.total++;
        if (success) {
            CONFIG.stats.success++;
        } else {
            CONFIG.stats.failed++;
        }

        // 防抖写入，减少存储 IO
        saveStatsDebounced();
        debugLog('统计数据已更新:', CONFIG.stats);

        // 同步更新指示器
        renderIndicator();
    }

    // 显示通知
    function showNotification(message, type = 'info', duration = 3000) {
        if (!CONFIG.showNotification) return;

        const colors = {
            success: '#10b981',
            info: '#3b82f6',
            warning: '#f59e0b',
            error: '#ef4444'
        };

        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${colors[type] || colors.info};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            z-index: 10000;
            font-size: 14px;
            max-width: 300px;
            animation: slideIn 0.3s ease-out;
            cursor: pointer;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;
        notification.textContent = message;

        // 点击关闭
        notification.addEventListener('click', () => {
            notification.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => notification.remove(), 300);
        });

        // 添加动画样式
        if (!document.getElementById('xget-notification-style')) {
            const style = document.createElement('style');
            style.id = 'xget-notification-style';
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateX(400px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }

    // 拦截下载链接 - 核心功能
    function interceptDownloadLinks() {
        const platform = getCurrentPlatform();
        if (!platform || !CONFIG.enabled) return;

        debugLog('开始拦截下载链接:', platform.name);

        // 使用节流优化性能
        const handleClick = throttle(async function(e) {
            // 仅拦截普通左键点击；避免影响 Ctrl/⌘/Shift 打开新标签等行为
            if (e.button !== 0) return;
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

            // 使用 closest 更高效地查找链接元素
            const target = e.target.closest('a[href]');

            if (!target?.href) return;

            const href = target.href;

            // 精确检测是否为下载链接
            if (!isDownloadLink(href, target)) return;

            debugLog('检测到下载链接:', href);

            // 如果启用了自动检测，先检查服务器可用性
            if (CONFIG.autoCheck) {
                const available = await checkServerAvailability();
                if (!available) {
                    showNotification('⚠️ 加速服务暂不可用，使用原始链接下载', 'warning');
                    updateStats(false);
                    return; // 不拦截，使用原始链接
                }
            }

            // 阻止默认行为和事件传播
            e.preventDefault();
            e.stopPropagation();
            if (CONFIG.strongIntercept) {
                e.stopImmediatePropagation();
            }

            const acceleratedUrl = await convertWithRetry(href);

            if (acceleratedUrl !== href) {
                showNotification(`🚀 已启用 ${platform.name} 加速下载`, 'success', 2000);
                updateStats(true);

                // 创建隐藏链接并触发
                const link = document.createElement('a');
                link.href = acceleratedUrl;
                link.download = target.download || '';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                showNotification('⚠️ URL 转换失败，使用原始链接', 'warning');
                updateStats(false);
                window.open(href, '_blank', 'noopener,noreferrer');
            }
        }, 300);

        // 使用捕获阶段确保最先处理
        document.addEventListener('click', handleClick, true);
        debugLog('事件监听器已注册');
    }

    // 添加页面指示器 - 增强版
    function addPageIndicator() {
        const platform = getCurrentPlatform();
        if (!platform || !CONFIG.enabled) return;

        const indicator = document.createElement('div');
        indicator.id = 'xget-indicator';
        indicator.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 10px 15px;
            background: rgba(16, 185, 129, 0.95);
            color: white;
            border-radius: 8px;
            font-size: 12px;
            z-index: 9999;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            cursor: pointer;
            transition: all 0.3s;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        // 保存指示器引用
        CONFIG._indicatorEl = indicator;

        // 初始渲染指示器内容
        renderIndicator();

        indicator.addEventListener('mouseenter', () => {
            indicator.style.transform = 'scale(1.05)';
            indicator.style.background = 'rgba(16, 185, 129, 1)';
        });

        indicator.addEventListener('mouseleave', () => {
            indicator.style.transform = 'scale(1)';
            indicator.style.background = 'rgba(16, 185, 129, 0.95)';
        });

        indicator.addEventListener('click', () => {
            const stats = CONFIG.stats;
            const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
            showNotification(
                `域名: ${getAcceleratorDomain()}\n总计: ${stats.total} | 成功: ${stats.success} | 失败: ${stats.failed}\n成功率: ${successRate}%`,
                'info',
                5000
            );
        });

        document.body.appendChild(indicator);

        // 服务器状态指示
        if (!CONFIG.serverStatus.available) {
            const statusDot = document.createElement('div');
            statusDot.style.cssText = `
                position: absolute;
                top: 5px;
                right: 5px;
                width: 8px;
                height: 8px;
                background: #ef4444;
                border-radius: 50%;
                animation: pulse 2s infinite;
            `;
            indicator.appendChild(statusDot);

            if (!document.getElementById('xget-pulse-style')) {
                const pulseStyle = document.createElement('style');
                pulseStyle.id = 'xget-pulse-style';
                pulseStyle.textContent = `
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.5; }
                    }
                `;
                document.head.appendChild(pulseStyle);
            }
        }
        
        debugLog('页面指示器已添加');

    }

    // 设置菜单命令 - 增强版
    function setupMenuCommands() {
        // 切换启用/禁用
        GM_registerMenuCommand(CONFIG.enabled ? '❌ 禁用加速' : '✅ 启用加速', function() {
            CONFIG.enabled = !CONFIG.enabled;
            GM_setValue('xget_enabled', CONFIG.enabled);
            showNotification(CONFIG.enabled ? '加速已启用' : '加速已禁用', 'success');
            location.reload();
        });

        // 设置自定义域名
        GM_registerMenuCommand('⚙️ 设置加速域名', function() {
            const domain = prompt('请输入自定义加速域名 (留空使用默认域名):', CONFIG.customDomain);
            if (domain !== null) {
                CONFIG.customDomain = domain.trim();
                GM_setValue('xget_custom_domain', CONFIG.customDomain);
                // 重置服务器状态，下次会重新检测
                CONFIG.serverStatus.lastCheck = 0;
                GM_setValue('xget_server_status', CONFIG.serverStatus);
                showNotification('加速域名已更新，刷新页面生效', 'success');
            }
        });

        // 切换通知
        GM_registerMenuCommand(CONFIG.showNotification ? '🔕 关闭通知' : '🔔 开启通知', function() {
            CONFIG.showNotification = !CONFIG.showNotification;
            GM_setValue('xget_show_notification', CONFIG.showNotification);
            showNotification(CONFIG.showNotification ? '通知已开启' : '通知已关闭', 'success');
            location.reload();
        });

        // 查看统计信息
        GM_registerMenuCommand('📊 查看统计', function() {
            const stats = CONFIG.stats;
            const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
            alert(
                `Xget 加速统计\n\n` +
                `总下载次数: ${stats.total}\n` +
                `成功加速: ${stats.success}\n` +
                `失败次数: ${stats.failed}\n` +
                `成功率: ${successRate}%\n\n` +
                `当前域名: ${getAcceleratorDomain()}\n` +
                `服务器状态: ${CONFIG.serverStatus.available ? '✅ 可用' : '❌ 不可用'}\n` +
                `调试模式: ${CONFIG.debug ? '开启' : '关闭'}\n\n` +
                `---\n` +
                `🎨 增强优化版 UP：毕加索自画像`
            );
        });

        // 重置统计
        GM_registerMenuCommand('🔄 重置统计', function() {
            if (confirm('确定要重置所有统计数据吗？')) {
                CONFIG.stats = { total: 0, success: 0, failed: 0 };
                GM_setValue('xget_stats', CONFIG.stats);
                showNotification('统计数据已重置', 'success');
                location.reload();
            }
        });

        // 管理排除列表
        GM_registerMenuCommand('🚫 管理排除列表', function() {
            const current = CONFIG.excludeList.join('\n');
            const newList = prompt(
                '输入要排除的 URL 模式（每行一个，支持正则表达式）:\n' +
                '例如: /test/ 或 example.com',
                current
            );
            if (newList !== null) {
                CONFIG.excludeList = newList.split('\n').filter(x => x.trim());
                GM_setValue('xget_exclude_list', CONFIG.excludeList);
                showNotification('排除列表已更新', 'success');
            }
        });

        // 切换自动检测
        GM_registerMenuCommand(CONFIG.autoCheck ? '⏸️ 禁用服务器检测' : '▶️ 启用服务器检测', function() {
            CONFIG.autoCheck = !CONFIG.autoCheck;
            GM_setValue('xget_auto_check', CONFIG.autoCheck);
            showNotification(CONFIG.autoCheck ? '已启用服务器可用性检测' : '已禁用服务器可用性检测', 'success');
            location.reload();
        });

        // 手动检测服务器
        GM_registerMenuCommand('🔍 检测服务器状态', async function() {
            showNotification('正在检测服务器状态...', 'info', 2000);
            // 强制重新检测
            CONFIG.serverStatus.lastCheck = 0;
            const available = await checkServerAvailability();
            showNotification(
                available ? '✅ 加速服务器可用' : '❌ 加速服务器不可用',
                available ? 'success' : 'error',
                3000
            );
        });

        // 切换调试模式
        GM_registerMenuCommand(CONFIG.debug ? '🐛 关闭调试模式' : '🐛 开启调试模式', function() {
            CONFIG.debug = !CONFIG.debug;
            GM_setValue('xget_debug', CONFIG.debug);
            showNotification(CONFIG.debug ? '调试模式已开启' : '调试模式已关闭', 'success');
            location.reload();
        });

        // 测试加速链接
        GM_registerMenuCommand('🧪 测试转换', function() {
            const testUrl = prompt('输入要测试的 URL:');
            if (testUrl) {
                const converted = convertToAcceleratorURL(testUrl);
                const isDownload = isDownloadLink(testUrl, null);
                alert(
                    `原始 URL:\n${testUrl}\n\n` +
                    `转换后:\n${converted}\n\n` +
                    `是否为下载链接: ${isDownload ? '是' : '否'}`
                );
            }
        });

        // 设置重试次数
        GM_registerMenuCommand('🔁 设置重试次数', function() {
            const retries = prompt('设置 URL 转换失败时的重试次数 (0-5):', CONFIG.maxRetries);
            if (retries !== null) {
                const num = parseInt(retries);
                if (num >= 0 && num <= 5) {
                    CONFIG.maxRetries = num;
                    GM_setValue('xget_max_retries', num);
                    showNotification(`重试次数已设置为 ${num}`, 'success');
                } else {
                    showNotification('请输入 0-5 之间的数字', 'error');
                }
            }
        });
    }

    // 在控制台显示艺术字 Logo（优雅的署名方式）
    function showConsoleBanner() {
        const styles = [
            'color: #10b981; font-size: 16px; font-weight: bold;',
            'color: #3b82f6; font-size: 12px;',
            'color: #6b7280; font-size: 11px;'
        ];
        
        console.log('%c⚡ Xget 加速器增强优化版', styles[0]);
        console.log('%c🎨 UP：毕加索自画像', styles[1]);
        console.log('%c✨ 感谢使用本增强版脚本 | v3.2', styles[2]);
    }

    // 彩蛋：特殊组合键显示作者信息
    function setupEasterEgg() {
        let keySequence = [];
        const secretCode = ['x', 'g', 'e', 't']; // 输入 "xget" 触发
        
        document.addEventListener('keydown', (e) => {
            keySequence.push(e.key.toLowerCase());
            if (keySequence.length > secretCode.length) {
                keySequence.shift();
            }
            
            if (keySequence.join('') === secretCode.join('')) {
                showAuthorInfo();
                keySequence = [];
            }
        });
    }

    // 显示作者信息（彩蛋触发）
    function showAuthorInfo() {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            z-index: 10001;
            text-align: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            animation: fadeInScale 0.3s ease-out;
        `;
        
        modal.innerHTML = `
            <div style="font-size: 48px; margin-bottom: 15px;">🎨</div>
            <div style="font-size: 24px; font-weight: 700; margin-bottom: 10px;">Xget 加速器增强优化版</div>
            <div style="font-size: 14px; opacity: 0.9; margin-bottom: 20px;">Enhanced & Optimized Edition v3.2</div>
            <div style="border-top: 1px solid rgba(255,255,255,0.3); padding-top: 20px;">
                <div style="font-size: 16px; margin-bottom: 8px;">✨ UP 主</div>
                <div style="font-size: 20px; font-weight: 600; margin-bottom: 15px;">毕加索自画像</div>
                <div style="font-size: 13px; opacity: 0.8;">
                    感谢使用本增强版脚本<br>
                    已优化：性能、稳定性、错误处理
                </div>
            </div>
            <div style="margin-top: 20px; font-size: 11px; opacity: 0.6;">点击任意处关闭</div>
        `;
        
        // 添加动画
        if (!document.getElementById('xget-modal-style')) {
            const style = document.createElement('style');
            style.id = 'xget-modal-style';
            style.textContent = `
                @keyframes fadeInScale {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -50%) scale(0.9);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%) scale(1);
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        // 点击关闭
        modal.addEventListener('click', () => {
            modal.style.animation = 'fadeInScale 0.2s ease-out reverse';
            setTimeout(() => modal.remove(), 200);
        });
        
        document.body.appendChild(modal);
    }

    // 初始化
    function init() {
        // 显示控制台 Banner
        showConsoleBanner();
        
        // 设置彩蛋
        setupEasterEgg();
        
        debugLog('Xget 加速器增强优化版初始化开始');
        debugLog('配置:', CONFIG);
        
        console.log('🎨 Xget 加速器增强优化版已加载 - UP：毕加索自画像 | v3.1');
        setupMenuCommands();

        if (CONFIG.enabled) {
            interceptDownloadLinks();
            
            // 延迟添加指示器，确保页面已加载
            setTimeout(() => {
                addPageIndicator();
            }, 1000);
            
            const domain = getAcceleratorDomain();
            console.log(`Xget 加速已启用 - 域名: ${domain}`);
            console.log(`统计: 成功 ${CONFIG.stats.success} / 总计 ${CONFIG.stats.total}`);
            debugLog('初始化完成');
        } else {
            debugLog('加速功能已禁用');
        }
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();