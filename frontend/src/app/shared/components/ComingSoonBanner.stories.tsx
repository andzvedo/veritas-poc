import type { Story, StoryDefault } from "@ladle/react";
import ComingSoonBanner from "./ComingSoonBanner";

export default {
  title: "app/shared/components/ComingSoonBanner",
} satisfies StoryDefault;

export const Default: Story = () => (
  <div className="bg-white p-6">
    <ComingSoonBanner />
  </div>
);

export const EmbeddedInHero: Story = () => (
  <div className="bg-white p-6 space-y-6">
    <div>
      <h2 className="text-2xl font-semibold text-[#102148]">Cole o texto. Receba verificação de fatos.</h2>
      <p className="text-sm text-muted-foreground mt-2">
        Este banner aparece logo abaixo do título principal na home, destacando os formatos que chegarão em breve.
      </p>
    </div>
    <ComingSoonBanner />
  </div>
);
