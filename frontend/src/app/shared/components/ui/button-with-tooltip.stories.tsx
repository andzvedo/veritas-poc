import type { Story, StoryDefault } from "@ladle/react";
import { Button } from "./button";
import { Save, Send, Trash2 } from "lucide-react";

export default {
  title: "app/shared/components/ui/button-with-tooltip",
} satisfies StoryDefault;

// Botão desabilitado com tooltip - Filled variant
export const FilledDisabledWithTooltip: Story = () => (
  <div className="p-8 space-y-4">
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Hover, focus (Tab) ou tap no botão para ver o tooltip:
      </p>
      <Button
        variant="filled"
        disabled
        disabledTooltip="Preencha todos os campos obrigatórios para salvar"
      >
        <Save />
        Salvar
      </Button>
    </div>

    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Botão desabilitado SEM tooltip (comportamento anterior):
      </p>
      <Button variant="filled" disabled>
        <Save />
        Salvar
      </Button>
    </div>
  </div>
);

// Botão desabilitado com tooltip - Outlined variant
export const OutlinedDisabledWithTooltip: Story = () => (
  <div className="p-8 space-y-4">
    <Button
      variant="outlined"
      disabled
      disabledTooltip="Você precisa estar conectado à internet para enviar"
    >
      <Send />
      Enviar
    </Button>
  </div>
);

// Botão desabilitado com tooltip - Diferentes tamanhos
export const DifferentSizes: Story = () => (
  <div className="p-8 space-y-4">
    <div>
      <p className="text-sm text-gray-600 mb-2">Tamanho Small:</p>
      <Button
        variant="filled"
        size="sm"
        disabled
        disabledTooltip="Selecione pelo menos um item para deletar"
      >
        <Trash2 />
        Deletar
      </Button>
    </div>

    <div>
      <p className="text-sm text-gray-600 mb-2">Tamanho Default:</p>
      <Button
        variant="filled"
        size="default"
        disabled
        disabledTooltip="Selecione pelo menos um item para deletar"
      >
        <Trash2 />
        Deletar
      </Button>
    </div>
  </div>
);

// Comparação: Com e sem tooltip
export const ComparisonWithAndWithout: Story = () => (
  <div className="p-8 space-y-6">
    <div className="space-y-2">
      <h3 className="font-semibold">✅ Com Tooltip (Acessível)</h3>
      <p className="text-sm text-gray-600">
        Usuário recebe feedback sobre por que o botão está desabilitado
      </p>
      <div className="flex gap-4">
        <Button
          variant="filled"
          disabled
          disabledTooltip="Complete o formulário para continuar"
        >
          Continuar
        </Button>
        <Button
          variant="outlined"
          disabled
          disabledTooltip="Você não tem permissão para executar esta ação"
        >
          Executar
        </Button>
      </div>
    </div>

    <div className="space-y-2">
      <h3 className="font-semibold">❌ Sem Tooltip (Menos Acessível)</h3>
      <p className="text-sm text-gray-600">
        Usuário não sabe por que o botão está desabilitado
      </p>
      <div className="flex gap-4">
        <Button variant="filled" disabled>
          Continuar
        </Button>
        <Button variant="outlined" disabled>
          Executar
        </Button>
      </div>
    </div>
  </div>
);

// Tooltip longo
export const LongTooltipText: Story = () => (
  <div className="p-8">
    <Button
      variant="filled"
      disabled
      disabledTooltip="Para ativar este botão, você precisa: 1) Completar seu perfil, 2) Verificar seu e-mail, 3) Aceitar os termos de serviço"
    >
      Ativar Conta
    </Button>
  </div>
);
