export type ImageGenerationMode = "auto" | "economy" | "balanced" | "premium";
export type ImageModelOverride =
  | "auto"
  | "cooperative-local"
  | "cooperative-local-fast"
  | "cooperative-local-quality"
  | "recraft-v4.1-flash"
  | "gpt-image-2.5-flare"
  | "gpt-image-2.5-sunburst";

export type ImageExecutionTarget = "auto" | "cooperative" | "gateway";
export type LocalImageProfile = "fast" | "quality";

export type ImageModelChoice = {
  mode: Exclude<ImageGenerationMode, "auto"> | "reference";
  model: string;
  label: string;
  costHint: string;
  reason: string;
  supportsReferences: boolean;
  target: ImageExecutionTarget;
  localProfile?: LocalImageProfile;
};

const MODEL_CHOICES = {
  localFast: {
    mode: "reference" as const,
    model: "cooperative/local-fast",
    label: "CoOperative AI · Local Fast",
    costHint: "local inference · no per-image API charge",
    reason: "Uses the lightweight local model for faster drafts and inexpensive iteration.",
    supportsReferences: true,
    target: "cooperative" as const,
    localProfile: "fast" as const,
  },
  localQuality: {
    mode: "reference" as const,
    model: "cooperative/local-quality",
    label: "CoOperative AI · Local Quality",
    costHint: "local inference · no per-image API charge",
    reason: "Uses the larger local quality model. It is slower and uses more Mac memory, but aims for better realism and detail.",
    supportsReferences: true,
    target: "cooperative" as const,
    localProfile: "quality" as const,
  },
  economy: {
    mode: "economy" as const,
    model: "recraft/recraft-v4.1-flash",
    label: "Recraft V4.1 Flash",
    costHint: "about $0.007/image",
    reason: "Lowest-cost hosted draft generation. Uses the saved creator description, not reference-image pixels.",
    supportsReferences: false,
    target: "gateway" as const,
  },
  reference: {
    mode: "reference" as const,
    model: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    costHint: "AI Gateway token pricing",
    reason: "Verified reference-image generation for preserving a saved character identity.",
    supportsReferences: true,
    target: "gateway" as const,
  },
  balanced: {
    mode: "balanced" as const,
    model: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    costHint: "provider-priced image generation",
    reason: "Higher-fidelity reference-aware generation with strong instruction following.",
    supportsReferences: true,
    target: "gateway" as const,
  },
  premium: {
    mode: "premium" as const,
    model: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    costHint: "provider-priced image generation",
    reason: "Reference-aware premium option for stronger identity and edit consistency.",
    supportsReferences: true,
    target: "gateway" as const,
  },
} satisfies Record<string, ImageModelChoice>;

const OVERRIDE_CHOICES: Record<Exclude<ImageModelOverride, "auto">, ImageModelChoice> = {
  "cooperative-local": MODEL_CHOICES.localFast,
  "cooperative-local-fast": MODEL_CHOICES.localFast,
  "cooperative-local-quality": MODEL_CHOICES.localQuality,
  "recraft-v4.1-flash": MODEL_CHOICES.economy,
  "gpt-image-2.5-flare": MODEL_CHOICES.balanced,
  "gpt-image-2.5-sunburst": MODEL_CHOICES.premium,
};

export function chooseImageModel(
  requestedMode: ImageGenerationMode,
  _prompt: string,
  hasReferences = false,
  modelOverride: ImageModelOverride = "auto",
): ImageModelChoice & {
  routedBy: "manual-model" | "manual-routing" | "deterministic-auto-v4";
} {
  if (modelOverride !== "auto") {
    return { ...OVERRIDE_CHOICES[modelOverride], routedBy: "manual-model" };
  }

  if (requestedMode === "auto") {
    const fallback = hasReferences ? MODEL_CHOICES.reference : MODEL_CHOICES.economy;
    return {
      ...fallback,
      target: "auto",
      localProfile: "fast",
      label: `Auto · Local Fast → ${fallback.label}`,
      costHint: `local first · hosted fallback: ${fallback.costHint}`,
      reason: "Tries CoOperative AI Local Fast first. If it is unavailable, CreatorHub can use the suitable hosted fallback after your confirmation.",
      routedBy: "deterministic-auto-v4",
    };
  }

  return { ...MODEL_CHOICES[requestedMode], routedBy: "manual-routing" };
}

export function imageModeOptions() {
  return [
    {
      value: "auto" as const,
      label: "Auto",
      detail: "Local Fast first, then the lowest suitable hosted fallback.",
    },
    {
      value: "economy" as const,
      label: "Economy",
      detail: MODEL_CHOICES.economy.costHint + " · hosted · text-profile fallback",
    },
    {
      value: "balanced" as const,
      label: "Balanced",
      detail: "hosted · reference-aware · " + MODEL_CHOICES.balanced.costHint,
    },
    {
      value: "premium" as const,
      label: "Premium",
      detail: "hosted · reference-aware · " + MODEL_CHOICES.premium.costHint,
    },
  ];
}

export function imageModelOptions() {
  return [
    {
      value: "auto" as const,
      label: "Automatic",
      detail: "Follow the routing choice above.",
    },
    {
      value: "cooperative-local-fast" as const,
      label: "CoOperative AI · Local Fast",
      detail: "current lightweight model · faster · no per-image API charge",
    },
    {
      value: "cooperative-local-quality" as const,
      label: "CoOperative AI · Local Quality",
      detail: "larger SDXL-class local model · slower · no per-image API charge",
    },
    {
      value: "recraft-v4.1-flash" as const,
      label: "Recraft V4.1 Flash",
      detail: MODEL_CHOICES.economy.costHint + " · hosted",
    },
    {
      value: "gpt-image-2.5-flare" as const,
      label: "GPT Image 2.5 Flare",
      detail: "reference-aware · hosted paid model",
    },
    {
      value: "gpt-image-2.5-sunburst" as const,
      label: "GPT Image 2.5 Sunburst",
      detail: "premium reference-aware · hosted paid model",
    },
  ];
}
