import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, primaryKey, unique, foreignKey, index, check } from "drizzle-orm/sqlite-core";

export const datasetMetadata = sqliteTable("dataset_metadata", {
  key: text("metadata_key").primaryKey(), value: text("metadata_value").notNull(),
});
export const businessGroups = sqliteTable("business_groups", {
  id: integer("business_group_id").primaryKey(), name: text("business_group_name").notNull().unique(),
});
export const teams = sqliteTable("teams", {
  id: integer("team_id").primaryKey(), groupId: integer("business_group_id").notNull().references(() => businessGroups.id),
  parentId: integer("parent_team_id"), name: text("team_name").notNull().unique(), code: text("team_code").notNull().unique(),
}, t => [unique().on(t.id, t.groupId), foreignKey({columns:[t.parentId,t.groupId],foreignColumns:[t.id,t.groupId]})]);
export const teamClosure = sqliteTable("team_closure", {
  ancestorId: integer("ancestor_team_id").notNull().references(() => teams.id),
  descendantId: integer("descendant_team_id").notNull().references(() => teams.id), depth: integer("depth").notNull(),
}, t => [primaryKey({columns:[t.ancestorId,t.descendantId]})]);
export const owners = sqliteTable("project_owners", {
  id: integer("owner_id").primaryKey(), name: text("owner_name").notNull(), teamId: integer("team_id").notNull().references(() => teams.id),
}, t => [unique().on(t.id,t.teamId)]);
export const opportunities = sqliteTable("opportunities", {
  projectId: text("project_id").primaryKey(), ownerId: integer("owner_id").notNull(), teamId: integer("team_id").notNull().references(() => teams.id),
  projectName: text("project_name").notNull(), customerName: text("customer_name").notNull(), amount: integer("project_amount_cents").notNull(),
  grossProfit: integer("expected_gross_profit_cents").notNull(), profit: integer("expected_profit_cents").notNull(), stage: integer("project_stage").notNull(),
  publishDate: text("expected_publish_date"), closeDate: text("expected_close_date").notNull(), commitment: text("performance_commitment").notNull(),
  tender: integer("requires_tender").notNull(), bidDate: text("bid_award_date"), province: text("province").notNull(), city: text("city").notNull(),
  district: text("district").notNull(), createdDate: text("created_date").notNull(),
}, t => [foreignKey({columns:[t.ownerId,t.teamId],foreignColumns:[owners.id,owners.teamId]}),
  index("opportunities_team_stage_close").on(t.teamId,t.stage,t.closeDate), index("opportunities_created").on(t.createdDate),
  check("valid_stage",sql`${t.stage} IN (0,20,40,60,80,90,100)`), check("valid_commitment",sql`${t.commitment} IN ('力争','确保','冲刺')`),
  check("valid_amount",sql`${t.amount}>0`), check("valid_tender",sql`${t.tender} IN (0,1)`),
  check("valid_profit",sql`${t.profit}<=${t.grossProfit} AND ${t.grossProfit}<=${t.amount}`), check("valid_dates",sql`${t.closeDate}>=${t.createdDate}`),
  check("valid_bid",sql`${t.tender}=1 OR (${t.publishDate} IS NULL AND ${t.bidDate} IS NULL)`),
]);

export const agentSessions = sqliteTable("agent_sessions", {
  sessionId:text("session_id").primaryKey(),ownerKey:text("owner_key").notNull(),
  contextJson:text("context_json").notNull(),revision:integer("revision").notNull().default(0),
  updatedAt:integer("updated_at").notNull(),
},t=>[index("agent_sessions_owner_updated").on(t.ownerKey,t.updatedAt)]);
export const agentResults = sqliteTable("agent_results", {
  resultId:text("result_id").primaryKey(),sessionId:text("session_id").notNull().references(()=>agentSessions.sessionId),
  ownerKey:text("owner_key").notNull(),filtersJson:text("filters_json").notNull(),
  fingerprint:text("fingerprint").notNull(),checkedFingerprint:text("checked_fingerprint"),
  qualityJson:text("quality_json"),exportPlanJson:text("export_plan_json"),createdAt:integer("created_at").notNull(),
},t=>[index("agent_results_session").on(t.sessionId,t.createdAt)]);
