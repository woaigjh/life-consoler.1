const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const port = 3000;

// 配置 CORS 和请求体解析
app.use(cors());
app.use(express.json());

// 配置静态文件服务
app.use(express.static('.'));

// 火山方舟 API 配置
const API_KEY = 'd1dbe092-0b33-4bf0-9611-9e237e5d81e9';
const API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 聊天路由
app.post('/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;

        // 设置响应头，启用流式输出
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        // 准备请求体
        const requestBody = {
            model: 'deepseek-r1-250120',
            messages: [
                {
                    role: 'system',
                    content: '你是一位专业的 Life Coach，擅长通过对话为用户提供个人成长建议。你的回答应该富有洞察力、建设性和鼓励性，帮助用户发现自己的潜力并制定可行的成长计划。'
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            temperature: 0.6,
            stream: true
        };

        // 发送请求到火山方舟 API
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        // 获取响应文本
        const responseText = await response.text();
        const lines = responseText.split('\n');

        // 处理每一行SSE数据
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine === 'data: [DONE]') continue;

            // 提取JSON数据
            const jsonStr = trimmedLine.replace(/^data: /, '');
            try {
                const data = JSON.parse(jsonStr);
                if (data.choices && data.choices[0].delta.content) {
                    res.write(data.choices[0].delta.content);
                }
            } catch (error) {
                console.error('Error parsing JSON:', error);
            }
        }

        res.end();
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('服务器错误');
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器运行在 http://localhost:${port}`);
});