import React, { useEffect } from "react";
import "../src/app/globals.css";
import type { GlobalProvider } from "@ladle/react";

// Garante que o localStorage está disponível para os stories
if (typeof window !== "undefined" && !window.localStorage) {
  console.warn("localStorage não disponível, criando mock");
  const storage: Record<string, string> = {};
  (window as typeof window & { localStorage: Storage }).localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
    removeItem: (key: string) => {
      delete storage[key];
    },
    clear: () => {
      Object.keys(storage).forEach((key) => delete storage[key]);
    },
    key: (index: number) => Object.keys(storage)[index] || null,
    get length() {
      return Object.keys(storage).length;
    },
  };
}

// Popula o localStorage com dados de exemplo para os stories
if (typeof window !== "undefined" && window.localStorage) {
  const existingKeys = window.localStorage.getItem("veritas_api_keys");
  if (!existingKeys) {
    window.localStorage.setItem(
      "veritas_api_keys",
      JSON.stringify({
        google: "mock-google-api-key-for-ladle",
        tavily: "mock-tavily-api-key-for-ladle",
      }),
    );
  }
}

const DEFAULT_LANG = "pt-BR";
const BODY_FONT_FALLBACK =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

const useRootLayoutBridge = () => {
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const html = document.documentElement;
    const previousLang = html.getAttribute("lang");
    const shouldRestoreLang = previousLang !== null && previousLang !== DEFAULT_LANG;
    if (previousLang !== DEFAULT_LANG) {
      html.setAttribute("lang", DEFAULT_LANG);
    }

    const body = document.body;
    const addedClasses: string[] = [];
    if (!body.classList.contains("antialiased")) {
      body.classList.add("antialiased");
      addedClasses.push("antialiased");
    }

    const previousFontFamily = body.style.fontFamily;
    const previousBackground = body.style.backgroundColor;
    const previousColor = body.style.color;

    if (!previousFontFamily) {
      body.style.fontFamily = BODY_FONT_FALLBACK;
    }
    if (!previousBackground) {
      body.style.backgroundColor = "var(--background)";
    }
    if (!previousColor) {
      body.style.color = "var(--foreground)";
    }

    return () => {
      if (shouldRestoreLang) {
        html.setAttribute("lang", previousLang as string);
      } else if (previousLang === null) {
        html.removeAttribute("lang");
      }

      addedClasses.forEach((cls) => body.classList.remove(cls));
      body.style.fontFamily = previousFontFamily;
      body.style.backgroundColor = previousBackground;
      body.style.color = previousColor;
    };
  }, []);
};

export const Provider: GlobalProvider = ({ children }) => {
  useRootLayoutBridge();
  return <>{children}</>;
};
