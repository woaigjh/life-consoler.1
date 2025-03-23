const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');
const dotenv = require('dotenv');

// 加载环境变量
dotenv.config();

const app = express();

// 配置CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
}));

app.use(express.json());

// 添加静态文件服务中间件
app.use(express.static(path.join(__dirname)));

// 从环境变量中获取API密钥和URL
const API_KEY = process.env.VOLCES_API_KEY || 'd1dbe092-0b33-4bf0-9611-9e237e5d81e9';
const API_URL = process.env.VOLCES_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const API_MODEL = process.env.VOLCES_API_MODEL || 'deepseek-r1-250120';

// 配置API认证信息
const API_AUTH = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    'Accept': 'application/json'
};

// 添加请求超时和重试机制
const MAX_RETRIES = 5; // 增加最大重试次数
const TIMEOUT = 60000; // 60秒超时，给API足够的响应时间
const RETRY_DELAY = 1000; // 初始重试延迟1秒，使用指数退避策略
const MAX_RETRY_DELAY = 10000; // 最大重试延迟10秒

// 生成AI回复的函数
async function generateResponse(message, instruction) {
    // 检查消息是否为空或过短
    if (!message || typeof message !== 'string') {
        console.log('消息为空或格式不正确，使用默认回复');
        return '我理解你现在可能心情不佳，有什么想和我分享的吗？';
    }
    
    // 对于特别短的消息（少于3个字符），使用预设回复以避免API调用失败
    if (message.trim().length < 3) {
        console.log(`消息过短 (${message.length}字符)，使用预设回复`);
        const shortMsgResponses = {
            '好累': '是啊，生活有时确实让人感到疲惫。休息一下，给自己一点喘息的空间吧。明天又是崭新的一天。',
            '嗯': '我在听，如果有什么想说的，随时可以告诉我。',
            '啊': '似乎有什么在困扰着你？愿意多分享一些吗？'
        };
        
        // 检查是否有预设回复，如果有则直接返回
        const exactMatch = shortMsgResponses[message.trim()];
        if (exactMatch) {
            console.log('找到预设回复，跳过API调用');
            return exactMatch;
        }
        
        // 如果没有预设回复但消息仍然很短，返回通用回复
        return '我听着呢，能告诉我更多吗？';
    }
    
    let retries = 0;
    let lastError = null;
    
    while (retries < MAX_RETRIES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.log(`请求超时 (${TIMEOUT}ms)，正在中止...`);
            }, TIMEOUT);

            console.log(`发送API请求 (尝试 ${retries + 1}/${MAX_RETRIES}):`, {
                url: API_URL,
                model: API_MODEL,
                message: message.substring(0, 100) + '...' // 只记录消息的前100个字符
            });

            const response = await fetch(API_URL, {
                method: 'POST',
                headers: API_AUTH,
                signal: controller.signal,
                body: JSON.stringify({
                    model: API_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: instruction
                        },
                        {
                            role: 'user',
                            content: message
                        }
                    ]
                })
            });

            clearTimeout(timeoutId);

            // 检查HTTP状态码
            if (!response.ok) {
                const errorText = await response.text();
                const statusCode = response.status;
                
                console.error('API响应错误:', {
                    status: statusCode,
                    statusText: response.statusText,
                    errorText: errorText
                });
                
                // 根据状态码决定是否重试
                // 对于服务器错误(5xx)和部分客户端错误(429-太多请求)进行重试
                // 对于其他客户端错误(4xx)不重试
                if (statusCode < 500 && statusCode !== 429) {
                    return `抱歉，请求出现错误 (${statusCode})，请检查您的输入后重试。`;
                }
                
                throw new Error(`API请求失败，状态码: ${statusCode}, 错误信息: ${errorText}`);
            }

            // 解析JSON响应
            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                console.error('解析API响应JSON时出错:', jsonError);
                throw new Error('无法解析API响应');
            }
            
            console.log('API响应成功:', JSON.stringify(data, null, 2));

            // 验证响应结构
            if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('API响应结构无效:', data);
                throw new Error('API响应结构无效');
            }

            // 成功获取响应
            return data.choices[0].message.content;

        } catch (error) {
            lastError = error;
            console.error(`生成响应时出错 (尝试 ${retries + 1}/${MAX_RETRIES}):`, {
                error: error.message,
                stack: error.stack
            });
            
            retries++;
            
            // 达到最大重试次数
            if (retries >= MAX_RETRIES) {
                console.error(`达到最大重试次数 (${MAX_RETRIES})，停止重试`);
                break;
            }
            
            // 计算退避延迟，但设置上限
            const delay = Math.min(
                RETRY_DELAY * Math.pow(2, retries - 1), 
                MAX_RETRY_DELAY
            );
            
            console.log(`等待 ${delay}ms 后重试...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // 所有重试都失败
    console.error('所有重试尝试均失败:', lastError);
    return '抱歉，服务暂时不可用，请稍后再试。我们已记录此问题并会尽快修复。';
}

// API路由 - 改为流式响应
app.post('/api/chat', async (req, res) => {
    console.log('Received chat request:', {
        headers: req.headers,
        body: req.body
    });

    // 设置CORS响应头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    // 处理OPTIONS请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: '消息不能为空' });
        }

        // 设置响应头
        res.setHeader('Content-Type', 'application/json');
        
        // 设置更短的超时时间，确保在Vercel的限制内完成
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.log(`API请求超时 (20秒)，正在中止...`);
        }, 20000); // 20秒超时，确保在Vercel限制内
        
        try {
            // 只获取情感回应，减少响应时间
            const emotionalResponse = await generateResponse(message, '请对用户的消息进行情绪分析，就事论事，给出富有同理心和灵性的回应，孩童般那无理但有情，打动人心，让用户感到温暖与被理解，使用户重拾勇气与信心。注意回复不要太长，选择最能打动人心的一两句话回复，不要有心理活动或者场景的描述。');
            
            clearTimeout(timeoutId);
            
            // 创建一个Map来存储每个消息的认知分析
            const cognitiveResponsesMap = app.locals.cognitiveResponsesMap = app.locals.cognitiveResponsesMap || new Map();
            
            // 确保使用一致的默认认知回复
            const defaultCognitive = '唉，这件事确实很难办呢，不过没关系，我给你写一封回信慢慢说吧';
            
            // 生成一个唯一的会话ID作为键
            const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 15);
            console.log('生成的会话ID:', sessionId);
            
            // 发送第一部分响应，包含会话ID
            res.json({
                emotional: emotionalResponse,
                transition: '你现在心情好了一些吗。',
                cognitive: defaultCognitive,
                sessionId: sessionId
            });
            
            // 后台继续处理认知回应，但不阻塞响应返回
            setTimeout(async () => {
                try {
                    // 改进提示词，使认知回复更有价值，并添加第四段内容
                    const cognitiveResponse = await generateResponse(message, '请对用户的消息进行深入分析，理解他们的情感状态和潜在需求。以浪矢爷爷的身份，用温暖和智慧的语气回复，像一个值得信赖的长者一样倾听他们的烦恼。\n\n请提供以下四个部分的回复：\n1. 对用户情况的理解和共情\n2. 对问题本质的分析\n3. 实用的建议和鼓励\n4. 一段温暖的结语\n\n以信件格式书写，开头称呼"亲爱的朋友"，结尾落款"浪矢爷爷"');
                    console.log('后台生成的认知回应:', cognitiveResponse);
                    
                    // 验证认知回应是否有效，增强验证逻辑
                    if (cognitiveResponse && typeof cognitiveResponse === 'string' && cognitiveResponse.length > 50) {
                        // 记录认知回应的详细信息，便于调试
                        console.log('认知回应详情:', {
                            sessionId: sessionId,
                            contentLength: cognitiveResponse.length,
                            firstChars: cognitiveResponse.substring(0, 50) + '...',
                            timestamp: new Date().toISOString()
                        });
                        
                        // 将认知分析存储到Map中，使用会话ID作为键
                        cognitiveResponsesMap.set(sessionId, cognitiveResponse);
                        console.log('已存储认知分析，当前Map大小:', cognitiveResponsesMap.size);
                        console.log('存储的会话ID:', sessionId);
                        // 设置过期时间，1小时后自动删除
                        setTimeout(() => {
                            cognitiveResponsesMap.delete(sessionId);
                            console.log(`会话ID ${sessionId} 的认知分析已过期并删除`);
                        }, 3600000);
                    } else {
                        console.error('生成的认知回应无效或太短:', cognitiveResponse);
                        // 存储一个友好的错误消息
                        cognitiveResponsesMap.set(sessionId, '亲爱的朋友，\n\n感谢你的来信。我正在思考如何更好地回应你的问题，但似乎我需要更多时间来整理思绪。请稍后再来查看我的回信，或者你可以再次表达你的想法，帮助我更好地理解你的处境。\n\n期待再次收到你的来信，\n浪矢爷爷');
                    }
                } catch (error) {
                    console.error('生成认知回应时出错:', error);
                    // 存储一个友好的错误消息
                    cognitiveResponsesMap.set(sessionId, '亲爱的朋友，\n\n感谢你的来信。我在思考回复时遇到了一些困难，可能是因为我对你的情况理解不够深入。如果方便的话，请再多告诉我一些关于你的情况，这样我才能给你更好的建议。\n\n期待你的回信，\n浪矢爷爷');
                }
            }, 100); // 延迟100ms开始处理，确保主响应已经返回
        } catch (error) {
            clearTimeout(timeoutId);
            // 如果情感回应生成失败，返回默认回应
            res.json({
                emotional: '亲爱的朋友，我能感受到你的心情。无论如何，请记住，每一个困难都是暂时的，而你比你想象的更坚强。',
                transition: '你现在心情好了一些吗。',
                cognitive: '唉，这件事确实很难办呢，不过没关系，我给你写一封回信慢慢说吧'
            });
            console.error('生成情感回应时出错:', error);
        }
            
    } catch (error) {
        console.error('Error in chat endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: '服务器内部错误，请稍后重试' });
    }
});

// 添加检查认知分析的API端点
app.post('/api/check-cognitive', (req, res) => {
    // 设置CORS响应头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    // 处理OPTIONS请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const { sessionId } = req.body;
        console.log('收到检查认知分析请求，会话ID:', sessionId);
        
        if (!sessionId) {
            return res.status(400).json({ error: '会话ID不能为空' });
        }

        // 从Map中获取存储的认知分析
        const cognitiveResponsesMap = app.locals.cognitiveResponsesMap || new Map();
        console.log('当前Map大小:', cognitiveResponsesMap.size);
        const cognitiveResponse = cognitiveResponsesMap.get(sessionId);
        console.log('查找到的认知分析:', cognitiveResponse ? '已找到' : '未找到');

        // 验证认知分析内容
        let responseToSend = cognitiveResponse;
        // 如果认知分析不存在或无效，返回null，让客户端继续轮询
        // 只有在确认认知分析已生成但内容无效时才返回默认回复
        if (!responseToSend) {
            console.log('认知分析尚未生成，返回null让客户端继续轮询');
            responseToSend = null;
        } else if (typeof responseToSend !== 'string' || responseToSend.length < 50) {
            console.log('认知分析内容无效或太短，使用默认回复');
            responseToSend = '亲爱的朋友，\n\n感谢你的来信。我正在思考如何更好地回应你的问题，但似乎我需要更多时间来整理思绪。请稍后再来查看我的回信，或者你可以再次表达你的想法，帮助我更好地理解你的处境。\n\n期待再次收到你的来信，\n浪矢爷爷';
        }
        
        // 记录详细的认知分析状态，便于调试
        console.log('认知分析状态详情:', {
            sessionId: sessionId,
            found: responseToSend !== null,
            contentType: typeof responseToSend,
            contentLength: responseToSend ? responseToSend.length : 0,
            timestamp: new Date().toISOString()
        });

        // 返回认知分析
        res.json({
            cognitive: responseToSend
        });
        
        // 记录返回的认知分析内容
        console.log('返回的认知分析:', responseToSend.substring(0, 50) + '...');
    } catch (error) {
        console.error('Error in check-cognitive endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ error: '服务器内部错误，请稍后重试' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Environment:', {
        NODE_ENV: process.env.NODE_ENV,
        API_URL: API_URL,
        API_MODEL: API_MODEL
    });
});