// frontend/types/chat.ts
// AI 채팅 관련 타입 정의

export interface Source {
    type: 'price' | 'news' | 'portfolio';
    title: string;
    url?: string;
}

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: Source[];
    createdAt: Date;
    isStreaming?: boolean;
}

export interface Conversation {
    id: string;
    title: string;
    messages: Message[];
    createdAt: Date;
}
