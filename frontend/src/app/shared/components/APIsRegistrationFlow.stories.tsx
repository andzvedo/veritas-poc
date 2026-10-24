import type { Story, StoryDefault } from "@ladle/react";
import APIsRegistrationFlow from "./APIsRegistrationFlow";

export default {
  title: "app/shared/components/APIsRegistrationFlow",
} satisfies StoryDefault;

export const EmptyState: Story = () => (
  <div className="bg-neutral-100 min-h-screen flex items-center justify-center p-8">
    <APIsRegistrationFlow
      onComplete={(keys) => console.log("Chaves confirmadas:", keys)}
    />
  </div>
);

export const WithInitialKeys: Story = () => (
  <div className="bg-neutral-100 min-h-screen flex items-center justify-center p-8">
    <APIsRegistrationFlow
      initialKeys={{
        // Formato auth key atual do Google AI Studio (AQ.)
        gemini: "AQ.ExampleAuthKeyFromGoogleAIStudioXXXXXX",
        tavily: "tvly-dev-ExampleTavilyDevKeyXXXXXXXXXXXX",
      }}
      onComplete={(keys) => console.log("Revisão concluída:", keys)}
    />
  </div>
);

export const WithClassicGeminiKey: Story = () => (
  <div className="bg-neutral-100 min-h-screen flex items-center justify-center p-8">
    <APIsRegistrationFlow
      initialKeys={{
        // Formato clássico AIzaSy... (39 chars)
        gemini: "AIzaSyDem0KeyExampleXXXXXXXXXXXXXXXXXXX",
        tavily: "tvly-prod-ABCDEFGHIJKLMNOPQRSTUVWX123456",
      }}
      onComplete={(keys) => console.log("Revisão concluída:", keys)}
    />
  </div>
);
