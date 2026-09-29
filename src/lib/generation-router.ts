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

export function chooseImageModel(
  requestedMode: ImageGenerationMode,
  prompt: string,
): ImageModelChoice & { routedBy: "manual" | "deterministic-auto-v1" } {
  if (requestedMode !== "auto") {
    return { ...MODEL_CHOICES[requestedMode], routedBy: "manual" };
  }

  // Cost-first v1: Auto never silently escalates spend. CoOperative/Hermes can
  // recommend a higher tier later, but Balanced/Premium require an explicit
  // owner selection until cost-aware routing and budgets are wired end-to-end.
  void prompt;
  return { ...MODEL_CHOICES.economy, routedBy: "deterministic-auto-v1" };
}

export function imageModeOptions() {
  return [
    {
      value: "auto" as const,
      label: "Auto",
      detail: "Cost-first: uses Economy unless you explicitly select a higher tier. CoOperative/Hermes scoring plugs into this router next.",
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
