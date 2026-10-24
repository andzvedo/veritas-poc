import type {
  ClaimStatus,
  EvidenceRelation,
  MechanismCode,
  Verdict,
} from '@veritas/shared';

export type Locale = 'pt-BR' | 'en-US';

export interface LiveCardNotice {
  title: string;
  body: string;
}

/**
 * Copy for the three-layer verification card (LIVE-027).
 * Status/verdict/mechanism keys mirror the shared contract so a new enum member
 * fails to type-check until every locale is updated.
 */
export interface LiveCardTranslations {
  unknownSpeaker: string;
  transcriptUnconfirmed: string;
  verdictAriaPrefix: string;
  status: Record<ClaimStatus, string>;
  verdict: Record<Verdict, string>;
  mechanisms: Record<MechanismCode, string>;
  mechanismEvidenceLabel: string;
  sections: {
    conclusion: string;
    contradiction: string;
    whatSaid: string;
    whatFound: string;
    trueComponent: string;
    distortion: string;
    supportedAspects: string;
    missing: string;
    mechanism: string;
    mechanismHint: string;
  };
  card: {
    quoteAriaLabel: string;
    timestampAriaLabel: string;
    revision: string;
    select: string;
  };
  notices: Record<Exclude<ClaimStatus, 'COMPLETED'>, LiveCardNotice> & {
    /** Defensive state: COMPLETED without a valid verdict must not be shown as a result. */
    incomplete: LiveCardNotice;
  };
  evidence: {
    show: string;
    hide: string;
    count: string;
    countOne: string;
    title: string;
    groups: Record<EvidenceRelation, string>;
    primarySources: string;
    primarySourceTag: string;
    excerpt: string;
    location: string;
    publishedAt: string;
    accessedAt: string;
    unverifiedTitle: string;
    unverifiedBody: string;
    empty: string;
    emptyHint: string;
    linkHint: string;
  };
  limitations: {
    title: string;
  };
  revision: {
    label: string;
    statusLabel: string;
    updatedAt: string;
    note: string;
  };
}

