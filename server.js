const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 添加静态文件服务中间件
app.use(express.static(path.join(__dirname)));

const API_KEY = 'd1dbe092-0b33-4bf0-9611-9e237e5d81e9';
const API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 配置API认证信息
const API_AUTH = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
};

// 处理用户消息的函数
async function processUserMessage(message) {
    // 第一段：情绪分析和灵性回应
    const emotionalResponse = await generateResponse(message, '请对用户的消息进行情绪分析，给出富有同理心和灵性的回应。');
    
    // 第二段：温和过渡
    const transitionResponse = await generateResponse(message, '你的心情好了一些吗？together分析一下这件事情。');
    
    // 第三段：认知分析
    const cognitiveResponse = await generateResponse(message, '请对用户的情况进行深入的认知分析，提供清晰的建议。');
    
    return {
        emotional: emotionalResponse,
        transition: transitionResponse,
        cognitive: cognitiveResponse
    };
}

// 生成AI回复的函数
async function generateResponse(message, instruction) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: API_AUTH,
            body: JSON.stringify({
                model: 'deepseek-r1-250120',
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

        const data = await response.json();
        console.log('API Response:', JSON.stringify(data, null, 2)); // 添加完整的日志记录

        if (!data || !data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('Invalid API response structure:', data);
            return '抱歉，API返回的数据格式不正确。';
        }

        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error generating response:', error);
        return '抱歉，生成回复时出现错误。';
    }
}

// API路由
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const response = await processUserMessage(message);
        res.json(response);
    } catch (error) {
        console.error('Error in chat endpoint:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});