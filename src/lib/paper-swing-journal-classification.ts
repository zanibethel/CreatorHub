/**
 * Normalize Harbor's rich prospect-intake disposition to the journal's
 * constrained event_type and qualification enums. The raw disposition
 * remains in metadata to distinguish staging, deferral and rejection.
 */
export type SwingIntakeDisposition="staged"|"eligible"|"deferred"|"rejected";
export function swingJournalClassification(disposition:SwingIntakeDisposition):{
  eventType:"candidate"|"rejected";
  qualification:"qualified"|"watch"|"unqualified";
}{
  if(disposition==="rejected")return {eventType:"rejected",qualification:"unqualified"};
  if(disposition==="deferred")return {eventType:"candidate",qualification:"watch"};
  return {eventType:"candidate",qualification:"qualified"};
}
