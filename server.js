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
const TIMEOUT = 30000; // 30秒超时

// 处理用户消息的函数
async function processUserMessage(message) {
    // 并发请求所有回应
    const [emotionalResponse, transitionResponse, cognitiveResponse] = await Promise.all([
        // 第一段：情绪分析和灵性回应
        generateResponse(message, '请对用户的消息进行情绪分析，就事论事，给出富有同理心和灵性的回应，孩童般那无理但有情，打动人心，让用户感到温暖与被理解，使用户重拾勇气与信心。注意回复不要太长，选择最能打动人心的一两句话回复，不要有心理活动或者场景的描述。'),
        
        // 第二段：事件分析
        Promise.resolve('你现在心情好了一些吗，让我们一起来看看这件事情吧。'),
        
        // 第三段：行动建议
        generateResponse(message, '请对整个事件从不同角度进行分析，让用户全面深刻地认识到这件事情，并且给用户一些具体可实施的方法，让用户能够开始着手改变。注意语气自然，就像两个人在促膝长谈一样，一步一步地引导，多鼓励，不要有心理活动或者场景的描述。')
    ]);
    
    return {
        emotional: emotionalResponse,
        transition: transitionResponse,
        cognitive: cognitiveResponse
    };
}

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
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
        }
    }
    return '抱歉，服务暂时不可用，请稍后再试。'
}

// API路由
app.post('/api/chat', async (req, res) => {
    console.log('Received chat request:', {
        headers: req.headers,
        body: req.body
    });

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
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
        res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

        const response = await processUserMessage(message);
        res.json(response);
    } catch (error) {
        console.error('Error in chat endpoint:', {
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