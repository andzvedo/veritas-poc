import type { Story, StoryDefault } from "@ladle/react";
import React, { useEffect } from "react";
import HomePage from "./HomePage";

// Mock do router para o Ladle
const mockRouter = {
  push: (url: string) => {
    console.log(`Mock router push: ${url}`);
  },
};

export default {
  title: "app/home/components/HomePage",
} satisfies StoryDefault;

const ensureApiKeys = () => {
  if (typeof window === "undefined") return;
  const storageKey = "veritas_api_keys";
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        google: "AIzasy-demo-google-api-key",
        tavily: "tvly-demo-tavily-api-key",
      })
    );
  }
};

const HomePageStoryContainer: React.FC<{ widthClass?: string }> = ({ widthClass }) => {
  useEffect(() => {
    ensureApiKeys();
    return () => {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("veritas_api_keys");
      }
    };
  }, []);

  return (
    <div className={widthClass}>
      <HomePage router={mockRouter} />
    </div>
  );
};

// Story completa da Home Page
export const Default: Story = () => (
  <HomePageStoryContainer widthClass="w-full h-screen overflow-hidden" />
);

// Story mobile
export const Mobile: Story = () => (
  <HomePageStoryContainer widthClass="w-[375px] h-screen overflow-hidden mx-auto border border-gray-300" />
);
