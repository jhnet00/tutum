"use client";

import { useEffect } from "react";
import { XIcon } from "./Icons";

interface SlideInPanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function SlideInPanel({
  isOpen,
  onClose,
  title,
  children,
}: SlideInPanelProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 right-0 max-w-full pl-10">
        <div className="h-full w-screen max-w-md transform bg-white shadow-2xl transition-transform dark:bg-zinc-950">
          <div className="flex h-16 items-center justify-between border-b border-zinc-100 px-6 dark:border-zinc-800">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
            >
              <XIcon className="h-6 w-6" />
            </button>
          </div>
          <div className="relative flex-1 px-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
