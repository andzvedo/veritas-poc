import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import { Textarea } from "./textarea";

export default {
  title: "app/shared/components/ui/textarea",
} satisfies StoryDefault;

export const Interactive: Story = () => {
  const [value, setValue] = useState("");

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">TextArea Interativo</h3>
        <p className="text-sm text-muted-foreground">
          Este componente gerencia automaticamente todos os estados:
        </p>
        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
          <li><strong>Default:</strong> Gradiente com opacidade 0.20</li>
          <li><strong>Focused:</strong> Gradiente com opacidade 0.50 enquanto o campo está em foco</li>
          <li><strong>Entered:</strong> Gradiente com opacidade 1.00 ao digitar</li>
          <li><strong>Error:</strong> Gradiente vermelho quando excede 5000 caracteres</li>
        </ul>
      </div>

      <Textarea
        label="Label"
        placeholder="Placeholder text..."
        maxLength={5000}
        value={value}
        onChange={setValue}
      />

      <div className="text-xs text-muted-foreground">
        <p><strong>Estado atual:</strong> {value.length === 0 ? 'Default' : value.length > 5000 ? 'Error' : 'Entered'}</p>
        <p><strong>Caracteres:</strong> {value.length}/5000</p>
      </div>
    </div>
  );
};

export const Disabled: Story = () => {
  const [value] = useState("Text entered...");

  return (
    <div className="space-y-4">
      <Textarea
        label="Label"
        placeholder="Placeholder text..."
        maxLength={5000}
        value={value}
        disabled
      />
      <p className="text-xs text-muted-foreground">
        Estado Disabled - Campo desabilitado com texto
      </p>
    </div>
  );
};
