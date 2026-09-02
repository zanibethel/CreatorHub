import { ebookCatalog, type EbookCatalogStatus } from "@/lib/ebookCatalog";
import { partnerCandidates, type PartnerStatus } from "@/lib/partnerBank";
import { card, colors } from "@/lib/ui";

const statusLabels: Record<PartnerStatus, string> = {
  research: "Research candidate",
  applying: "Application in progress",
  approved: "Approved",
  paused: "Paused",
};

const ebookStatusLabels: Record<EbookCatalogStatus, string> = {
  in_production: "In production",
  available: "Available to promote",
  paused: "Paused",
};

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

export default function PartnerBank() {
  const approvedCount = partnerCandidates.filter((partner) => partner.status === "approved").length;
  const availableEbookCount = ebookCatalog.filter((ebook) => ebook.status === "available").length;

  return (
    <section aria-labelledby="partner-bank-heading" style={{ marginTop: 26 }}>
      <div style={{ color: colors.purpleBright, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
        Monetize
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "end", gap: 12 }}>
        <div>
          <h2 id="partner-bank-heading" style={{ margin: "6px 0 4px" }}>Monetization Catalog</h2>
          <p style={{ color: colors.muted, margin: 0 }}>
            CreatorHub ebooks and outside partner offers that can be matched to a creator&apos;s audience.
          </p>
        </div>
        <div style={{ color: colors.muted, fontSize: 13 }}>
          {availableEbookCount} ebooks available · {approvedCount} partners approved
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ color: colors.purpleBright, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
          Digital products
        </div>
        <h3 style={{ margin: "6px 0 4px", fontSize: 21 }}>Ebook Catalog</h3>
        <p style={{ color: colors.muted, marginTop: 0 }}>
          CreatorHub Originals and creator-owned marketplace books will live here with their real price, audience fit, and commission terms.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        {ebookCatalog.map((ebook) => {
          const available = ebook.status === "available";
          const commission = ebook.promoterCommissionBps === null ? null : ebook.promoterCommissionBps / 100;

          return (
            <article key={ebook.slug} style={{ ...card, borderColor: available ? colors.purple : colors.border }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
                <div>
                  <div style={{ color: colors.muted, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {ebook.ownership}
                  </div>
                  <h4 style={{ margin: "7px 0 0", fontSize: 19 }}>{ebook.title}</h4>
                </div>
                <span style={{ background: colors.purpleSoft, border: `1px solid ${colors.border}`, borderRadius: 999, color: colors.purpleBright, fontSize: 11, fontWeight: 800, padding: "6px 9px", whiteSpace: "nowrap" }}>
                  {ebookStatusLabels[ebook.status]}
                </span>
              </div>

              <p>{ebook.description}</p>
              <div style={{ color: colors.muted, fontSize: 14, lineHeight: 1.5 }}>
                <div><strong style={{ color: colors.text }}>Audience:</strong> {ebook.audience}</div>
                <div style={{ marginTop: 6 }}><strong style={{ color: colors.text }}>Price:</strong> {formatMoney(ebook.priceCents, ebook.currency)}</div>
                <div style={{ marginTop: 6 }}>
                  <strong style={{ color: colors.text }}>Creator commission:</strong>{" "}
                  {commission === null ? "Not configured" : `${commission}% ${ebook.commissionStatus}`}
                </div>
              </div>

              {available ? (
                <a href={ebook.productPath} style={{ color: colors.purpleBright, display: "inline-block", fontWeight: 700, marginTop: 14 }}>
                  View ebook →
                </a>
              ) : (
                <div style={{ color: colors.muted, fontSize: 13, fontWeight: 700, marginTop: 14 }}>
                  Promote will unlock after the packaged ebook is published.
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div style={{ marginTop: 26 }}>
        <div style={{ color: colors.purpleBright, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em" }}>
          External opportunities
        </div>
        <h3 style={{ margin: "6px 0 4px", fontSize: 21 }}>Travel Partner Bank</h3>
        <p style={{ color: colors.muted, marginTop: 0 }}>
          Potential travel offers CreatorHub can integrate after each provider approves the creator-network model.
        </p>
      </div>

      <div style={{ ...card, marginTop: 14, borderColor: "#5b3a86" }}>
        <strong style={{ color: colors.purpleBright }}>Travel approval gate</strong>
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
