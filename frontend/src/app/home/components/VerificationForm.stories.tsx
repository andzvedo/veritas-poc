import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import VerificationForm from "./VerificationForm";

export default {
  title: "app/home/components/VerificationForm",
} satisfies StoryDefault;

// Story interativa
export const Interactive: Story = () => {
  const [textValue, setTextValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUseExample = () => {
    const exampleText = "O presidente anunciou hoje que a economia cresceu 5% no último trimestre, segundo dados do IBGE. Esta é a maior taxa de crescimento dos últimos 10 anos e representa um marco histórico para o país.";
    setTextValue(exampleText);
  };

  const handleCheckFacts = () => {
    if (textValue.trim()) {
      setIsProcessing(true);
      console.log('Verificando fatos para:', textValue);

      // Simular loading
      setTimeout(() => {
        setIsProcessing(false);
        console.log('Verificação concluída');
      }, 3000);
    }
  };

  return (
    <div className="w-full max-w-[571px] p-4">
      <VerificationForm
        onUseExample={handleUseExample}
        onCheckFacts={handleCheckFacts}
        onTextChange={setTextValue}
        disabled={isProcessing}
        value={textValue}
      />
    </div>
  );
};

export const Disabled: Story = () => (
  <div className="w-full max-w-[571px] p-4">
    <VerificationForm
      onUseExample={() => console.log('Usar exemplo')}
      onCheckFacts={() => console.log('Verificar fatos')}
      onTextChange={() => {}}
      disabled
      value="Texto sendo processado..."
    />
  </div>
);
