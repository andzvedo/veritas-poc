import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import type { Verification } from "@veritas/shared";
import ResultsPanel from "./ResultsPanel";

export default {
  title: "Results/ResultsPanel",
} satisfies StoryDefault;

const ACCESSED_AT = "2026-10-19T10:00:00-03:00";

const sampleVerifications: Verification[] = [
  {
    id: "claim-1",
    claimId: "claim-1",
    segmentIds: ["seg-1"],
    originalQuote: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
    normalizedClaim: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
    transcriptConfirmed: true,
    atomicClaim: {
      id: "atomic-1",
      proposition: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
    },
    status: "COMPLETED",
    verdict: "INCONCLUSIVE",
    conclusion:
      "Afirmação alinhada a medições astronômicas, mas o payload legado não publica veredito SUPPORTED explícito.",
    mechanisms: [],
    supportedAspects: [],
    limitations: ["Contrato legado sem flag de sustentação explícita."],
    evidence: [
      {
        id: "ev-1",
        sourceId: "src-1",
        relation: "CONTEXTUALIZES",
        claimIds: ["atomic-1"],
        excerpt: "Órbita terrestre ≈ 365,25 dias.",
        explanation: "Contexto astronômico de referência.",
        verifiedContent: false,
      },
    ],
    sources: [
      {
        id: "src-1",
        title: "nasa.gov",
        publisher: "NASA",
        url: "https://www.nasa.gov/solar-system/earth",
        type: "OTHER",
        accessedAt: ACCESSED_AT,
      },
    ],
    revision: 1,
    createdAt: ACCESSED_AT,
    updatedAt: ACCESSED_AT,
  },
  {
    id: "claim-2",
    claimId: "claim-2",
    segmentIds: ["seg-2"],
    originalQuote: "O Brasil tem mais de 500 milhões de habitantes.",
    normalizedClaim: "O Brasil tem mais de 500 milhões de habitantes.",
    transcriptConfirmed: true,
    atomicClaim: {
      id: "atomic-2",
      proposition: "O Brasil tem mais de 500 milhões de habitantes.",
    },
    status: "COMPLETED",
    verdict: "MISLEADING",
    conclusion:
      "A ordem de grandeza populacional está distorcida frente aos dados oficiais.",
    mechanisms: [
      {
        code: "SELECTIVE_EVIDENCE",
        explanation: "O número citado não corresponde à série oficial do IBGE.",
        evidenceIds: ["ev-2"],
      },
    ],
    supportedAspects: ["O Brasil é um país populoso da América Latina."],
    limitations: [],
    evidence: [
      {
        id: "ev-2",
        sourceId: "src-2",
        relation: "CONTEXTUALIZES",
        claimIds: ["atomic-2"],
        excerpt: "População próxima de 215 milhões em 2024.",
        explanation: "Dado oficial de referência.",
        verifiedContent: false,
      },
    ],
    sources: [
      {
        id: "src-2",
        title: "ibge.gov.br",
        publisher: "IBGE",
        url: "https://www.ibge.gov.br/apps/populacao/projecao/",
        type: "PRIMARY",
        accessedAt: ACCESSED_AT,
      },
    ],
    revision: 1,
    createdAt: ACCESSED_AT,
    updatedAt: ACCESSED_AT,
  },
];

export const Loading: Story = () => (
  <div className="w-[664px] rounded-lg">
    <ResultsPanel
      status="loading"
      verifications={[]}
      onCancel={() => console.log("Cancel clicked")}
      onResultClick={() => {}}
    />
  </div>
);

export const Partial: Story = () => (
  <div className="w-[664px] rounded-lg">
    <ResultsPanel
      status="partial"
      verifications={sampleVerifications.slice(0, 1)}
      onCancel={() => console.log("Cancel clicked")}
      onResultClick={(resultId) => console.log("Selecionado:", resultId)}
      selectedResultId={sampleVerifications[0].id}
    />
  </div>
);

export const Complete: Story = () => {
  const [selectedResultId, setSelectedResultId] = useState<string>(
    sampleVerifications[0].id,
  );

  return (
    <div className="w-[664px] rounded-lg">
      <ResultsPanel
        status="complete"
        verifications={sampleVerifications}
        onCopyPlainText={() => console.log("Copy Plain Text clicked")}
        onResultClick={(resultId) => {
          setSelectedResultId(resultId);
          console.log("Selecionado:", resultId);
        }}
        selectedResultId={selectedResultId}
      />
    </div>
  );
};

