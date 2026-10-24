import type { Story, StoryDefault } from "@ladle/react";
import { Button } from "./button";
import { WandSparkles } from "lucide-react";

export default {
  title: "app/shared/components/ui/button",
} satisfies StoryDefault;

// Filled Variants
export const Filled_Default_Enabled: Story = () => (
  <Button variant="filled">
    <WandSparkles /> Filled Enabled
  </Button>
);

export const Filled_Default_Disabled: Story = () => (
  <Button variant="filled" disabled>
    <WandSparkles /> Filled Disabled
  </Button>
);

export const Filled_SM_Enabled: Story = () => (
  <Button variant="filled" size="sm">
    <WandSparkles /> Filled Enabled
  </Button>
);

export const Filled_SM_Disabled: Story = () => (
  <Button variant="filled" size="sm" disabled>
    <WandSparkles /> Filled Disabled
  </Button>
);

// Outlined Variants
export const Outlined_Default_Enabled: Story = () => (
  <Button variant="outlined">
    <WandSparkles /> Outlined Enabled
  </Button>
);

export const Outlined_Default_Disabled: Story = () => (
  <Button variant="outlined" disabled>
    <WandSparkles /> Outlined Disabled
  </Button>
);

export const Outlined_SM_Enabled: Story = () => (
  <Button variant="outlined" size="sm">
    <WandSparkles /> Outlined Enabled
  </Button>
);

export const Outlined_SM_Disabled: Story = () => (
  <Button variant="outlined" size="sm" disabled>
    <WandSparkles /> Outlined Disabled
  </Button>
);

// Link Variants
export const Link_Default_Enabled: Story = () => (
  <Button variant="link">
    <WandSparkles /> Link Enabled
  </Button>
);

export const Link_Default_Disabled: Story = () => (
  <Button variant="link" disabled>
    <WandSparkles /> Link Disabled
  </Button>
);

export const Link_SM_Enabled: Story = () => (
  <Button variant="link" size="sm">
    <WandSparkles /> Link Enabled
  </Button>
);

export const Link_SM_Disabled: Story = () => (
  <Button variant="link" size="sm" disabled>
    <WandSparkles /> Link Disabled
  </Button>
);

// Matrix - All Variants
export const Matrix_All: Story = () => (
  <div className="flex flex-col gap-6">
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Filled Variants</h3>
      <div className="flex items-center gap-6">
        <Button variant="filled" size="sm" disabled>
          <WandSparkles /> Filled Disabled (SM)
        </Button>
        <Button variant="filled" size="sm">
          <WandSparkles /> Filled Enabled (SM)
        </Button>
      </div>
      <div className="flex items-center gap-6">
        <Button variant="filled" disabled>
          <WandSparkles /> Filled Disabled (Default)
        </Button>
        <Button variant="filled">
          <WandSparkles /> Filled Enabled (Default)
        </Button>
      </div>
    </div>

    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Outlined Variants</h3>
      <div className="flex items-center gap-6">
        <Button variant="outlined" size="sm" disabled>
          <WandSparkles /> Outlined Disabled (SM)
        </Button>
        <Button variant="outlined" size="sm">
          <WandSparkles /> Outlined Enabled (SM)
        </Button>
      </div>
      <div className="flex items-center gap-6">
        <Button variant="outlined" disabled>
          <WandSparkles /> Outlined Disabled (Default)
        </Button>
        <Button variant="outlined">
          <WandSparkles /> Outlined Enabled (Default)
        </Button>
      </div>
    </div>

    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Link Variants</h3>
      <div className="flex items-center gap-6">
        <Button variant="link" size="sm" disabled>
          <WandSparkles /> Link Disabled (SM)
        </Button>
        <Button variant="link" size="sm">
          <WandSparkles /> Link Enabled (SM)
        </Button>
      </div>
      <div className="flex items-center gap-6">
        <Button variant="link" disabled>
          <WandSparkles /> Link Disabled (Default)
        </Button>
        <Button variant="link">
          <WandSparkles /> Link Enabled (Default)
        </Button>
      </div>
    </div>

    <p className="text-xs text-foreground/70 mt-2">
      Dica: passe o mouse sobre os botões &quot;Hover&quot; para visualizar o estado de hover.
    </p>
  </div>
);
