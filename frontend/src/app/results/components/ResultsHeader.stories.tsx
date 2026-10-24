import type { Story, StoryDefault } from "@ladle/react";
import { useState } from "react";
import { ResultsHeader } from "./ResultsHeader";
import type { VerificationStatus } from "./ResultsHeader";
import { Button } from "@/app/shared/components/ui/button";

export default {
  title: "app/results/components/ResultsHeader",
} satisfies StoryDefault;

// Interactive story for testing all states
export const Interactive: Story = () => {
  const [status, setStatus] = useState<VerificationStatus>("verifying");
  const [lastAction, setLastAction] = useState<string>("");

  const handleCancel = () => {
    setLastAction("Cancel clicked");
    console.log("Cancel action triggered");
  };

  const handleRetry = () => {
    setLastAction("Retry clicked");
    setStatus("verifying");
    console.log("Retry action triggered");
  };

  const handleCopy = () => {
    setLastAction("Copy clicked");
    console.log("Copy action triggered");
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Results-Header Interativo</h3>
        <p className="text-sm text-muted-foreground">
          Teste todos os estados e ações do componente Results-Header.
          <strong>Nota:</strong> O estado &ldquo;Verificando&rdquo; agora inclui animação dos 3 pontos.
        </p>
      </div>

      {/* State Controls */}
      <div className="space-y-4">
        <h4 className="text-md font-medium">Controles de Estado</h4>
        <div className="flex gap-2">
          <Button
            onClick={() => setStatus("verifying")}
            variant={status === "verifying" ? "filled" : "outlined"}
            size="sm"
          >
            Verificando
          </Button>
          <Button
            onClick={() => setStatus("error")}
            variant={status === "error" ? "filled" : "outlined"}
            size="sm"
          >
            Erro
          </Button>
          <Button
            onClick={() => setStatus("done")}
            variant={status === "done" ? "filled" : "outlined"}
            size="sm"
          >
            Completo
          </Button>
          <Button
            onClick={() => setStatus("complete-no-results")}
            variant={status === "complete-no-results" ? "filled" : "outlined"}
            size="sm"
          >
            Completo sem resultados
          </Button>
        </div>
      </div>

      {/* Component Display */}
      <div className="space-y-4">
        <h4 className="text-md font-medium">Componente</h4>
        <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
          <ResultsHeader
            status={status}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onCopy={handleCopy}
          />
        </div>
      </div>

      {/* Action Log */}
      <div className="space-y-2">
        <h4 className="text-md font-medium">Log de Ações</h4>
        <div className="text-sm text-muted-foreground">
          <p><strong>Estado atual:</strong> {status}</p>
          <p><strong>Última ação:</strong> {lastAction || "Nenhuma"}</p>
        </div>
      </div>
    </div>
  );
};

