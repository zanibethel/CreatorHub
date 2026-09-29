export type ImageGenerationMode = "auto" | "economy" | "balanced" | "premium";

export type ImageModelChoice = {
  mode: Exclude<ImageGenerationMode, "auto">;
  model: string;
  label: string;
  costHint: string;
  reason: string;
};

const MODEL_CHOICES: Record<Exclude<ImageGenerationMode, "auto">, ImageModelChoice> = {
  economy: {
    mode: "economy",
    model: "recraft/recraft-v4.1-flash",
    label: "Recraft V4.1 Flash",
    costHint: "about $0.007/image",
    reason: "Fast, low-cost iteration and high-volume drafts.",
  },
  balanced: {
    mode: "balanced",
    model: "recraft/recraft-v4.1",
    label: "Recraft V4.1",
    costHint: "about $0.04/image",
    reason: "Higher visual quality while keeping per-image spend predictable.",
  },
  premium: {
    mode: "premium",
    model: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    costHint: "variable provider usage",
    reason: "Detailed instruction following and higher-fidelity final creative.",
  },
};

const PREMIUM_CUES = [
  "photoreal",
  "photorealistic",
  "cinematic",
  "portrait",
  "skin",
  "fashion",
  "editorial",
  "luxury",
  "consistent character",
  "high fidelity",
  "detailed",
];

const BALANCED_CUES = [
  "logo",
  "poster",
  "typography",
  "text",
  "product",
  "mockup",
  "branding",
  "illustration",
  "social ad",
];

export function chooseImageModel(
  requestedMode: ImageGenerationMode,
  prompt: string,
): ImageModelChoice & { routedBy: "manual" | "deterministic-auto-v1" } {
  if (requestedMode !== "auto") {
    return { ...MODEL_CHOICES[requestedMode], routedBy: "manual" };
  }

  const normalized = prompt.toLowerCase();
  if (PREMIUM_CUES.some((cue) => normalized.includes(cue))) {
    return { ...MODEL_CHOICES.premium, routedBy: "deterministic-auto-v1" };
  }
  if (BALANCED_CUES.some((cue) => normalized.includes(cue))) {
    return { ...MODEL_CHOICES.balanced, routedBy: "deterministic-auto-v1" };
  }

  return { ...MODEL_CHOICES.economy, routedBy: "deterministic-auto-v1" };
}

export function imageModeOptions() {
  return [
    {
      value: "auto" as const,
      label: "Auto",
      detail: "CreatorHub picks a cost/quality tier from the prompt. CoOperative/Hermes scoring plugs into this router next.",
    },
    {
      value: "economy" as const,
      label: "Economy",
      detail: MODEL_CHOICES.economy.costHint,
    },
    {
      value: "balanced" as const,
      label: "Balanced",
      detail: MODEL_CHOICES.balanced.costHint,
    },
    {
      value: "premium" as const,
      label: "Premium",
      detail: MODEL_CHOICES.premium.costHint,
    },
  ];
}
