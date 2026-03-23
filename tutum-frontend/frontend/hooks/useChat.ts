'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Message, Source } from '@/types/chat';
import { useAuth } from '@/contexts/AuthContext';

const API_URL = '/api/proxy';
const CHAT_STORAGE_KEY = 'tutum_ai_chat_messages_v1';
const CHAT_SYNC_EVENT = 'tutum:ai-chat-sync';

type MessageUpdater = Message[] | ((prev: Message[]) => Message[]);
type StoredMessage = Omit<Message, 'createdAt'> & { createdAt: string };

function makeMessageId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readStoredMessages(): Message[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];

            return [{
                id: String(item.id ?? makeMessageId()),
                role: item.role === 'assistant' ? 'assistant' : 'user',
                content: String(item.content ?? ''),
                sources: Array.isArray(item.sources) ? item.sources as Source[] : [],
                createdAt: new Date(item.createdAt ?? Date.now()),
                isStreaming: Boolean(item.isStreaming),
            }];
        });
    } catch {
        return [];
    }
}

function writeStoredMessages(messages: Message[]) {
    if (typeof window === 'undefined') return;

    const serialized: StoredMessage[] = messages.map((message) => ({
        ...message,
        createdAt: message.createdAt instanceof Date
            ? message.createdAt.toISOString()
            : new Date(message.createdAt).toISOString(),
    }));

    window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(serialized));
}

export function useChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const { token } = useAuth();
    const instanceIdRef = useRef(makeMessageId());

    const setMessagesAndPersist = useCallback((updater: MessageUpdater) => {
        setMessages((prev) => {
            const next = typeof updater === 'function'
                ? (updater as (prev: Message[]) => Message[])(prev)
                : updater;

            writeStoredMessages(next);

            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(CHAT_SYNC_EVENT, {
                    detail: { sourceId: instanceIdRef.current },
                }));
            }

            return next;
        });
    }, []);

    useEffect(() => {
        setMessages(readStoredMessages());

        if (typeof window === 'undefined') return;

        const handleSync = (event: Event) => {
            const sourceId = event instanceof CustomEvent ? event.detail?.sourceId : undefined;
            if (sourceId === instanceIdRef.current) return;
            setMessages(readStoredMessages());
        };

        const handleStorage = (event: StorageEvent) => {
            if (event.key !== CHAT_STORAGE_KEY) return;
            setMessages(readStoredMessages());
        };

        window.addEventListener(CHAT_SYNC_EVENT, handleSync as EventListener);
        window.addEventListener('storage', handleStorage);

        return () => {
            window.removeEventListener(CHAT_SYNC_EVENT, handleSync as EventListener);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const sendMessage = useCallback(async (content: string) => {
        if (!content.trim() || isLoading) return;

        const userMessage: Message = {
            id: makeMessageId(),
            role: 'user',
            content,
            createdAt: new Date(),
        };
        setMessagesAndPersist((prev) => [...prev, userMessage]);

        const assistantId = makeMessageId();
        const assistantMessage: Message = {
            id: assistantId,
            role: 'assistant',
            content: '',
            sources: [],
            createdAt: new Date(),
            isStreaming: true,
        };
        setMessagesAndPersist((prev) => [...prev, assistantMessage]);
        setIsLoading(true);

        try {
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
                            setMessagesAndPersist((prev) => prev.map((msg) =>
                                msg.id === assistantId
                                    ? { ...msg, content: msg.content + data.content }
                                    : msg
                            ));
                        }

                        if (eventType === 'sources' && data.sources) {
                            setMessagesAndPersist((prev) => prev.map((msg) =>
                                msg.id === assistantId
                                    ? { ...msg, sources: data.sources as Source[] }
                                    : msg
                            ));
                        }

                        if (eventType === 'error') {
                            setMessagesAndPersist((prev) => prev.map((msg) =>
                                msg.id === assistantId
                                    ? { ...msg, content: data.message || '채팅 처리 중 오류가 발생했습니다.', isStreaming: false }
                                    : msg
                            ));
                        }

                        if (eventType === 'done') {
                            setMessagesAndPersist((prev) => prev.map((msg) =>
                                msg.id === assistantId
                                    ? { ...msg, isStreaming: false }
                                    : msg
                            ));
                        }
                    } catch {
                        // Ignore partial SSE chunks that are not yet valid JSON.
                    }
                }
            }

            setMessagesAndPersist((prev) => prev.map((msg) =>
                msg.id === assistantId
                    ? { ...msg, isStreaming: false }
                    : msg
            ));
        } catch (error) {
            console.error('Chat API Error:', error);
            setMessagesAndPersist((prev) => prev.map((msg) =>
                msg.id === assistantId
                    ? {
                        ...msg,
                        content: '죄송합니다. 서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.',
                        isStreaming: false,
                    }
                    : msg
            ));
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, setMessagesAndPersist, token]);

    const clearMessages = useCallback(() => {
        setMessagesAndPersist([]);
    }, [setMessagesAndPersist]);

    return { messages, sendMessage, isLoading, clearMessages };
}
