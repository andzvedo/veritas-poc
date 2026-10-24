import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import ResultCard from "./ResultCard";

export default {
  title: "app/results/components/ResultCard",
} satisfies StoryDefault;

const EXAMPLE_TEXT = "As vacinas contra COVID-19 foram desenvolvidas em tempo recorde em 2020.";
const EXAMPLE_EXPLANATION = "A afirmação é verdadeira. Diversas vacinas contra a COVID-19, como as da Pfizer-BioNTech e Moderna, foram desenvolvidas e receberam autorização de uso emergencial em 2020, menos de um ano após a identificação do vírus. Este foi um feito sem precedentes na história da vacinologia, impulsionado por investimentos massivos, colaboração científica global e novas tecnologias.";
const EXAMPLE_SOURCES = [
  "https://www.nasa.gov/climate",
  "https://www.noaa.gov/climate",
  "https://www.ipcc.ch/reports",
  "https://climate.nasa.gov/evidence",
  "https://www.climate.gov/news-features"
];

const LONG_TEXT = "According to NASA and NOAA data, global temperatures have risen by approximately 1.1°C (2°F) since the pre-industrial era, not 10 degrees in a single year. According to NASA and NOAA data, global temperatures have risen by approximately 1.1°C (2°F) since the pre-industrial era.";
const LONG_EXPLANATION = "The Paris Agreement was signed in 2015 to address this issue. We will delve into the myriad effects that climate change has on ecosystems, including the disruption of habitats and the extinction of species. Recent studies from NASA and NOAA indicate that global temperatures have increased by about 1.1°C (2°F) since the late 19th century, highlighting the urgent need for climate action.\n\nWe will also examine how weather patterns are altered, leading to more severe storms, droughts, and unpredictable seasons.";

// Story interativa com múltiplos cards
export const Interactive: Story = () => {
  const [selectedId, setSelectedId] = useState<string | null>("card-1");

  const cards = [
    {
      id: "card-1",
      text: EXAMPLE_TEXT,
      explanation: EXAMPLE_EXPLANATION,
      sources: EXAMPLE_SOURCES,
    },
    {
      id: "card-2",
      text: "O Brasil iniciou sua campanha de vacinação em janeiro de 2021.",
      explanation: "A afirmação é verdadeira. O Brasil iniciou oficialmente sua campanha de vacinação contra COVID-19 em 17 de janeiro de 2021, com a enfermeira Mônica Calazans sendo a primeira pessoa vacinada no país.",
      sources: [
        "https://www.gov.br/saude",
        "https://www.fiocruz.br/noticias"
      ],
    },
    {
      id: "card-3",
      text: LONG_TEXT,
      explanation: LONG_EXPLANATION,
      sources: EXAMPLE_SOURCES,
    }
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto p-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">ResultCard - Estados Interativos</h3>
        <p className="text-sm text-muted-foreground">
          Clique nos cards para alternar entre os estados. O primeiro card mostra o estado selecionado,
          os demais mostram hover ao passar o mouse.
        </p>
      </div>

      <div className="space-y-4">
        {cards.map((card, index) => (
          <ResultCard
            key={card.id}
            id={card.id}
            text={card.text}
            explanation={card.explanation}
            sources={card.sources}
            index={index + 1}
            isSelected={selectedId === card.id}
            onClick={() => setSelectedId(card.id)}
          />
        ))}
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p><strong>Card Selecionado:</strong> {selectedId || "Nenhum"}</p>
        <p><strong>Estados:</strong></p>
        <ul className="list-disc list-inside ml-2">
          <li>Default: Borda cinza (#d9d9d9)</li>
          <li>Hover: Borda roxa (#b09ac5) + sombra sutil</li>
          <li>Selected: Borda roxa forte (#844ae9) + fundo roxo claro + sombra</li>
        </ul>
      </div>
    </div>
  );
};

// Estado Default
export const Default: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      explanation={EXAMPLE_EXPLANATION}
      sources={EXAMPLE_SOURCES}
      index={1}
      isSelected={false}
    />
  </div>
);

// Estado Selected
export const Selected: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      explanation={EXAMPLE_EXPLANATION}
      sources={EXAMPLE_SOURCES}
      index={1}
      isSelected={true}
    />
  </div>
);

// Sem fontes
export const WithoutSources: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      explanation={EXAMPLE_EXPLANATION}
      index={1}
      isSelected={false}
    />
  </div>
);

// Sem análise
export const WithoutExplanation: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      sources={EXAMPLE_SOURCES}
      index={1}
      isSelected={false}
    />
  </div>
);

// Apenas texto
export const TextOnly: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      index={1}
      isSelected={false}
    />
  </div>
);

// Texto longo
export const LongContent: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={LONG_TEXT}
      explanation={LONG_EXPLANATION}
      sources={EXAMPLE_SOURCES}
      index={1}
      isSelected={false}
    />
  </div>
);

// Múltiplas fontes
export const ManySources: Story = () => (
  <div className="max-w-4xl mx-auto p-6">
    <ResultCard
      text={EXAMPLE_TEXT}
      explanation={EXAMPLE_EXPLANATION}
      sources={[
        "https://www.nasa.gov/climate",
        "https://www.noaa.gov/climate",
        "https://www.ipcc.ch/reports",
        "https://climate.nasa.gov/evidence",
        "https://www.climate.gov/news-features",
        "https://www.who.int/health-topics/climate-change",
        "https://www.un.org/en/climatechange",
        "https://www.epa.gov/climate-change"
      ]}
      index={1}
      isSelected={false}
    />
  </div>
);
