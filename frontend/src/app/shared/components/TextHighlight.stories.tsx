import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import { TextHighlight, type Claim } from "./TextHighlight";

export default {
  title: "veritas/results/TextHighlight",
} satisfies StoryDefault;

// Dados de exemplo
const sampleText = `Speaker 1
Welcome to our comprehensive exploration of climate change and its extensive impacts on our planet. In this discussion.

Global temperatures have risen by 10 degrees.

Speaker 2

The Paris Agreement was signed in 2015 to address this issue. We will delve into the myriad effects that climate change has on ecosystems, including the disruption of habitats and the extinction of species. Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C (2°F) since the late 19th century, highlighting the urgent need for climate action.

We will also examine how weather patterns are altered, leading to more severe storms, droughts, and unpredictable seasons.

Speaker 1

Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C. (2°F) since the late 19th century, highlighting the urgent need for climate action.`;

const sampleClaims: Claim[] = [
  {
    id: "claim-1",
    number: 1,
    text: "Global temperatures have risen by 10 degrees",
    startIndex: sampleText.indexOf("Global temperatures have risen by 10 degrees"),
    endIndex: sampleText.indexOf("Global temperatures have risen by 10 degrees") + "Global temperatures have risen by 10 degrees".length
  },
  {
    id: "claim-2",
    number: 2,
    text: "Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C (2°F) since the late 19th century, highlighting the urgent need for climate action",
    startIndex: sampleText.indexOf("Recent studies from NASA and NOAA indicate"),
    endIndex: sampleText.indexOf("Recent studies from NASA and NOAA indicate") + "Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C (2°F) since the late 19th century, highlighting the urgent need for climate action".length
  },
  {
    id: "claim-3",
    number: 3,
    text: "Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C",
    startIndex: sampleText.lastIndexOf("Recent studies from NASA and NOAA indicate"),
    endIndex: sampleText.lastIndexOf("Recent studies from NASA and NOAA indicate") + "Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C".length
  }
];

/**
 * Estado 1: Sem Highlights
 * Texto plano sem nenhuma claim destacada
 */
export const SemHighlights: Story = () => {
  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Sem Highlights</h3>
        <p className="text-sm text-muted-foreground">
          Texto processado sem claims identificadas
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={sampleText}
          claims={[]}
        />
      </div>
    </div>
  );
};

/**
 * Estado 2: Com Highlights
 * Claims numeradas e destacadas em roxo
 */
export const ComHighlights: Story = () => {
  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Com Highlights</h3>
        <p className="text-sm text-muted-foreground">
          Claims identificadas e numeradas em roxo (#5d13dd)
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={sampleText}
          claims={sampleClaims}
        />
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Comportamento:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Claims numeradas (1., 2., 3.)</li>
          <li>Cor do texto: #5d13dd</li>
          <li>Hover mostra underline</li>
          <li>Click seleciona a claim</li>
        </ul>
      </div>
    </div>
  );
};

/**
 * Estado 3: Hover State
 * Demonstra o underline ao passar o mouse
 */
export const HoverState: Story = () => {
  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Hover State</h3>
        <p className="text-sm text-muted-foreground">
          Passe o mouse sobre as claims para ver o underline
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={sampleText}
          claims={sampleClaims}
        />
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Especificações do Hover:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Underline color: rgba(93,19,221,0.5)</li>
          <li>Underline offset: 55%</li>
          <li>Text decoration skip ink: none</li>
        </ul>
      </div>
    </div>
  );
};

/**
 * Estado 4: Selected State
 * Claim selecionada com background roxo claro
 */
export const SelectedState: Story = () => {
  const [selectedId, setSelectedId] = useState<string>("claim-1");

  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Selected State</h3>
        <p className="text-sm text-muted-foreground">
          Claim selecionada com background e texto mais escuro
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={sampleText}
          claims={sampleClaims}
          selectedClaimId={selectedId}
          onClaimClick={setSelectedId}
        />
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Estado atual:</strong> Claim {sampleClaims.find(c => c.id === selectedId)?.number} selecionada</p>
        <p><strong>Especificações:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Background: #e3d9f7</li>
          <li>Text color: #4200b4</li>
          <li>Underline: rgba(66,0,180,0.85)</li>
          <li>Resto do texto: opacity 70%</li>
        </ul>
      </div>
    </div>
  );
};

/**
 * Estado 5: Interativo Completo
 * Demonstra todos os estados em um componente interativo
 */
export const Interactive: Story = () => {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const handleClaimClick = (claimId: string) => {
    // Toggle selection
    setSelectedId(prev => prev === claimId ? undefined : claimId);
  };

  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Componente Interativo</h3>
        <p className="text-sm text-muted-foreground">
          Clique nas claims para selecionar/desselecionar
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={sampleText}
          claims={sampleClaims}
          selectedClaimId={selectedId}
          onClaimClick={handleClaimClick}
        />
      </div>

      <div className="space-y-3">
        <div className="text-xs text-muted-foreground">
          <p><strong>Estado atual:</strong> {selectedId ? `Claim ${sampleClaims.find(c => c.id === selectedId)?.number} selecionada` : 'Nenhuma claim selecionada'}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setSelectedId(undefined)}
            className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
          >
            Limpar Seleção
          </button>
          <button
            onClick={() => setSelectedId("claim-1")}
            className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 rounded"
          >
            Selecionar Claim 1
          </button>
          <button
            onClick={() => setSelectedId("claim-2")}
            className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 rounded"
          >
            Selecionar Claim 2
          </button>
          <button
            onClick={() => setSelectedId("claim-3")}
            className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 rounded"
          >
            Selecionar Claim 3
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Estado 6: Texto Curto
 * Exemplo com texto mais curto e uma única claim
 */
export const TextoCurto: Story = () => {
  const shortText = "Global temperatures have risen by 10 degrees in the last decade.";
  const shortClaim: Claim[] = [
    {
      id: "claim-short",
      number: 1,
      text: "Global temperatures have risen by 10 degrees",
      startIndex: 0,
      endIndex: 45
    }
  ];

  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Texto Curto</h3>
        <p className="text-sm text-muted-foreground">
          Exemplo com uma única claim em texto curto
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={shortText}
          claims={shortClaim}
        />
      </div>
    </div>
  );
};

/**
 * Estado 7: Múltiplas Claims Próximas
 * Testa claims que aparecem próximas umas das outras
 */
export const MultiplasClaims: Story = () => {
  const multiText = "The temperature rose by 2°C. Studies show 1.5°C warming. Scientists warn of 3°C increase.";
  const multiClaims: Claim[] = [
    {
      id: "multi-1",
      number: 1,
      text: "temperature rose by 2°C",
      startIndex: 4,
      endIndex: 27
    },
    {
      id: "multi-2",
      number: 2,
      text: "1.5°C warming",
      startIndex: 42,
      endIndex: 55
    },
    {
      id: "multi-3",
      number: 3,
      text: "3°C increase",
      startIndex: 75,
      endIndex: 87
    }
  ];

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-6 max-w-4xl p-8">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Múltiplas Claims Próximas</h3>
        <p className="text-sm text-muted-foreground">
          Testa o comportamento com várias claims em texto curto
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <TextHighlight
          text={multiText}
          claims={multiClaims}
          selectedClaimId={selectedId}
          onClaimClick={setSelectedId}
        />
      </div>
    </div>
  );
};
