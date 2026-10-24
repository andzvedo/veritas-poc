import type { Story, StoryDefault } from "@ladle/react";
import AnimatedDots from "./AnimatedDots";

export default {
  title: "app/shared/components/AnimatedDots",
} satisfies StoryDefault;

// Story básica
export const Basic: Story = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Animated Dots</h3>
        <p className="text-sm text-muted-foreground">
          Componente que anima pontos após um texto
        </p>
      </div>

      <div className="space-y-4">
        <div className="text-lg">
          <AnimatedDots text="Lendo Texto" />
        </div>
        <div className="text-lg">
          <AnimatedDots text="Verificando" />
        </div>
        <div className="text-lg">
          <AnimatedDots text="Processando" />
        </div>
      </div>
    </div>
  );
};

// Story com configurações diferentes
export const Customized: Story = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Customized Animated Dots</h3>
        <p className="text-sm text-muted-foreground">
          Diferentes configurações de velocidade e quantidade de pontos
        </p>
      </div>

      <div className="space-y-4">
        <div className="text-lg">
          <AnimatedDots text="Lento" interval={1000} />
        </div>
        <div className="text-lg">
          <AnimatedDots text="Rápido" interval={200} />
        </div>
        <div className="text-lg">
          <AnimatedDots text="5 pontos" maxDots={5} />
        </div>
        <div className="text-lg text-primary">
          <AnimatedDots text="Colorido" className="text-primary" />
        </div>
      </div>
    </div>
  );
};

// Story com contexto de uso
export const InContext: Story = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">In Context</h3>
        <p className="text-sm text-muted-foreground">
          Como aparece em contextos reais de loading
        </p>
      </div>

      {/* Simulação de card de loading */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-green-500 rounded-full animate-pulse"></div>
          <div className="text-lg font-semibold">
            <AnimatedDots text="Verificando" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Analisando o texto e verificando fatos...
        </p>
      </div>

      {/* Simulação de página de confirmação */}
      <div className="bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg p-8 text-center">
        <div className="w-12 h-12 bg-purple-100 rounded-full mx-auto mb-4 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
        <div className="text-xl font-medium mb-2">
          <AnimatedDots text="Lendo Texto" />
        </div>
        <p className="text-sm text-muted-foreground">
          Processando seu texto para verificação de fatos...
        </p>
      </div>
    </div>
  );
};