export interface TranslationKeys {
  common: {
    appName: string;
    tagline: string;
    loading: string;
    close: string;
    cancel: string;
    confirm: string;
    continue: string;
    back: string;
    new: string;
    next: string;
    previous: string;
    retry: string;
    copy: string;
    copied: string;
    configured: string;
    settings: string;
  };
  metadata: {
    title: string;
    description: string;
  };
  header: {
    settingsAriaLabel: string;
    settingsTitle: string;
    homeAriaLabel: string;
  };
  hero: {
    title: string;
    titleHighlight: string;
    titleContinuation: string;
    subtitle: string;
    textFiles: string;
    audio: string;
    comingSoon: string;
    and: string;
  };
  verificationForm: {
    label: string;
    placeholder: string;
    useExample: string;
    checkFacts: string;
    tooltipWaitProcessing: string;
    tooltipExceedsLimit: string;
    tooltipEnterText: string;
  };
  apiSetup: {
    welcome: string;
    intro: string;
    whyTitle: string;
    whyDescription: string;
    googleTitle: string;
    googleDescription: string;
    googlePlaceholder: string;
    googleHelpText: string;
    tavilyTitle: string;
    tavilyDescription: string;
    tavilyPlaceholder: string;
    tavilyHelpText: string;
    startVerifying: string;
    usePreviousConfig: string;
    fillBothKeys: string;
    securityNote: string;
  };
  confirmationDialog: {
    newText: {
      description: string;
      confirm: string;
      cancel: string;
    };
    cancelVerification: {
      description: string;
      confirm: string;
      cancel: string;
    };
    goToSettings: {
      description: string;
      confirm: string;
    };
  };
  results: {
    processedText: string;
    verifications: string;
    analysis: string;
    sources: string;
    claimFound: string;
    claimsFound: string;
    noClaimSelected: string;
    firstClaim: string;
    lastClaim: string;
    status: {
      verifying: string;
      complete: string;
      error: string;
    };
    actions: {
      cancel: string;
      retry: string;
      copyAsText: string;
      copied: string;
      new: string;
    };
    messages: {
      processing: string;
      noResults: string;
      error: string;
    };
    navigation: {
      noneSelected: string;
      firstClaim: string;
      lastClaim: string;
    };
    export: {
      verifiedText: string;
      verificationResults: string;
      noResultsFound: string;
      verifiedClaim: string;
      analysis: string;
      sources: string;
      generatedBy: string;
      date: string;
      totalClaims: string;
    };
  };
  toast: {
    closeAriaLabel: string;
  };
  errors: {
    connectionFailed: string;
    internalError: string;
    backendConnectionFailed: string;
  };
  comingSoon: {
    textFiles: string;
    audio: string;
    message: string;
    and: string;
  };
  firstAccess: {
    title: {
      part1: string;
      part2: string;
      part3: string;
    };
    subtitle: string;
    cta: string;
    badge: string;
  };
  setup: {
    title: string;
    verifications: string;
  };
  verification: {
    title: string;
  };
  processing: {
    title: string;
    subtitle: string;
  };
  helperAccordion: {
    title: string;
    items: {
      ai: string;
      free: string;
      purpose: string;
      privacy: string;
    };
  };
  apiFlow: {
    title: string;
    status: {
      notConfigured: string;
      invalid: string;
      validating: string;
      ready: string;
    };
    gemini: {
      label: string;
      sublabel: string;
      link: string;
      placeholder: string;
    };
    tavily: {
      label: string;
      sublabel: string;
      link: string;
      placeholder: string;
    };
    button: string;
    tooltips: {
      empty: string;
      geminiOnly: string;
      invalid: string;
      validating: string;
    };
    errors: {
      invalidFormat: string;
    };
  };
  verificationTextArea: {
    title: string;
    characterLimit: string;
    placeholder: string;
    useExample: string;
    verify: string;
    tooltips: {
      overLimit: string;
      empty: string;
    };
  };
  tagline: {
    text: string;
  };
  liveCard: LiveCardTranslations;
  live: {
    modeToggleAria: string;
    modeLive: string;
    modeText: string;
    controls: {
      start: string;
      pause: string;
      resume: string;
      stop: string;
      pauseDisabled: string;
      resumeDisabled: string;
      stopDisabled: string;
    };
    status: Record<string, string>;
    feedback: Record<string, string>;
    setup: {
      eyebrow: string;
      title: string;
      description: string;
      sourceLabel: string;
      sourceMic: string;
      defaultMic: string;
      unnamedMic: string;
      showDevices: string;
      loadingDevices: string;
      consentLabel: string;
      consentRequired: string;
      sourceHint: string;
      privacyNote: string;
    };
    /** Microphone capture errors, keyed by `MicCaptureErrorCode`. */
    micErrors: Record<
      | 'UNSUPPORTED'
      | 'INSECURE_CONTEXT'
      | 'PERMISSION_DENIED'
      | 'NO_DEVICE'
      | 'DEVICE_IN_USE'
      | 'DEVICE_DISCONNECTED'
      | 'NO_AUDIO_TRACK'
      | 'CAPTURE_FAILED',
      string
    >;
    transcript: {
      title: string;
      subtitle: string;
      empty: string;
      unknownSpeaker: string;
      unconfirmedSpeaker: string;
      speechTimeHint: string;
      revisionConflict: string;
      correct: string;
      correctLabel: string;
      saveCorrection: string;
      claimChip: string;
      revision: string;
      gapsNotice: string;
      status: {
        PROVISIONAL: string;
        FINAL: string;
        BLOCKED: string;
      };
      uncertainty: Record<string, string>;
    };
    workspace: {
      eyebrow: string;
      title: string;
      intro: string;
      resultsTitle: string;
      resultsEmpty: string;
      claimCount: string;
      claimCountOne: string;
    };
  };
}

