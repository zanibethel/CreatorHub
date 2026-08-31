import ProductSuccess from "@/components/ProductSuccess";
import { colors } from "@/lib/ui";

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id = "" } = await searchParams;
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "42px 24px 72px" }}>
      <div style={{ color: colors.purpleBright, fontWeight: 900, letterSpacing: ".02em", marginBottom: 20 }}>CreatorHub</div>
      <ProductSuccess sessionId={session_id} />
    </main>
  );
}
