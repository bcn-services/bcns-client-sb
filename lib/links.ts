/**
 * links.ts — outbound targets for the service buttons ("View Shopify
 * Dashboard", "View Ads Manager", "Open Monday.com", "Join Meeting" and the
 * panels' "View All →"). The dashboard never rebuilds those screens; it links
 * to them, always in a new tab.
 *
 * ponytail: generic landing pages until SB hands over its store handle, Meta
 * act_id and Monday slug — swap the constant, not the call sites, when the
 * open questions in CLIENT.md are answered.
 */

export const SERVICE_LINKS = {
  shopifyAdmin: "https://admin.shopify.com/",
  metaAdsManager: "https://adsmanager.facebook.com/adsmanager/",
  monday: "https://monday.com/",
  googleMeet: "https://meet.google.com/",
} as const;

export type ServiceLinkKey = keyof typeof SERVICE_LINKS;

/** Props every outbound link needs, so no call site forgets the rel guard. */
export const EXTERNAL_LINK_PROPS = { target: "_blank", rel: "noopener noreferrer" } as const;
