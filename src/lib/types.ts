export type Creator = {
  id: string;
  name: string;
  slug: string;
  creator_type: "human" | "business" | "ai";
  primary_goal: string | null;
  description: string | null;
  niche: string | null;
  target_audience: string | null;
  tone: string | null;
  visual_description: string | null;
  persona_lore: string | null;
  boundaries: string[] | null;
  content_pillars: string[] | null;
  preferred_platforms: string[] | null;
};

export type ContentItem = {
  id: string;
  platform: string | null;
  title: string | null;
  caption: string | null;
  views: number;
  link_clicks: number;
  revenue: number;
};

export type Recommendation = {
  id: string;
  title: string;
  summary: string | null;
  reason: string | null;
  goal: string | null;
  effort_minutes: number | null;
  status: string;
};
