import type { Story, StoryDefault } from "@ladle/react";
import { useState, useEffect, useMemo } from "react";
import ResultsPage from "./ResultsPage";
import { useFactCheckStore } from "@/lib/store/factCheckStore";
import type { FactCheckResult } from "@veritas/shared";
import type { ComponentProps } from "react";

const ACCESSED_AT = "2025-01-10T12:00:00.000Z";

const demoSource = (id: string, title: string, url: string) => ({
  id,
  title,
  publisher: "example.org",
  url,
  type: "SECONDARY" as const,
  accessedAt: ACCESSED_AT,
});

const demoEvidence = (
  id: string,
  sourceId: string,
  relation: "SUPPORTS" | "REFUTES" | "CONTEXTUALIZES",
  excerpt: string,
) => ({
  id,
  sourceId,
  relation,
  claimIds: ["claim-demo"],
  excerpt,
  explanation: excerpt,
  verifiedContent: true,
});

// Mock data para demonstração (contrato migrado LIVE-016: verification.verdict)
const createMockResults = (): FactCheckResult[] => [
  {
    data: {
      extractedClaim: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
      reasoningConfidence: 0.95,
      reasoning: "Esta é uma afirmação cientificamente comprovada. A Terra completa uma órbita ao redor do Sol em 365,25 dias, o que define um ano solar.",
      sources: [
        "https://www.nasa.gov/solar-system/earth",
        "https://en.wikipedia.org/wiki/Earth%27s_orbit"
      ],
      resultVersion: 1,
      verification: {
        id: "verification-demo-0",
        claimId: "claim-demo-0",
        segmentIds: ["text-chunk-0"],
        originalQuote: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
        normalizedClaim: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
        transcriptConfirmed: true,
        atomicClaim: {
          id: "atomic-demo-0",
          proposition: "A Terra gira em torno do Sol em aproximadamente 365 dias.",
        },
        status: "COMPLETED",
        verdict: "SUPPORTED",
        conclusion: "Afirmação sustentada pelos documentos inspecionados.",
        mechanisms: [],
        supportedAspects: [],
        limitations: [],
        evidence: [
          demoEvidence(
            "ev-demo-0",
            "src-demo-0",
            "SUPPORTS",
            "A Terra completa uma órbita ao redor do Sol em cerca de 365 dias.",
          ),
        ],
        sources: [
          demoSource(
            "src-demo-0",
            "NASA — Earth",
            "https://www.nasa.gov/solar-system/earth",
          ),
        ],
        revision: 0,
        createdAt: ACCESSED_AT,
        updatedAt: ACCESSED_AT,
      },
    },
    meta: {
      fingerprint: "demo-fingerprint-1",
      chunk: 0,
      seq: 0
    }
  },
  {
    data: {
      extractedClaim: "O Brasil tem mais de 500 milhões de habitantes.",
      reasoningConfidence: 0.88,
      reasoning: "Esta afirmação está incorreta. Segundo dados do IBGE, o Brasil tem aproximadamente 215 milhões de habitantes em 2024.",
      flags: ["MISLEADING"],
      sources: [
        "https://www.ibge.gov.br/apps/populacao/projecao/",
        "https://pt.wikipedia.org/wiki/Demografia_do_Brasil"
      ],
      resultVersion: 1,
      verification: {
        id: "verification-demo-1",
        claimId: "claim-demo-1",
        segmentIds: ["text-chunk-0"],
        originalQuote: "O Brasil tem mais de 500 milhões de habitantes.",
        normalizedClaim: "O Brasil tem mais de 500 milhões de habitantes.",
        transcriptConfirmed: true,
        atomicClaim: {
          id: "atomic-demo-1",
          proposition: "O Brasil tem mais de 500 milhões de habitantes.",
        },
        status: "COMPLETED",
        verdict: "FALSE",
        conclusion: "A população do Brasil é de cerca de 215 milhões de habitantes.",
        contradiction: "O IBGE estima cerca de 215 milhões, não 500 milhões.",
        contradictionEvidenceIds: ["ev-demo-1"],
        mechanisms: [],
        supportedAspects: [],
        limitations: [],
        evidence: [
          demoEvidence(
            "ev-demo-1",
            "src-demo-1",
            "REFUTES",
            "O Brasil tem aproximadamente 215 milhões de habitantes.",
          ),
        ],
        sources: [
          demoSource(
            "src-demo-1",
            "IBGE",
            "https://www.ibge.gov.br/apps/populacao/projecao/",
          ),
        ],
        revision: 0,
        createdAt: ACCESSED_AT,
        updatedAt: ACCESSED_AT,
      },
    },
    meta: {
      fingerprint: "demo-fingerprint-1",
      chunk: 0,
      seq: 1
    }
  },
  {
    data: {
      extractedClaim: "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos.",
      reasoningConfidence: 0.72,
      reasoning: "Esta previsão não tem consenso entre especialistas. Enquanto a IA certamente impactará o mercado de trabalho, a substituição completa de todos os empregos em apenas 5 anos é considerada improvável pela maioria dos pesquisadores.",
      flags: ["INCONCLUSIVE"],
      sources: [
        "https://www.mckinsey.com/featured-insights/future-of-work",
        "https://www.weforum.org/reports/the-future-of-jobs-report-2023"
      ],
      resultVersion: 1,
      verification: {
        id: "verification-demo-2",
        claimId: "claim-demo-2",
        segmentIds: ["text-chunk-0"],
        originalQuote: "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos.",
        normalizedClaim: "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos.",
        transcriptConfirmed: true,
        atomicClaim: {
          id: "atomic-demo-2",
          proposition: "A inteligência artificial vai substituir todos os empregos nos próximos 5 anos.",
        },
        status: "COMPLETED",
        verdict: "INCONCLUSIVE",
        conclusion: "As evidências reunidas não permitem confirmar nem refutar a previsão.",
        mechanisms: [],
        supportedAspects: [],
        limitations: ["Não há consenso documental suficiente sobre o prazo de 5 anos."],
        evidence: [],
        sources: [
          demoSource(
            "src-demo-2",
            "WEF Future of Jobs",
            "https://www.weforum.org/reports/the-future-of-jobs-report-2023",
          ),
        ],
        revision: 0,
        createdAt: ACCESSED_AT,
        updatedAt: ACCESSED_AT,
      },
    },
    meta: {
      fingerprint: "demo-fingerprint-1",
      chunk: 0,
      seq: 2
    }
  }
];