export const Scrollable: Story = () => {
  const manyVerifications = Array.from({ length: 8 }, (_, i) => ({
    ...sampleVerifications[0],
    id: `result-${i + 1}`,
    claimId: `result-${i + 1}`,
    originalQuote: `Afirmação de exemplo número ${i + 1} para demonstrar rolagem.`,
    normalizedClaim: `Afirmação de exemplo número ${i + 1} para demonstrar rolagem.`,
    conclusion: `Conclusão detalhada do resultado ${i + 1}.`,
    revision: i + 1,
  }));
  const [selectedResultId, setSelectedResultId] = useState<string>(
    manyVerifications[0].id,
  );

  return (
    <div className="w-[664px] space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Comportamento de Rolagem</h3>
        <p className="text-sm text-muted-foreground">
          Demonstração do painel com VerificationCard e rolagem
        </p>
      </div>

      <div className="h-screen rounded-lg">
        <ResultsPanel
          status="complete"
          verifications={manyVerifications}
          onCopyPlainText={() => console.log("Copy Plain Text clicked")}
          onResultClick={(resultId) => {
            setSelectedResultId(resultId);
            console.log("Selecionado:", resultId);
          }}
          selectedResultId={selectedResultId}
        />
      </div>
    </div>
  );
};

export const Error: Story = () => (
  <div className="w-[664px] space-y-6">
    <div className="rounded-lg">
      <ResultsPanel
        status="error"
        verifications={[]}
        onRetry={() => console.log("Retry clicked")}
        onResultClick={() => {}}
      />
    </div>
  </div>
);

export const Empty: Story = () => (
  <div className="w-[664px] space-y-6">
    <div className="rounded-lg">
      <ResultsPanel
        status="complete"
        verifications={[]}
        onCopyPlainText={() => console.log("Copy Plain Text clicked")}
        onResultClick={() => {}}
      />
    </div>
  </div>
);

export const Interactive: Story = () => {
  const [status, setStatus] = useState<"loading" | "partial" | "complete" | "error">(
    "loading",
  );
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [lastAction, setLastAction] = useState<string>("");
  const [selectedResultId, setSelectedResultId] = useState<string | undefined>(
    undefined,
  );

  const simulateLoading = () => {
    setStatus("loading");
    setVerifications([]);
    setLastAction("Iniciando carregamento...");

    setTimeout(() => {
      setStatus("partial");
      setVerifications([sampleVerifications[0]]);
      setLastAction("Carregamento parcial...");
      setSelectedResultId(sampleVerifications[0].id);
    }, 2000);

    setTimeout(() => {
      setStatus("complete");
      setVerifications(sampleVerifications);
      setLastAction("Carregamento completo!");
      setSelectedResultId(sampleVerifications[0].id);
    }, 4000);
  };

  return (
    <div className="w-[664px] space-y-6">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={simulateLoading}
          className="rounded bg-blue-100 px-3 py-1 text-sm text-blue-800 hover:bg-blue-200"
        >
          Simular Carregamento
        </button>
        <button
          onClick={() => {
            setStatus("error");
            setVerifications([]);
            setLastAction("Erro simulado");
            setSelectedResultId(undefined);
          }}
          className="rounded bg-red-100 px-3 py-1 text-sm text-red-800 hover:bg-red-200"
        >
          Simular Erro
        </button>
        <button
          onClick={() => {
            setStatus("loading");
            setVerifications([]);
            setLastAction("Reset executado");
            setSelectedResultId(undefined);
          }}
          className="rounded bg-gray-100 px-3 py-1 text-sm text-gray-800 hover:bg-gray-200"
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg">
        <ResultsPanel
          status={status}
          verifications={verifications}
          onCancel={() => setLastAction("Cancel clicked")}
          onRetry={() => {
            setLastAction("Retry clicked");
            setStatus("loading");
          }}
          onCopyPlainText={() => setLastAction("Copy Plain Text clicked")}
          onResultClick={(resultId) => {
            setSelectedResultId(resultId);
          }}
          selectedResultId={selectedResultId}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        <p>
          <strong>Status atual:</strong> {status}
        </p>
        <p>
          <strong>Verificações:</strong> {verifications.length}
        </p>
        <p>
          <strong>Última ação:</strong> {lastAction || "Nenhuma"}
        </p>
      </div>
    </div>
  );
};
