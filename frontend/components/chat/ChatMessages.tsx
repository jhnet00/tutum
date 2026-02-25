'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { Message } from '@/types/chat';

interface UserMessageProps {
    content: string;
}

export function UserMessage({ content }: UserMessageProps) {
    return (
        <div className="flex justify-end gap-3 px-4 py-3">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground">
                <p className="whitespace-pre-wrap text-sm">{content}</p>
            </div>
        </div>
    );
}

interface AssistantMessageProps {
    content: string;
    sources?: { type: string; title: string; url?: string }[];
    isStreaming?: boolean;
}

export function AssistantMessage({ content, sources, isStreaming }: AssistantMessageProps) {
    return (
        <div className="flex gap-3 px-4 py-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-500 text-xs font-bold text-white shadow-lg">
                AI
            </div>

            <div className="max-w-[85%] flex-1">
                <div className="rounded-2xl rounded-tl-sm bg-zinc-100 px-4 py-3 shadow-sm dark:bg-zinc-800/50">
                    {content ? (
                        <div className="prose prose-sm max-w-none text-sm dark:prose-invert">
                            <ReactMarkdown
                                rehypePlugins={[rehypeSanitize]}
                                components={{
                                    p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
                                    li: ({ children }) => <li className="my-1">{children}</li>,
                                }}
                            >
                                {content}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        isStreaming && <span className="text-zinc-400">생각 중...</span>
                    )}

                    {isStreaming && (
                        <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-purple-500" />
                    )}
                </div>

                {sources && sources.length > 0 && !isStreaming && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">출처:</span>
                        {sources.map((source, idx) => (
                            <span
                                key={idx}
                                className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            >
                                {source.type === 'price' && '📊'}
                                {source.type === 'news' && '📰'}
                                {source.type === 'portfolio' && '💼'}
                                {source.title}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

interface ChatMessagesProps {
    messages: Message[];
    onSuggestionClick?: (text: string) => void;
}

export function ChatMessages({ messages, onSuggestionClick }: ChatMessagesProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (messages.length === 0) return;
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    if (messages.length === 0) {
        const suggestions = [
            '비트코인 현재 시세 알려줘',
            '내 포트폴리오 분석해줘',
            '리밸런싱이 필요한지 봐줘',
            '이더리움 최근 동향은 어때?',
        ];

        return (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-500 text-2xl font-bold text-white shadow-xl">
                    AI
                </div>
                <h2 className="mb-2 text-xl font-bold text-zinc-900 dark:text-white">tutum AI에게 물어보세요</h2>
                <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                    포트폴리오 분석, 시세 정보, 투자 인사이트 등 금융 관련 질문에 답변합니다.
                </p>

                <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                    {suggestions.map((suggestion, idx) => (
                        <button
                            key={idx}
                            onClick={() => onSuggestionClick?.(suggestion)}
                            className="rounded-xl border border-zinc-200 px-4 py-3 text-left text-sm text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800/50"
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto py-4">
            {messages.map((message) =>
                message.role === 'user' ? (
                    <UserMessage key={message.id} content={message.content} />
                ) : (
                    <AssistantMessage
                        key={message.id}
                        content={message.content}
                        sources={message.sources}
                        isStreaming={message.isStreaming}
                    />
                ),
            )}
            <div ref={messagesEndRef} />
        </div>
    );
}
