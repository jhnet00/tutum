'use client';

import { useState, useCallback } from 'react';
import { Message, Source } from '@/types/chat';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = '/api/proxy';

export function useChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { token } = useAuth();

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim() || isLoading) return;

        // 1. 사용자 메시지 추가
        const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content,
            createdAt: new Date(),
        };
        setMessages(prev => [...prev, userMessage]);

        // 2. AI 응답 플레이스홀더 추가
        const assistantId = crypto.randomUUID();
        const assistantMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            sources: [],
            createdAt: new Date(),
            isStreaming: true,
        };
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(true);

        try {
            // 3. 백엔드 API 호출 (SSE 스트리밍)
            const response = await fetch(`${API_URL}/api/v1/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    message: content,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('Response body is null');
            }

            let buffer = '';
            let eventType = 'message';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line) {
                        eventType = 'message';
                        continue;
                    }

                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7).trim();
                        continue;
                    }

                    if (!line.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(line.slice(6));

                        if (eventType === 'delta' && data.content) {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantId
                                    ? { ...msg, content: msg.content + data.content }
                                    : msg
                            ));
                        }

                        if (eventType === 'sources' && data.sources) {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantId
                                    ? { ...msg, sources: data.sources as Source[] }
                                    : msg
                            ));
                        }

                        if (eventType === 'error') {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantId
                                    ? { ...msg, content: data.message || '채팅 처리 중 오류가 발생했습니다.', isStreaming: false }
                                    : msg
                            ));
                        }

                        if (eventType === 'done') {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantId
                                    ? { ...msg, isStreaming: false }
                                    : msg
                            ));
                        }
                    } catch {
                        // JSON 파싱 에러 무시 (불완전한 청크)
                    }
                }
            }

            // 4. 스트리밍 완료
            setMessages(prev => prev.map(msg =>
                msg.id === assistantId
                    ? { ...msg, isStreaming: false }
                    : msg
            ));
        } catch (error) {
            console.error('Chat API Error:', error);
            // 에러 메시지 표시
            setMessages(prev => prev.map(msg =>
                msg.id === assistantId
                    ? {
                        ...msg,
                        content: '죄송합니다. 서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.',
                        isStreaming: false
                    }
                    : msg
            ));
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, token]);

    const clearMessages = useCallback(() => {
        setMessages([]);
    }, []);

    return { messages, sendMessage, isLoading, clearMessages };
}
