export type ImageGenerationMode = "auto" | "economy" | "balanced" | "premium";

export type ImageModelChoice = {
  mode: Exclude<ImageGenerationMode, "auto"> | "reference";
  model: string;
  label: string;
  costHint: string;
  reason: string;
  supportsReferences: boolean;
};

const MODEL_CHOICES = {
  economy: {
    mode: "economy" as const,
    model: "recraft/recraft-v4.1-flash",
    label: "Recraft V4.1 Flash",
    costHint: "about $0.007/image",
    reason: "Lowest-cost draft generation. Uses the saved creator description, not reference-image pixels.",
    supportsReferences: false,
  },
  reference: {
    mode: "reference" as const,
    model: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    costHint: "AI Gateway token pricing",
    reason: "Verified reference-image generation for preserving a saved character identity.",
    supportsReferences: true,
  },
  balanced: {
    mode: "balanced" as const,
    model: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    costHint: "provider-priced image generation",
    reason: "Higher-fidelity reference-aware generation with strong instruction following.",
    supportsReferences: true,
  },
  premium: {
    mode: "premium" as const,
    model: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    costHint: "provider-priced image generation",
    reason: "Reference-aware premium option for stronger identity and edit consistency.",
    supportsReferences: true,
  },
} satisfies Record<string, ImageModelChoice>;

export function chooseImageModel(
  requestedMode: ImageGenerationMode,
  _prompt: string,
  hasReferences = false,
): ImageModelChoice & { routedBy: "manual" | "deterministic-auto-v2" } {
  if (requestedMode === "auto") {
    const selected = hasReferences ? MODEL_CHOICES.reference : MODEL_CHOICES.economy;
    return { ...selected, routedBy: "deterministic-auto-v2" };
  }

  return { ...MODEL_CHOICES[requestedMode], routedBy: "manual" };
}

export function imageModeOptions() {
  return [
    {
      value: "auto" as const,
      label: "Auto",
      detail: "Uses a verified reference-aware model when approved character references exist.",
    },
    {
      value: "economy" as const,
      label: "Economy",
      detail: MODEL_CHOICES.economy.costHint + " · text-profile fallback",
    },
    {
      value: "balanced" as const,
      label: "Balanced",
      detail: "reference-aware · " + MODEL_CHOICES.balanced.costHint,
    },
    {
      value: "premium" as const,
      label: "Premium",
      detail: "reference-aware · " + MODEL_CHOICES.premium.costHint,
    },
  ];
}
