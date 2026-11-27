import type { Migration } from 'kysely/migration';

import * as init from './202610200000_init.js';
import * as usersAndMembers from './202610200100_users_and_members.js';
import * as rolesAndProfile from './202610210000_roles_and_profile.js';
import * as projects from './202610220000_projects.js';
import * as connections from './202610230000_connections.js';
import * as agents from './202610240000_agents.js';
import * as runtime from './202610250000_runtime.js';
import * as metrics from './202610260000_metrics.js';
import * as catalog from './202610300000_catalog.js';
import * as catalogOnboarding from './202610310000_catalog_onboarding.js';
import * as personalManagerChat from './202611270000_personal_manager_chat.js';
import * as managerContextReset from './202611270001_manager_context_reset.js';
import * as supportMailOutbox from './202611270002_support_mail_outbox.js';

/**
 * Explicit registry instead of directory scanning: works identically in ts-jest, tsx and
 * compiled dist. A unit test checks that every file in this folder is registered.
 */
export const migrations: Record<string, Migration> = {
  '202610200000_init': init,
  '202610200100_users_and_members': usersAndMembers,
  '202610210000_roles_and_profile': rolesAndProfile,
  '202610220000_projects': projects,
  '202610230000_connections': connections,
  '202610240000_agents': agents,
  '202610250000_runtime': runtime,
  '202610260000_metrics': metrics,
  '202610300000_catalog': catalog,
  '202610310000_catalog_onboarding': catalogOnboarding,
  '202611270000_personal_manager_chat': personalManagerChat,
  '202611270001_manager_context_reset': managerContextReset,
  '202611270002_support_mail_outbox': supportMailOutbox,
};