// Story específica para demonstrar a animação dos pontos
export const AnimatedDots: Story = () => {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Animação dos Pontos</h3>
        <p className="text-sm text-muted-foreground">
          Demonstração da animação dos 3 pontos e do círculo pulsante no estado &ldquo;Verificando&rdquo;
        </p>
      </div>

      <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
        <ResultsHeader
          status="verifying"
          onCancel={() => console.log("Cancel clicked")}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        <p><strong>Características da animação:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>Texto &ldquo;Verificando&rdquo; com pontos animados (ciclo: . → .. → ...)</li>
          <li>Intervalo de 500ms entre cada ponto</li>
          <li>Círculo externo verde (#77e6a0) com animação fade (2s)</li>
          <li>Círculo interno verde (#22c55e) estático</li>
          <li>Botão &ldquo;Cancel&rdquo; com ícone X</li>
        </ul>
      </div>
    </div>
  );
};

export const CompleteWithoutResults: Story = () => (
  <div className="space-y-6 max-w-2xl">
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Estado: Completo sem Resultados</h3>
      <p className="text-sm text-muted-foreground">
        Header exibido quando a verificação terminou mas nenhuma afirmação foi retornada.
      </p>
    </div>

    <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
      <ResultsHeader status="complete-no-results" />
    </div>
  </div>
);

// Static stories for each state
// export const Verifying: Story = () => (
//   <div className="space-y-6 max-w-2xl">
//     <div className="space-y-2">
//       <h3 className="text-lg font-semibold">Estado: Verificando</h3>
//       <p className="text-sm text-muted-foreground">
//         Estado padrão quando a verificação está em andamento
//       </p>
//     </div>

//     <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
//       <ResultsHeader
//         status="verifying"
//         onCancel={() => console.log("Cancel clicked")}
//       />
//     </div>

//     <div className="text-xs text-muted-foreground">
//       <p><strong>Características:</strong></p>
//       <ul className="list-disc list-inside space-y-1">
//         <li>Ícone de progresso animado (círculos verdes sobrepostos)</li>
//         <li>Texto "Verificando..." com opacity reduzida</li>
//         <li>Botão "Cancel" com ícone X</li>
//         <li>Cor do texto: slate-900 com opacity-70</li>
//       </ul>
//     </div>
//   </div>
// );

// export const Error: Story = () => (
//   <div className="space-y-6 max-w-2xl">
//     <div className="space-y-2">
//       <h3 className="text-lg font-semibold">Estado: Erro</h3>
//       <p className="text-sm text-muted-foreground">
//         Estado quando ocorre erro na verificação
//       </p>
//     </div>

//     <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
//       <ResultsHeader
//         status="error"
//         onRetry={() => console.log("Retry clicked")}
//       />
//     </div>

//     <div className="text-xs text-muted-foreground">
//       <p><strong>Características:</strong></p>
//       <ul className="list-disc list-inside space-y-1">
//         <li>Ícone AlertCircle em vermelho</li>
//         <li>Texto "Erro na Verificação" em vermelho (#ea3f3f)</li>
//         <li>Botão "Try again" com ícone RotateCcw</li>
//         <li>Padding extra no ícone de erro</li>
//       </ul>
//     </div>
//   </div>
// );

// export const Done: Story = () => (
//   <div className="space-y-6 max-w-2xl">
//     <div className="space-y-2">
//       <h3 className="text-lg font-semibold">Estado: Completo</h3>
//       <p className="text-sm text-muted-foreground">
//         Estado quando a verificação foi concluída com sucesso
//       </p>
//     </div>

//     <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
//       <ResultsHeader
//         status="done"
//         onCopy={() => console.log("Copy clicked")}
//       />
//     </div>

//     <div className="text-xs text-muted-foreground">
//       <p><strong>Características:</strong></p>
//       <ul className="list-disc list-inside space-y-1">
//         <li>Ícone Check em verde com opacity reduzida</li>
//         <li>Texto "Verificação Completa" com opacity reduzida</li>
//         <li>Botão "Copy Plain Text" com ícone Copy</li>
//         <li>Cor do texto: slate-900 com opacity-70</li>
//       </ul>
//     </div>
//   </div>
// );

// // Disabled state story
// export const Disabled: Story = () => (
//   <div className="space-y-6 max-w-2xl">
//     <div className="space-y-2">
//       <h3 className="text-lg font-semibold">Estado: Desabilitado</h3>
//       <p className="text-sm text-muted-foreground">
//         Componente em estado desabilitado
//       </p>
//     </div>

//     <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 space-y-4">
//       <ResultsHeader
//         status="verifying"
//         disabled
//         onCancel={() => console.log("Cancel clicked")}
//       />

//       <ResultsHeader
//         status="error"
//         disabled
//         onRetry={() => console.log("Retry clicked")}
//       />

//       <ResultsHeader
//         status="done"
//         disabled
//         onCopy={() => console.log("Copy clicked")}
//       />
//     </div>

//     <div className="text-xs text-muted-foreground">
//       <p><strong>Características:</strong></p>
//       <ul className="list-disc list-inside space-y-1">
//         <li>Botão com opacity reduzida (50%)</li>
//         <li>Cursor not-allowed no botão</li>
//         <li>Não responde a cliques</li>
//         <li>Mantém todos os estados visuais</li>
//       </ul>
//     </div>
//   </div>
// );

// // All states comparison
// export const AllStates: Story = () => (
//   <div className="space-y-6 max-w-2xl">
//     <div className="space-y-2">
//       <h3 className="text-lg font-semibold">Comparação de Todos os Estados</h3>
//       <p className="text-sm text-muted-foreground">
//         Visualização lado a lado de todos os estados do componente
//       </p>
//     </div>

//     <div className="border border-gray-200 rounded-lg p-6 bg-gray-50 space-y-4">
//       <div className="space-y-2">
//         <h4 className="text-sm font-medium text-gray-600">Verificando</h4>
//         <ResultsHeader
//           status="verifying"
//           onCancel={() => console.log("Cancel clicked")}
//         />
//       </div>

//       <div className="space-y-2">
//         <h4 className="text-sm font-medium text-gray-600">Erro</h4>
//         <ResultsHeader
//           status="error"
//           onRetry={() => console.log("Retry clicked")}
//         />
//       </div>

//       <div className="space-y-2">
//         <h4 className="text-sm font-medium text-gray-600">Completo</h4>
//         <ResultsHeader
//           status="done"
//           onCopy={() => console.log("Copy clicked")}
//         />
//       </div>
//     </div>
//   </div>
// );
