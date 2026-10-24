import type { Story, StoryDefault } from "@ladle/react";
import HelperAccordion from "./HelperAccordion";

export default {
  title: "app/shared/components/HelperAccordion",
} satisfies StoryDefault;

export const Default: Story = () => (
  <div className="bg-neutral-100 p-8 flex justify-center">
    <HelperAccordion />
  </div>
);

export const InSetupContext: Story = () => (
  <div className="bg-neutral-100 p-8 flex flex-col items-center space-y-4">
    <p className="text-sm text-muted-foreground">
      O accordion fica logo acima do fluxo de cadastro de APIs, ajudando o usuário a entender por que as chaves são necessárias.
    </p>
    <HelperAccordion className="w-[514px]" />
  </div>
);
