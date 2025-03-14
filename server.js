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
const MAX_RETRIES = 3;
const TIMEOUT = 30000; // 降低到30秒超时
const RETRY_DELAY = 1000; // 降低到1秒重试延迟

// 生成AI回复的函数
async function generateResponse(message, instruction) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

            console.log('Sending request to API:', {
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

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Response Error:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorText: errorText
                });
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('API Response:', JSON.stringify(data, null, 2));

            if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('Invalid API response structure:', data);
                throw new Error('Invalid API response structure');
            }

            return data.choices[0].message.content;

        } catch (error) {
            console.error(`Error generating response (attempt ${retries + 1}/${MAX_RETRIES}):`, {
                error: error.message,
                stack: error.stack
            });
            retries++;
            if (retries === MAX_RETRIES) {
                return '抱歉，生成回复时出现错误，请稍后再试。';
            }
            // 等待一段时间后重试
            const delay = RETRY_DELAY * Math.pow(2, retries - 1); // 指数退避策略
            console.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    return '抱歉，服务暂时不可用，请稍后再试。'
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
        
        // 先返回情感回应，避免超时
        const emotionalResponse = await generateResponse(message, '请对用户的消息进行情绪分析，就事论事，给出富有同理心和灵性的回应，孩童般那无理但有情，打动人心，让用户感到温暖与被理解，使用户重拾勇气与信心。注意回复不要太长，选择最能打动人心的一两句话回复，不要有心理活动或者场景的描述。');
        
        // 发送第一部分响应
        res.json({
            emotional: emotionalResponse,
            transition: '你现在心情好了一些吗。',
            cognitive: '唉，这件事确实很难办呢，不过没关系，让我们一起来看看吧。'
        });
        
        // 创建一个Map来存储每个消息的认知分析
        const messageId = Date.now().toString(); // 使用时间戳作为消息ID
        const cognitiveResponsesMap = app.locals.cognitiveResponsesMap = app.locals.cognitiveResponsesMap || new Map();
        
        // 后台继续处理认知回应，但不阻塞响应返回
        generateResponse(message, '请对整个事件从不同角度进行分析，让用户全面深刻地认识到这件事情，并且给用户一些具体可实施的方法，让用户能够开始着手改变。注意语气自然，就像两个人在促膝长谈一样，一步一步地引导，多鼓励，不要有心理活动或者场景的描述。')
            .then(cognitiveResponse => {
                console.log('后台生成的认知回应:', cognitiveResponse);
                // 将认知分析存储到Map中
                cognitiveResponsesMap.set(message, cognitiveResponse);
                // 设置过期时间，1小时后自动删除
                setTimeout(() => {
                    cognitiveResponsesMap.delete(message);
                }, 3600000);
            })
            .catch(error => {
                console.error('生成认知回应时出错:', error);
            });
            
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
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: '消息不能为空' });
        }

        // 从Map中获取存储的认知分析
        const cognitiveResponsesMap = app.locals.cognitiveResponsesMap || new Map();
        const cognitiveResponse = cognitiveResponsesMap.get(message);

        // 返回认知分析（如果已生成）
        res.json({
            cognitive: cognitiveResponse || '唉，这件事确实很难办呢，不过没关系，让我们一起来看看吧。'
        });
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