import type { Story, StoryDefault } from "@ladle/react";
import AnimatedDots from "../AnimatedDots";

export default {
  title: "app/shared/components/ui/AnimatedDots",
} satisfies StoryDefault;

export const WithinButton: Story = () => (
  <button className="inline-flex items-center gap-2 rounded-md bg-[#844ae9] px-4 py-2 text-white">
    Verificando
    <AnimatedDots text="" className="text-white" interval={350} />
  </button>
);

export const InlineText: Story = () => (
  <p className="text-sm text-muted-foreground">
    Conectando ao servidor
    <AnimatedDots text="" className="text-muted-foreground" />
  </p>
);
