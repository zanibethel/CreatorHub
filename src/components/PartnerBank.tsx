import { partnerCandidates, type PartnerStatus } from "@/lib/partnerBank";
import { card, colors } from "@/lib/ui";

const statusLabels: Record<PartnerStatus, string> = {
  research: "Research candidate",
  applying: "Application in progress",
  approved: "Approved",
  paused: "Paused",
};

export default function PartnerBank() {
  const approvedCount = partnerCandidates.filter((partner) => partner.status === "approved").length;

  return (
    <section aria-labelledby="partner-bank-heading" style={{ marginTop: 26 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Monetize
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
        <div>
          <h2 id="partner-bank-heading" style={{ margin: "6px 0 4px" }}>Partner Bank</h2>
          <p style={{ color: colors.muted, margin: 0 }}>
            Potential offers CreatorHub can eventually match to a creator&apos;s audience.
          </p>
        </div>
        <div style={{ color: colors.muted, fontSize: 13 }}>
          {approvedCount} approved · {partnerCandidates.length} being evaluated
        </div>
      </div>

      <div style={{ ...card, marginTop: 14, borderColor: "#5b3a86" }}>
        <strong style={{ color: colors.purpleBright }}>Approval gate</strong>
        <p style={{ color: colors.muted, marginBottom: 0 }}>
          These are not live offers yet. CreatorHub will only enable a partner after written permission confirms that we can attribute downstream creators and share commissions with them.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginTop: 12 }}>
        {partnerCandidates.map((partner) => (
          <article key={partner.slug} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
              <div>
                <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {partner.category} · Phase {partner.phase}
                </div>
                <h3 style={{ margin: "7px 0 0", fontSize: 18 }}>{partner.name}</h3>
              </div>
              <span style={{ background: colors.purpleSoft, border: `1px solid ${colors.border}`, borderRadius: 999, color: colors.purpleBright, fontSize: 11, fontWeight: 800, padding: "6px 9px", whiteSpace: "nowrap" }}>
                {statusLabels[partner.status]}
              </span>
            </div>

            <p style={{ marginBottom: 8 }}>{partner.primaryUse}</p>
            <div style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
              <div><strong style={{ color: colors.text }}>Path:</strong> {partner.integrationPath}</div>
              <div style={{ marginTop: 6 }}><strong style={{ color: colors.text }}>Value:</strong> {partner.opportunity}</div>
            </div>

            <a href={partner.websiteUrl} target="_blank" rel="noreferrer" style={{ color: colors.purpleBright, display: "inline-block", fontWeight: 700, marginTop: 14 }}>
              Review official program →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
