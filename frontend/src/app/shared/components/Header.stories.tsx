import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import Header from "./Header";
import { Button } from "@/app/shared/components/ui/button";

export default {
  title: "app/shared/components/Header",
} satisfies StoryDefault;

export const Default: Story = () => {
  const [lastAction, setLastAction] = useState<string>("Nenhuma ação");

  return (
    <div className="bg-neutral-100 p-6 space-y-4">
      <Header
        showSettings
        onSettingsClick={() => {
          console.log("Abrir configurações de API");
          setLastAction("Configurações clicadas");
        }}
      />
      <p className="text-sm text-muted-foreground">
        <strong>Última ação:</strong> {lastAction}
      </p>
    </div>
  );
};

export const WithoutSettings: Story = () => (
  <div className="bg-neutral-100 p-6">
    <Header />
  </div>
);

export const WithCustomActions: Story = () => (
  <div className="bg-neutral-100 p-6">
    <Header
      rightContent={
        <Button variant="outlined" size="sm" onClick={() => console.log("Ação customizada")}>
          Entrar em Contato
        </Button>
      }
    />
  </div>
);
