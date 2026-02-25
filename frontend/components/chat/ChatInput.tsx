'use client';

import { useState, KeyboardEvent, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatInputProps {
    onSend: (message: string) => void;
    isLoading?: boolean;
    onSuggestionClick?: (suggestion: string) => void;
}

const QUICK_ACTIONS = [
    { label: '📊 포트폴리오 분석', prompt: '내 포트폴리오를 분석해줘' },
    { label: '💡 리밸런싱 추천', prompt: '리밸런싱이 필요한지 알려줘' },
    { label: '📈 BTC 시세', prompt: '비트코인 현재 시세 알려줘' },
    { label: '⚠️ 리스크 진단', prompt: '포트폴리오 리스크를 진단해줘' },
];

export function ChatInput({ onSend, isLoading, onSuggestionClick }: ChatInputProps) {
    const [input, setInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
        }
    }, [input]);

    const handleSend = () => {
        if (!input.trim() || isLoading) return;
        onSend(input.trim());
        setInput('');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleQuickAction = (prompt: string) => {
        if (isLoading) return;
        onSend(prompt);
    };

    return (
        <div className="space-y-3">
            {/* 퀵 액션 버튼 */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {QUICK_ACTIONS.map((action, idx) => (
                    <button
                        key={idx}
                        onClick={() => handleQuickAction(action.prompt)}
                        disabled={isLoading}
                        className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            {/* 입력창 */}
            <div className="flex items-end gap-2 bg-zinc-100 dark:bg-zinc-800/50 rounded-2xl p-2 border border-zinc-200/50 dark:border-zinc-700/50">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="금융 관련 질문을 입력하세요..."
                    disabled={isLoading}
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none px-2 py-2 max-h-[150px]"
                />
                <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    size="icon"
                    className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 hover:from-purple-400 hover:to-fuchsia-400 text-white flex-shrink-0"
                >
                    {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Send className="h-4 w-4" />
                    )}
                </Button>
            </div>

            {/* 면책 조항 */}
            <p className="text-[10px] text-zinc-400 text-center">
                AI 응답은 투자 조언이 아닙니다. 투자 결정은 본인 책임입니다.
            </p>
        </div>
    );
}
