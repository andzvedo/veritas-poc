import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import VerificationTextArea from "./VerificationTextArea";

export default {
  title: "app/shared/components/VerificationTextArea",
} satisfies StoryDefault;

export const Default: Story = () => {
  const [value, setValue] = useState("");

  const handleUseExample = () => {
    setValue(
      "A Organização Mundial da Saúde afirmou que a vacinação reduziu em 85% as internações por doenças respiratórias graves em 2023."
    );
  };

  return (
    <div className="max-w-[620px]">
      <VerificationTextArea
        value={value}
        onChange={setValue}
        onUseExample={handleUseExample}
        onVerify={() => console.log("Verificar fatos:", value)}
      />
    </div>
  );
};

export const OverCharacterLimit: Story = () => {
  const [value, setValue] = useState("A".repeat(5100));

  return (
    <div className="max-w-[620px]">
      <VerificationTextArea
        value={value}
        onChange={setValue}
        onUseExample={() => setValue("A".repeat(5100))}
        onVerify={() => console.log("Tentativa de verificar com texto acima do limite")}
      />
    </div>
  );
};
