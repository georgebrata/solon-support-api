/**
 * Documentation types only.
 *
 * Trello stays on the Support Bot side. This service never calls Trello,
 * never stores Trello credentials, and never creates cards.
 *
 * After a visitor voluntarily gives an email, Support Bot may create or
 * update a PROSPECT card and add a summary comment. CLIENT and ABONAT
 * records are never demoted; a comment is the only write allowed there.
 */

export const WEBSITE_SUPPORT_SOURCE = "website-support-chat" as const;

export type PeopleList = "PROSPECT" | "CLIENT" | "ABONAT" | "CONTACT" | "AVOCAT";

export interface ProspectSummaryComment {
  source: typeof WEBSITE_SUPPORT_SOURCE;
  summary: string;
}

export interface ProspectHandoff {
  list: "PROSPECT";
  emailProvided: boolean;
  comment: ProspectSummaryComment;
}
