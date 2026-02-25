'use client';

import { useChat } from '@/hooks/useChat';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { Trash2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ChatContainer() {
    const { messages, sendMessage, isLoading, clearMessages } = useChat();

    return (
        <div className="flex flex-col h-full bg-white dark:bg-zinc-950">
            {/* 헤더 */}
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg">
                        <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                            tutum AI
                            <span className="text-[10px] font-medium px-2 py-0.5 bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-fuchsia-300 rounded-full uppercase tracking-wider">
                                Beta
                            </span>
                        </h1>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            금융 AI 어시스턴트
                        </p>
                    </div>
                </div>

                {messages.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearMessages}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                        <Trash2 className="h-4 w-4 mr-1" />
                        <span className="text-xs">대화 지우기</span>
                    </Button>
                )}
            </div>

            {/* 메시지 영역 */}
            <div className="flex-1 overflow-hidden flex flex-col">
                <ChatMessages messages={messages} />
            </div>

            {/* 입력 영역 */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
                <ChatInput onSend={sendMessage} isLoading={isLoading} />
            </div>
        </div>
    );
}