// Componente auxiliar que inicializa o store com mock data
type ResultsPageStoryProps = {
  text?: string;
  mockResults?: FactCheckResult[];
} & Pick<ComponentProps<typeof ResultsPage>, "onNewVerification">;

const ResultsPageWithMockData: React.FC<ResultsPageStoryProps> = ({
  text = "Este é um texto de exemplo para demonstração da página de resultados.",
  mockResults,
  onNewVerification,
}) => {
  const updateStore = useFactCheckStore((state) => state.update);
  const resetStore = useFactCheckStore((state) => state.reset);

  const resolvedResults = useMemo(() => mockResults ?? createMockResults(), [mockResults]);

  useEffect(() => {
    updateStore({
      status: 'finished',
      processedText: text,
      results: resolvedResults,
      fingerprint: 'demo-fingerprint-1',
    });

    return () => {
      resetStore();
    };
  }, [text, resolvedResults, updateStore, resetStore]);

  return <ResultsPage text={text} demoMode={true} onNewVerification={onNewVerification} />;
};

export default {
  title: "Pages/ResultsPage",
} satisfies StoryDefault;

export const Default: Story = () => (
  <div className="h-screen">
    <ResultsPageWithMockData />
  </div>
);

export const CustomText: Story = () => (
  <div className="h-screen">
    <ResultsPageWithMockData
      text="Este é um texto personalizado para demonstração da página de resultados. O sistema irá processar e verificar este texto específico."
    />
  </div>
);

export const LongText: Story = () => (
  <div className="h-screen">
    <ResultsPageWithMockData
      text={`
Este é um texto muito longo para demonstrar como a página de resultados lida com textos extensos.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incididunt ut labore et dolore magnam aliquam quaerat voluptatem.

Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur?

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.

Et harum quidem rerum facilis est et expedita distinctio. Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.

Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae. Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.
      `.trim()}
    />
  </div>
);

export const Interactive: Story = () => {
  const [text, setText] = useState("Este é um texto de exemplo para demonstração da página de resultados.");
  const [mockResults] = useState(() => createMockResults());

  const handleNewVerification = () => {
    console.log('Nova verificação iniciada!');
    setText("Novo texto para verificação: " + new Date().toLocaleTimeString());
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">ResultsPage Interativo</h3>
        <p className="text-sm text-muted-foreground">
          Esta página demonstra o fluxo completo de resultados com simulação de dados
        </p>
      </div>

      <div className="h-screen">
        <ResultsPageWithMockData
          text={text}
          mockResults={mockResults}
          onNewVerification={handleNewVerification}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        <p><strong>Texto atual:</strong> {text}</p>
        <p><strong>Caracteres:</strong> {text.length}</p>
      </div>
    </div>
  );
};

export const WithModalConfirmation: Story = () => {
  const [text, setText] = useState("Este é um texto de exemplo para demonstrar o modal de confirmação.");
  const [mockResults] = useState(() => createMockResults());

  const handleNewVerification = () => {
    console.log('Nova verificação confirmada!');
    setText("Novo texto para verificação: " + new Date().toLocaleTimeString());
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">ResultsPage com Modal de Confirmação</h3>
        <p className="text-sm text-muted-foreground">
          Demonstra o modal de confirmação que aparece ao clicar no botão &ldquo;Novo&rdquo;
        </p>
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800">
            <strong>Como testar:</strong> Clique no botão &ldquo;Novo&rdquo; na coluna esquerda para ver o modal de confirmação.
          </p>
        </div>
      </div>

      <div className="h-screen">
        <ResultsPageWithMockData
          text={text}
          mockResults={mockResults}
          onNewVerification={handleNewVerification}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        <p><strong>Texto atual:</strong> {text}</p>
        <p><strong>Caracteres:</strong> {text.length}</p>
        <p><strong>Modal:</strong> Aparece automaticamente ao clicar em &ldquo;Novo&rdquo;</p>
      </div>
    </div>
  );
};
