import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exported = {};
const source = readFileSync(new URL("../src/lib/midas-sec-insider.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(transpiled, { exports: exported, Number, Date, Object, Map, RegExp, String });

const { mapSecTickers, selectForm4Filings, secFilingUrl, parseSecForm4 } = exported;
const observed = "2026-10-08T15:00:00.000Z";
const filing = {
  accession: "0000789019-26-000028", primaryDocument: "xslF345X03/form4.xml",
  filedAt: "2026-02-18", acceptedAtRaw: "2026-02-18T16:00:00.000Z",
};

function exampleXML(extraOwner = "") {
  const tx = (code, side, shares, price, day = "2026-02-18") => `
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>${day}</value></transactionDate>
      <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>${shares}</value></transactionShares>
        <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>${side}</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>`;
  return `<?xml version="1.0"?>
<ownershipDocument>
  <issuer><issuerCik>0000789019</issuerCik><issuerName>Microsoft Corp</issuerName><issuerTradingSymbol>MSFT</issuerTradingSymbol></issuer>
  <reportingOwner><reportingOwnerId><rptOwnerCik>0000904858</rptOwnerCik><rptOwnerName>Example &amp; Insider</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>0</isOfficer></reportingOwnerRelationship>
  </reportingOwner>
  ${extraOwner}
  <aff10b5One>0</aff10b5One>
  <nonDerivativeTable>
    ${tx("P", "A", "5000", "397.35")}
    ${tx("S", "D", "300", "400")}
    ${tx("A", "A", "125", "0")}
    ${tx("M", "A", "150", "0")}
    ${tx("F", "D", "15", "220")}
    ${tx("G", "D", "4", "0")}
  </nonDerivativeTable>
</ownershipDocument>`;
}

test("issuer CIK/ticker map and safe XML path", () => {
  const map = mapSecTickers({ 0: { cik_str: 789019, ticker: "MSFT", title: "Microsoft Corp" },
    1: { cik_str: -10, ticker: "BAD", title: "Ignore" },
    2: { cik_str: 123, ticker: "../", title: "Ignore" } });
  assert.equal(map.get("MSFT").cik_str, 789019);
  assert.equal(map.size, 1);
  assert.equal(secFilingUrl("789019", filing),
    "https://www.sec.gov/Archives/edgar/data/789019/000078901926000028/xslF345X03/form4.xml");
  assert.throws(() => secFilingUrl("789019", { ...filing, primaryDocument: "../../unsafe.xml" }));
});

test("only original unamended Form 4 XML entries are eligible", () => {
  const r = selectForm4Filings({ filings: { recent: {
    form: ["4/A", "4", "10-K", "4", "4"], accessionNumber: [
      filing.accession, filing.accession, filing.accession,
      "0000789019-26-000099", "0000789019-26-000100",
    ],
    primaryDocument: ["form4.xml", "form4.xml", "annual.htm", "../invalid.xml", "form4.xml"],
    filingDate: ["2026-02-18", "2026-02-18", "2026-02-18", "2026-02-19", "2026-02-20"],
    acceptanceDateTime: [observed, observed, observed, observed, observed],
  } } }, 3);
  assert.equal(r.length, 2);
  assert.equal(r[0].accession, filing.accession);
  assert.equal(r[1].accession, "0000789019-26-000100");
});

test("report actual P/S plus other mechanical transactions without calling awards insider buying", () => {
  const result = parseSecForm4(exampleXML(), "789019", "MSFT", filing, observed);
  assert.equal(result.length, 6);
  assert.deepEqual(Array.from(result.map(row => row.classification)), [
    "reported_purchase", "reported_sale", "other_reported_transaction",
    "other_reported_transaction", "other_reported_transaction", "other_reported_transaction",
  ]);
  assert.equal(result[0].reported_notional_usd, 1986750);
  assert.equal(result[0].owner_name, "Example & Insider");
  assert.equal(result[0].owner_role, "Director");
  assert.equal(result[0].observed_at, observed);
  assert.equal(result[0].filing_accepted_at_raw, filing.acceptedAtRaw);
  assert.equal(result[0].plan_10b5_1, false);
  assert.equal(result[0].ownership_form, "D");
  assert.equal(result[2].transaction_code, "A");
  assert.equal(result[3].transaction_code, "M");
  assert.equal(result[4].classification, "other_reported_transaction");
});

test("issuer mismatch, joint owners, and XML without ownership root fail closed", () => {
  assert.equal(parseSecForm4(exampleXML(), "12345", "MSFT", filing, observed).length, 0);
  assert.equal(parseSecForm4(exampleXML(), "789019", "AAPL", filing, observed).length, 0);
  assert.equal(parseSecForm4("<html>Not filing</html>", "789019", "MSFT", filing, observed).length, 0);
  const other = "<reportingOwner><reportingOwnerId><rptOwnerName>Second Owner</rptOwnerName></reportingOwnerId></reportingOwner>";
  assert.equal(parseSecForm4(exampleXML(other), "789019", "MSFT", filing, observed).length, 0);
});

test("a future transaction date cannot be introduced into current research", () => {
  const result = parseSecForm4(exampleXML().replaceAll("2026-02-18</value>", "2026-11-20</value>"),
    "789019", "MSFT", filing, observed);
  assert.equal(result.length, 0);
});

test("each row keeps stable original filing transaction index", () => {
  const result = parseSecForm4(exampleXML(), "789019", "MSFT", filing, observed);
  assert.deepEqual(Array.from(result.map(row => row.transaction_index)), [0, 1, 2, 3, 4, 5]);
});
