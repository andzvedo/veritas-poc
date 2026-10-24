import type { Story, StoryDefault } from "@ladle/react";
import HeroSection from "./HeroSection";

export default {
  title: "app/home/components/HeroSection",
} satisfies StoryDefault;

// Story responsiva
export const Default: Story = () => (
  <div className="w-full p-4 bg-white">
    <div className="max-w-2xl mx-auto">
      <HeroSection className="w-full" />
    </div>
  </div>
);
