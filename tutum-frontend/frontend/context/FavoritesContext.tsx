"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface FavoritesContextType {
    favorites: string[];
    toggleFavorite: (symbol: string) => void;
    isFavorite: (symbol: string) => boolean;
}

const FavoritesContext = createContext<FavoritesContextType | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
    const [favorites, setFavorites] = useState<string[]>([]);

    // Optional: Persist to localStorage
    useEffect(() => {
        const stored = localStorage.getItem("tutum_favorites");
        if (stored) {
            try {
                setFavorites(JSON.parse(stored));
            } catch (e) {
                console.error("Failed to parse favorites", e);
                localStorage.removeItem("tutum_favorites");
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem("tutum_favorites", JSON.stringify(favorites));
    }, [favorites]);

    const toggleFavorite = (symbol: string) => {
        setFavorites((prev) =>
            prev.includes(symbol)
                ? prev.filter((s) => s !== symbol)
                : [...prev, symbol]
        );
    };

    const isFavorite = (symbol: string) => favorites.includes(symbol);

    return (
        <FavoritesContext.Provider value={{ favorites, toggleFavorite, isFavorite }}>
            {children}
        </FavoritesContext.Provider>
    );
}

export function useFavorites() {
    const context = useContext(FavoritesContext);
    if (context === undefined) {
        throw new Error("useFavorites must be used within a FavoritesProvider");
    }
    return context;
}
