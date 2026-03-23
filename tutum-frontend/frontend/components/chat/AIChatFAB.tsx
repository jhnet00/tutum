'use client';

import { useState, useEffect } from 'react';
import { X, Trash2, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChat } from '@/hooks/useChat';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { Button } from '@/components/ui/button';

interface AIChatFABProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  showLauncher?: boolean;
}

export function AIChatFAB({ isOpen: controlledIsOpen, onOpenChange, showLauncher = true }: AIChatFABProps) {
    const isControlled = typeof controlledIsOpen === 'boolean';
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
    const [mounted, setMounted] = useState(false);
    const { messages, sendMessage, isLoading, clearMessages } = useChat();

    const setOpen = (next: boolean) => {
      if (isControlled) {
        onOpenChange?.(next);
      } else {
        setInternalIsOpen(next);
        onOpenChange?.(next);
      }
    };

    // Immediate mount handling for visibility
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;
    if (!showLauncher && !isOpen) return null;

    return (
        <>

            {/* Floating Action Button - Static Fixed */}
            {showLauncher && !isOpen && (
                <motion.div
                    key="ai-chat-fab-main"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setOpen(true)}
                    className="fixed bottom-10 right-10 z-[70] cursor-pointer"
                >
                    <button
                        className="relative flex items-center gap-2 bg-gradient-to-r from-purple-600 to-fuchsia-500 hover:from-purple-500 hover:to-fuchsia-400 text-white shadow-lg shadow-purple-500/25 transition-all duration-300 rounded-full group"
                    >
                        <div className="flex items-center gap-2.5 px-6 py-4">
                            <Bot className="h-6 w-6 group-hover:scale-110 transition-transform duration-300" />
                            <span className="text-sm font-black tracking-tight">Tutum AI</span>
                        </div>
                    </button>
                </motion.div>
            )}

            {/* Backdrop */}
            <AnimatePresence>
                {isOpen && (
                <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setOpen(false)}
                        className="fixed inset-0 bg-black/20 z-[75]"
                    />
                )}
            </AnimatePresence>

            {/* Slide-in Chat Panel */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed top-16 right-0 h-[calc(100%-64px)] w-full sm:w-[420px] bg-white dark:bg-zinc-950 shadow-2xl z-[80] flex flex-col border-l border-zinc-200 dark:border-zinc-800"
                    >
                        {/* Panel Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-gradient-to-r from-zinc-900/10 to-fuchsia-500/8 dark:from-zinc-950/20 dark:to-fuchsia-900/20">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-500 flex items-center justify-center text-white shadow-lg">
                                    <Bot className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                                        Tutum AI
                                        <span className="text-[9px] font-medium px-1.5 py-0.5 bg-fuchsia-100 dark:bg-fuchsia-900/30 text-fuchsia-600 dark:text-fuchsia-300 rounded-full uppercase tracking-wider">
                                            Beta
                                        </span>
                                    </h2>
                                    <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                        금융 AI 어시스턴트
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-1">
                                {messages.length > 0 && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={clearMessages}
                                        className="h-8 w-8 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setOpen(false)}
                                    className="h-8 w-8 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Chat Messages */}
                        <div className="flex-1 overflow-y-auto">
                            <ChatMessages messages={messages} onSuggestionClick={sendMessage} />
                        </div>

                        {/* Chat Input */}
                        <div className="border-t border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950">
                            <ChatInput onSend={sendMessage} isLoading={isLoading} />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
