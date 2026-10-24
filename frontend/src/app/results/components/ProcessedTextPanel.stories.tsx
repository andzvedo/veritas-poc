import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useState } from "react";
import ProcessedTextPanel from "./ProcessedTextPanel";
import type { ResultData } from "@/lib/types/results";

export default {
  title: "app/results/components/ProcessedTextPanel",
} satisfies StoryDefault;

const sampleText = [
  "A Terra gira em torno do Sol em aproximadamente 365 dias. ",
  "O Brasil tem mais de 500 milhões de habitantes. ",
  "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos."
].join("");

const sampleResults: ResultData[] = [
  {
    id: "claim-1",
    text: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
    confidence: 0.95,
    status: "verified",
    explanation: "Afirmação cientificamente comprovada com base em medições astronômicas.",
    sources: ["https://www.nasa.gov/solar-system/earth"]
  },
  {
    id: "claim-2",
    text: "O Brasil tem mais de 500 milhões de habitantes.",
    confidence: 0.82,
    status: "unverified",
    explanation: "Dados oficiais do IBGE indicam população próxima de 215 milhões em 2024.",
    sources: [
      "https://www.ibge.gov.br/apps/populacao/projecao/",
      "https://pt.wikipedia.org/wiki/Demografia_do_Brasil"
    ]
  },
  {
    id: "claim-3",
    text: "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos.",
    confidence: 0.63,
    status: "pending",
    explanation: "Especialistas divergem sobre o impacto total no período citado.",
    sources: ["https://www.weforum.org/reports/the-future-of-jobs-report-2023"]
  }
];

export const Default: Story = () => {
  const [selectedClaimId, setSelectedClaimId] = useState<string | undefined>(sampleResults[0].id);

  return (
    <div className="h-[520px] border border-gray-200 rounded-lg">
      <ProcessedTextPanel
        text={sampleText}
        results={sampleResults}
        selectedClaimId={selectedClaimId}
        onClaimClick={(claimId) => {
          setSelectedClaimId(claimId);
          console.log("Claim selecionado:", claimId);
        }}
        onNewVerification={() => console.log("Solicitar nova verificação")}
      />
    </div>
  );
};

export const WithLongerText: Story = () => {
  const extendedText = useMemo(
    () =>
      [
        sampleText,
        "\n\n",
        "Também analisamos a evolução das fontes citadas para garantir que os links continuem válidos.",
        " Este bloco extra ilustra rolagem dentro do painel."
      ].join(""),
    []
  );
  return (
    <div className="h-[520px] border border-gray-200 rounded-lg">
      <ProcessedTextPanel
        text={extendedText}
        results={sampleResults}
        onNewVerification={() => console.log("Solicitar nova verificação")}
      />
    </div>
  );
};

export const WithoutResults: Story = () => (
  <div className="h-[400px] border border-gray-200 rounded-lg">
    <ProcessedTextPanel
      text="O texto original aparece aqui mesmo quando nenhuma afirmação é encontrada."
      results={[]}
      onNewVerification={() => console.log("Solicitar nova verificação")}
    />
  </div>
);
