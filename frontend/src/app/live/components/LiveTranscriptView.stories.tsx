import type { Story, StoryDefault } from "@ladle/react";
import { useMemo, useState } from "react";
import type { Claim, TranscriptSegment } from "@veritas/shared";
import ptBR from "@/lib/i18n/locales/pt-BR.json";
import type { TranslationKeys } from "@/lib/i18n/types";
import {
  buildTranscriptBlocks,
  summarizeTranscriptGating,
  type TranscriptLine,
} from "@/lib/live/transcriptView";
import LiveTranscriptView from "./LiveTranscriptView";
import LiveGatingNotice from "./LiveGatingNotice";

export default {
  title: "Live/LiveTranscriptView",
} satisfies StoryDefault;

const t = ptBR as unknown as TranslationKeys;
const AT = "2026-10-23T22:00:00-03:00";

const segments: TranscriptSegment[] = [
  {
    id: "s1", sessionId: "demo", revision: 5, status: "BLOCKED", speakerId: "spk-0",
    text: "Eu acho que eu vou acabar com o pedágio mesmo, vou voltar para o pedágio e não mentir.",
    startMs: 3000, endMs: 21000, createdAt: AT, uncertaintyReasons: ["NEGATION"],
  },
  {
    id: "s2", sessionId: "demo", revision: 5, status: "BLOCKED", speakerId: "spk-0",
    text: "Quando o presidente assumiu, quase 99% das dívidas dos estudantes que concluíram o ensino superior estavam em atraso.",
    startMs: 21000, endMs: 39000, createdAt: AT, uncertaintyReasons: ["NUMBER", "NEGATION"],
  },
  {
    id: "s3", sessionId: "demo", revision: 4, status: "FINAL", speakerId: "spk-1",
    text: "Na folha, o reajuste dos professores foi de 33%, um dos maiores da história. Eu quero falar pra você que é mãe: são mais de um milhão de crianças sem vaga em creche.",
    startMs: 39000, endMs: 57000, createdAt: AT, uncertaintyReasons: ["NUMBER"],
  },
  {
    id: "s4", sessionId: "demo", revision: 1, status: "PROVISIONAL", speakerId: "spk-1",
    text: "Por isso essas mães não conseguem trabalhar.",
    startMs: 57000, endMs: 60000, createdAt: AT,
  },
];

const claim = (id: string, segmentId: string, quote: string): Claim => ({
  id, sessionId: "demo", segmentIds: [segmentId], originalQuote: quote,
  normalizedClaim: quote, status: "QUEUED", notFactCheckable: false,
  atomicClaims: [], revision: 1, createdAt: AT, updatedAt: AT,
});

const claims: Claim[] = [
  claim("c1", "s3", "o reajuste dos professores foi de 33%"),
  claim("c2", "s3", "são mais de um milhão de crianças sem vaga em creche"),
];

export const WithClaimsAndGating: Story = () => {
  const [selected, setSelected] = useState<string | undefined>("c1");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const blocks = useMemo(() => buildTranscriptBlocks(segments, claims, []), []);
  const summary = useMemo(() => summarizeTranscriptGating(segments, []), []);

  return (
    <div className="grid grid-cols-2 gap-5 p-6 bg-[#f5f5f5] max-w-[1100px]">
      <LiveTranscriptView
        blocks={blocks}
        strings={t.live.transcript}
        cancelLabel={t.common.cancel}
        gapCount={1}
        canCorrect
        selectedClaimId={selected}
        editingSegmentId={editing}
        draft={draft}
        onDraftChange={setDraft}
        onStartEdit={(line: TranscriptLine) => {
          setEditing(line.segmentId);
          setDraft(line.text);
        }}
        onSubmitEdit={() => setEditing(null)}
        onCancelEdit={() => setEditing(null)}
        onClaimClick={setSelected}
      />
      <div className="rounded-[19px] border border-[#dfdbe5] bg-white p-4">
        <LiveGatingNotice summary={summary} strings={t.live.gating} />
      </div>
    </div>
  );
};

export const Empty: Story = () => (
  <div className="p-6 max-w-[560px]">
    <LiveTranscriptView blocks={[]} strings={t.live.transcript} cancelLabel={t.common.cancel} />
  </div>
);
